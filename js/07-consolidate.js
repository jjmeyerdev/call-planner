/* ==============================================================
   07-consolidate.js
   --------------------------------------------------------------
   Removes rows that are literally the same test twice, then offers
   rows that look like the same test written twice for a person to
   decide about.

   The distinction matters. Exact duplicates are removed
   automatically and reported. Near-duplicates are never removed by
   the application: they are grouped, scored, explained, and left
   for a reviewer.
   ============================================================== */

window.QA = window.QA || {};

QA.consolidate = (function () {
  "use strict";

  const C = QA.constants;
  const U = QA.utils;
  const M = QA.model;
  const K = QA.classify;

  /* ------------------------------------------------------------
     EXACT DUPLICATES
     ------------------------------------------------------------ */

  function removeExactDuplicates(cases, segment) {
    const retained = new Map();
    const kept = [];
    const removed = [];

    for (const testCase of cases) {
      const signature = M.exactDuplicateSignature(testCase, segment);

      if (!retained.has(signature)) {
        retained.set(signature, testCase);
        kept.push(testCase);
        continue;
      }

      removed.push({
        removedId: testCase.id,
        removedRow: testCase.sourceOrder,
        retainedId: retained.get(signature).id,
        retainedRow: retained.get(signature).sourceOrder
      });
    }

    return { kept: kept, removed: removed };
  }

  /* ------------------------------------------------------------
     CANDIDATE BLOCKING

     Comparing every row against every other row is wasteful and,
     worse, it invites false matches between unrelated scenarios
     that happen to share domain vocabulary. Rows are bucketed by
     the things that must agree before a comparison is even
     meaningful, and only rows sharing a bucket are ever scored.
     ------------------------------------------------------------ */

  function bucketKeys(testCase, segment) {
    const signature = M.structuredSignature(testCase, segment);
    const subjects = [...signature.subjects].sort();
    const terminal = K.terminalFamily(signature.terminal);
    const population = [...signature.population].sort().join(",");

    if (!subjects.length) {
      return [signature.intentFamily + "|NO_SUBJECT|" + population + "|" + terminal];
    }

    return subjects.slice(0, 5).map(function (subject) {
      return signature.intentFamily + "|" + subject + "|" + population + "|" + terminal;
    });
  }

  /* ------------------------------------------------------------
     SIMILARITY

     A pair is disqualified outright by any hard disagreement.
     Only pairs that survive every gate are scored.
     ------------------------------------------------------------ */

  const GATES = [
    ["Different intent families", function (a, b) {
      return K.intentCompatibility(a.intent, b.intent) > 0;
    }],
    ["Different population applicability", function (a, b) {
      return M.populationsEquivalentOrUnknown(a.population, b.population);
    }],
    ["Conflicting conditions", function (a, b) {
      return !K.mapsConflict(a.conditionMap, b.conditionMap);
    }],
    ["Conflicting expected outcomes", function (a, b) {
      return !K.outcomeContradiction(a.outcomeMap, b.outcomeMap);
    }],
    ["Different device requirements", function (a, b) {
      return K.hardEnumCompatible(a.device, b.device, C.DEVICE.ANY);
    }],
    ["Different ANI requirements", function (a, b) {
      return K.hardEnumCompatible(a.ani, b.ani, C.ANI.ANY);
    }],
    ["Different time requirements", function (a, b) {
      return K.hardEnumCompatible(a.time, b.time, C.TIME.ANY);
    }],
    ["Different Mock/Staging environments", function (a, b) {
      return a.environment === "ANY" || b.environment === "ANY" ||
        a.environment === b.environment;
    }],
    ["Different explicit Routing ID", function (a, b) {
      return !a.routingId || !b.routingId ||
        U.matchText(a.routingId) === U.matchText(b.routingId);
    }],
    ["Different terminal behaviour", function (a, b) {
      return K.terminalFamily(a.terminal) === K.terminalFamily(b.terminal);
    }],
    ["Different testing subjects", function (a, b) {
      if (!a.subjects.size || !b.subjects.size) {
        return true;
      }
      return [...a.subjects].some(function (subject) {
        return b.subjects.has(subject);
      });
    }]
  ];

  /* Score weights add up to 100. */
  const WEIGHTS = {
    intent: 20,
    condition: 22,
    outcome: 24,
    subject: 16,
    scenarioText: 12,
    passCriteriaText: 6
  };

  function similarity(first, second, segment) {
    const a = M.structuredSignature(first, segment);
    const b = M.structuredSignature(second, segment);

    for (const gate of GATES) {
      if (!gate[1](a, b)) {
        return { score: 0, reasons: [gate[0]] };
      }
    }

    const conditionScore = U.jaccardSets(
      K.mapToTagSet(a.conditionMap),
      K.mapToTagSet(b.conditionMap)
    );

    const outcomeScore = U.jaccardSets(
      K.mapToTagSet(a.outcomeMap),
      K.mapToTagSet(b.outcomeMap)
    );

    const subjectScore = U.jaccardSets(a.subjects, b.subjects);
    const scenarioTextScore = U.textTieBreak(first.scenario, second.scenario);
    const passCriteriaTextScore = U.textTieBreak(
      first.passCriteria || first.expectedOutcome,
      second.passCriteria || second.expectedOutcome
    );

    /* At least one substantive dimension has to overlap. Without
       this, two scenarios could reach the threshold on shared
       vocabulary alone. */
    if (
      scenarioTextScore < 0.30 &&
      conditionScore < 0.50 &&
      outcomeScore < 0.50 &&
      subjectScore < 0.65
    ) {
      return { score: 0, reasons: ["Insufficient substantive overlap"] };
    }

    const score =
      K.intentCompatibility(a.intent, b.intent) * WEIGHTS.intent +
      conditionScore * WEIGHTS.condition +
      outcomeScore * WEIGHTS.outcome +
      subjectScore * WEIGHTS.subject +
      scenarioTextScore * WEIGHTS.scenarioText +
      passCriteriaTextScore * WEIGHTS.passCriteriaText;

    const reasons = [];

    if (scenarioTextScore >= 0.55) {
      reasons.push("scenario wording substantially overlaps");
    }
    if (conditionScore >= 0.65) {
      reasons.push("same condition signature");
    }
    if (outcomeScore >= 0.65) {
      reasons.push("same expected-outcome signature");
    }
    if (subjectScore >= 0.65) {
      reasons.push("same testing subject");
    }

    return { score: score, reasons: reasons };
  }

  /* ------------------------------------------------------------
     GROUPING

     Pairs that score above the threshold are joined into groups
     using a union-find, so a chain of related rows becomes one
     review item rather than several overlapping pairs.
     ------------------------------------------------------------ */

  function candidatePairs(cases, segment) {
    const buckets = new Map();

    cases.forEach(function (testCase, index) {
      for (const key of bucketKeys(testCase, segment)) {
        if (!buckets.has(key)) {
          buckets.set(key, []);
        }
        buckets.get(key).push(index);
      }
    });

    const seenPairs = new Set();
    const pairs = [];

    /* Buckets are walked in sorted key order so the pair list is
       identical for identical input, whatever order rows arrived in. */
    for (const entry of U.sortedEntries(buckets)) {
      const indexes = entry[1];

      for (let i = 0; i < indexes.length; i++) {
        for (let j = i + 1; j < indexes.length; j++) {
          const low = Math.min(indexes[i], indexes[j]);
          const high = Math.max(indexes[i], indexes[j]);
          const pairKey = low + "|" + high;

          if (seenPairs.has(pairKey)) {
            continue;
          }
          seenPairs.add(pairKey);

          const first = cases[low];
          const second = cases[high];

          const result = similarity(first, second, segment);

          if (result.score < C.CONSOLIDATION_SIMILARITY_THRESHOLD) {
            continue;
          }

          pairs.push({
            firstIndex: low,
            secondIndex: high,
            firstId: first.id,
            secondId: second.id,
            score: result.score,
            reasons: result.reasons
          });
        }
      }
    }

    return pairs.sort(function (a, b) {
      return a.firstIndex - b.firstIndex || a.secondIndex - b.secondIndex;
    });
  }

  function findGroups(cases, segment) {
    const pairs = candidatePairs(cases, segment);

    if (!pairs.length) {
      return [];
    }

    const parent = cases.map(function (_, index) { return index; });

    function find(index) {
      let current = index;
      while (parent[current] !== current) {
        parent[current] = parent[parent[current]];
        current = parent[current];
      }
      return current;
    }

    function union(first, second) {
      const firstRoot = find(first);
      const secondRoot = find(second);
      if (firstRoot !== secondRoot) {
        parent[Math.max(firstRoot, secondRoot)] = Math.min(firstRoot, secondRoot);
      }
    }

    pairs.forEach(function (pair) {
      union(pair.firstIndex, pair.secondIndex);
    });

    const grouped = new Map();

    pairs.forEach(function (pair) {
      const root = find(pair.firstIndex);

      if (!grouped.has(root)) {
        grouped.set(root, { pairs: [], indexes: new Set() });
      }

      const group = grouped.get(root);
      group.pairs.push(pair);
      group.indexes.add(pair.firstIndex);
      group.indexes.add(pair.secondIndex);
    });

    const roots = [...grouped.keys()].sort(function (a, b) { return a - b; });

    return roots.map(function (root, position) {
      const group = grouped.get(root);
      const members = [...group.indexes]
        .sort(function (a, b) { return a - b; })
        .map(function (index) { return cases[index]; });

      const scores = group.pairs.map(function (pair) { return pair.score; });

      return {
        groupId: "CG-" + String(position + 1).padStart(3, "0"),
        members: members,
        memberIds: members.map(function (item) { return item.id; }),
        intent: members[0].intent,
        population:
          segment === C.SEGMENT.B ? M.populationLabel(members[0]) : "",
        minScore: Math.round(Math.min(...scores)),
        maxScore: Math.round(Math.max(...scores)),
        reasons: U.unique(
          group.pairs.reduce(function (all, pair) {
            return all.concat(pair.reasons);
          }, [])
        ),
        decision: "KEEP_ALL"
      };
    });
  }

  /* ------------------------------------------------------------
     APPLYING A DECISION

     When a reviewer chooses to merge a group, the first member is
     kept and the rest are dropped, with the merge recorded. The
     kept row's notes gain a line naming what was folded into it,
     so the decision stays visible in the exported file.
     ------------------------------------------------------------ */

  function applyDecisions(cases, groups) {
    const dropped = new Map();
    const merges = [];

    for (const group of groups) {
      if (group.decision !== "MERGE" || group.members.length < 2) {
        continue;
      }

      const keeper = group.members[0];
      const folded = group.members.slice(1);

      folded.forEach(function (member) {
        dropped.set(member, group.groupId);
      });

      const foldedIds = folded.map(function (member) { return member.id; });

      keeper.notes = U.cleanText(
        keeper.notes + "\nConsolidated " + group.groupId + ": absorbed " +
        foldedIds.join(", ") + "."
      );

      merges.push({
        groupId: group.groupId,
        keptId: keeper.id,
        droppedIds: foldedIds
      });
    }

    return {
      kept: cases.filter(function (testCase) { return !dropped.has(testCase); }),
      merges: merges
    };
  }

  return {
    removeExactDuplicates: removeExactDuplicates,
    similarity: similarity,
    candidatePairs: candidatePairs,
    findGroups: findGroups,
    applyDecisions: applyDecisions
  };
})();
