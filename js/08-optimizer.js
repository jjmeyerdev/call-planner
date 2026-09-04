/* ==============================================================
   08-optimizer.js
   --------------------------------------------------------------
   Packs scenarios into the smallest reasonable set of physical
   phone calls without ever breaking a hard boundary.

   THE ONE RULE THAT MATTERS

   The same input must always produce the same call plan. Two
   testers loading the same package on two machines, or the same
   file with its rows in a different order, must get identical
   output. Everything in this file is arranged to guarantee that:

     - every group is walked in sorted key order, never in the
       order rows happened to arrive
     - every sort ends in a tie-break that cannot come out two
       different ways
     - the regrouping pass only accepts a change that measurably
       improves the plan

   HARD BOUNDARIES - never crossed, in any circumstance

     vendor, business segment, release date, population,
     named caller, device, ANI, time of day, routing ID,
     one hard terminal per call, capacity ceiling

   SOFT PREFERENCES - improved where possible, never enforced

     preferred minimum scenarios per call, grouping by shared
     intent, grouping by shared test data
   ============================================================== */

window.QA = window.QA || {};

QA.optimizer = (function () {
  "use strict";

  const C = QA.constants;
  const U = QA.utils;
  const M = QA.model;
  const K = QA.classify;

  /* ============================================================
     STAGE 1 - EXECUTION INSTANCES

     A Segment A scenario runs once. A Segment B scenario runs once
     per population it applies to, with that population's own
     routing ID and test data.
     ============================================================ */

  function buildExecutionInstances(cases, segment) {
    const instances = [];
    const blocked = [];

    cases.forEach(function (testCase) {
      if (segment === C.SEGMENT.A) {
        instances.push(makeInstance(testCase, "", segment));
        return;
      }

      const populations = M.populationList(testCase);

      /* An unmapped Segment B scenario is set aside and listed. It
         is never spread across all three populations, and it is
         never quietly dropped. */
      if (!populations.length) {
        blocked.push({
          id: testCase.id,
          sourceOrder: testCase.sourceOrder,
          reason: "SEGMENT_B_POPULATION_MAPPING_REQUIRED"
        });
        return;
      }

      populations.forEach(function (population) {
        instances.push(makeInstance(testCase, population, segment));
      });
    });

    return { instances: instances, blocked: blocked };
  }

  function makeInstance(testCase, population, segment) {
    const perPopulation = populationFields(testCase, population);

    /* Settle device, ANI, time and terminal on the clone, so the
       packing rules below always compare concrete values. */
    const settled = M.deriveExecutionFields(M.cloneCase(testCase), segment);

    return Object.assign(settled, {
      segment: segment,
      population: population,

      /* Unique name for this one execution of this one scenario. */
      executionKey:
        segment + "|" + (population || "-") + "|" + testCase.id,

      /* The last word in every tie-break in this file. Deliberately
         built from the scenario ID and population only: the row a
         scenario happened to occupy in the source file must never
         influence the plan, or the same data in a different order
         would produce a different answer. */
      sortKey: testCase.id + "|" + (population || "-"),

      executionRoutingId: perPopulation.routingId,
      executionTestData: perPopulation.testData
    });
  }

  function populationFields(testCase, population) {
    const fallbackData = testCase.mockDataPersona || testCase.testPersona;
    const fallbackRouting = testCase.routingId;

    const byPopulation = {
      "Population A": { routingId: testCase.routingIdPopA, testData: testCase.testDataPopA },
      "Population B": { routingId: testCase.routingIdPopB, testData: testCase.testDataPopB },
      "Population C": { routingId: testCase.routingIdPopC, testData: testCase.testDataPopC }
    };

    const specific = byPopulation[population];

    return {
      routingId: (specific && specific.routingId) || fallbackRouting,
      testData: (specific && specific.testData) || fallbackData
    };
  }

  /* ============================================================
     STAGE 2 - BOUNDARY KEYS
     ============================================================ */

  /* Calls never span these three values. */
  function boundaryKey(item) {
    return [
      item.vendor || "VENDOR_UNSPECIFIED",
      item.businessSegment,
      item.releaseDate || "RELEASE_UNSPECIFIED"
    ].join("|");
  }

  /* Inside a boundary, Segment B calls never span populations. */
  function populationKey(item) {
    return item.population || "-";
  }

  /* ============================================================
     STAGE 3 - COMPATIBILITY

     One function answers "may this scenario join this call?".
     Every rule that can refuse lives here, so there is exactly one
     place to look when a plan separates two scenarios.
     ============================================================ */

  /* Collapses one hard dimension across a set of items.
     Returns the agreed value, the neutral value, or "CONFLICT". */
  function hardDimension(items, read, neutralValue) {
    let agreed = neutralValue;

    for (const item of items) {
      const value = read(item);

      if (!value || value === neutralValue) {
        continue;
      }
      if (agreed === neutralValue) {
        agreed = value;
        continue;
      }
      if (agreed !== value) {
        return "CONFLICT";
      }
    }

    return agreed;
  }

  function hardDevice(items) {
    return hardDimension(items, function (item) { return item.device; }, C.DEVICE.ANY);
  }

  function hardANI(items) {
    return hardDimension(items, function (item) { return item.ani; }, C.ANI.ANY);
  }

  function hardTime(items) {
    return hardDimension(items, function (item) { return item.timeRequirement; }, C.TIME.ANY);
  }

  function hardRoutingId(items) {
    return hardDimension(
      items,
      function (item) { return U.firstPhone(item.executionRoutingId); },
      ""
    );
  }

  function namedCallers(call) {
    return U.unique(call.items.map(function (item) { return item.userLabel; }));
  }

  function hardTerminalCount(items) {
    return items.filter(function (item) {
      return K.isHardTerminal(item.terminalType);
    }).length;
  }

  /* Two scenarios conflict when the test data one needs contradicts
     the test data the other needs. The same caller cannot be both
     an active and a terminated account on one call. */
  function conditionConflict(call, item, segment) {
    const incoming = M.structuredSignature(item, segment).conditionMap;

    for (const existing of call.items) {
      const existingMap = M.structuredSignature(existing, segment).conditionMap;
      if (K.mapsConflict(incoming, existingMap)) {
        return true;
      }
    }

    return false;
  }

  function canJoin(call, item, maxPerCall, segment) {
    if (call.items.length >= maxPerCall) {
      return false;
    }

    if (call.boundaryKey !== boundaryKey(item)) {
      return false;
    }

    if (call.populationKey !== populationKey(item)) {
      return false;
    }

    const callers = namedCallers(call);
    if (item.userLabel && callers.length && callers.indexOf(item.userLabel) === -1) {
      return false;
    }

    if (conditionConflict(call, item, segment)) {
      return false;
    }

    const combined = call.items.concat([item]);

    if (hardDevice(combined) === "CONFLICT") { return false; }
    if (hardANI(combined) === "CONFLICT") { return false; }
    if (hardTime(combined) === "CONFLICT") { return false; }
    if (hardRoutingId(combined) === "CONFLICT") { return false; }

    if (K.isHardTerminal(item.terminalType) && hardTerminalCount(call.items) >= 1) {
      return false;
    }

    return true;
  }

  /* ============================================================
     STAGE 4 - PACKING PRIORITY

     A scenario with many hard requirements can legally join very
     few calls, so it is placed first while the plan is still open.
     ============================================================ */

  function constraintScore(item, segment) {
    const W = C.CONSTRAINT_WEIGHTS;
    const signature = M.structuredSignature(item, segment);
    let score = 0;

    if (item.userLabel) { score += W.explicitUser; }
    if (item.device !== C.DEVICE.ANY) { score += W.device; }
    if (item.ani !== C.ANI.ANY) { score += W.ani; }
    if (item.timeRequirement !== C.TIME.ANY) { score += W.timeRequirement; }
    if (item.executionRoutingId) { score += W.routingId; }
    if (item.terminalType !== C.TERMINAL.NONE) { score += W.terminal; }

    score += Object.keys(signature.conditionMap).length * W.perCondition;
    score += (item.dependencies || []).length * W.perDependency;

    return score;
  }

  function byPackingPriority(segment) {
    return function (first, second) {
      return (
        constraintScore(second, segment) - constraintScore(first, segment) ||
        U.compareText(first.sortKey, second.sortKey)
      );
    };
  }

  /* ============================================================
     STAGE 5 - CHOOSING A CALL

     Among the calls a scenario may legally join, prefer the one it
     shares the most with. Ties end on call number, which is fixed
     before any of this runs.
     ============================================================ */

  function fitScore(call, item, segment) {
    const signature = M.structuredSignature(item, segment);
    const callers = namedCallers(call);

    const sameCaller = item.userLabel && callers.indexOf(item.userLabel) >= 0 ? 1 : 0;

    const sameRoutingId =
      item.executionRoutingId &&
      call.items.some(function (existing) {
        return U.firstPhone(existing.executionRoutingId) ===
          U.firstPhone(item.executionRoutingId);
      })
        ? 1 : 0;

    const sameDevice =
      item.device !== C.DEVICE.ANY &&
      call.items.some(function (existing) { return existing.device === item.device; })
        ? 1 : 0;

    const sameANI =
      item.ani !== C.ANI.ANY &&
      call.items.some(function (existing) { return existing.ani === item.ani; })
        ? 1 : 0;

    const sameIntent =
      call.items.some(function (existing) {
        return M.structuredSignature(existing, segment).intentFamily ===
          signature.intentFamily;
      })
        ? 1 : 0;

    const conditionOverlap = call.items.length
      ? Math.max.apply(null, call.items.map(function (existing) {
          return U.jaccardSets(
            K.mapToTagSet(M.structuredSignature(existing, segment).conditionMap),
            K.mapToTagSet(signature.conditionMap)
          );
        }))
      : 0;

    return {
      call: call,
      sameCaller: sameCaller,
      sameRoutingId: sameRoutingId,
      sameDevice: sameDevice,
      sameANI: sameANI,
      sameIntent: sameIntent,
      conditionOverlap: conditionOverlap,
      roomToTarget: Math.max(0, call.targetSize - call.items.length)
    };
  }

  function compareFit(first, second) {
    return (
      second.sameCaller - first.sameCaller ||
      second.sameRoutingId - first.sameRoutingId ||
      second.sameDevice - first.sameDevice ||
      second.sameANI - first.sameANI ||
      second.conditionOverlap - first.conditionOverlap ||
      second.sameIntent - first.sameIntent ||
      second.roomToTarget - first.roomToTarget ||
      first.call.callNumber - second.call.callNumber
    );
  }

  function bestCallFor(calls, item, maxPerCall, segment) {
    const candidates = calls
      .filter(function (call) { return canJoin(call, item, maxPerCall, segment); })
      .map(function (call) { return fitScore(call, item, segment); })
      .sort(compareFit);

    return candidates.length ? candidates[0].call : null;
  }

  /* ============================================================
     STAGE 6 - PACKING A POOL
     ============================================================ */

  function createCall(anchor, callNumber, targetSize) {
    return {
      boundaryKey: boundaryKey(anchor),
      populationKey: populationKey(anchor),
      vendor: anchor.vendor,
      businessSegment: anchor.businessSegment,
      population: anchor.population || "",
      releaseDate: anchor.releaseDate,
      callNumber: callNumber,
      targetSize: targetSize,
      items: [],
      callName: "",
      callType: "",
      userProfile: "",
      endpointGuidance: "",
      callScript: ""
    };
  }

  /* Spread a known total as evenly as the ceiling allows. */
  function balancedTargets(total, callCount, maxPerCall) {
    const base = Math.floor(total / callCount);
    const remainder = total % callCount;

    return Array.from({ length: callCount }, function (_, index) {
      return Math.min(maxPerCall, index < remainder ? base + 1 : base);
    });
  }

  function packPool(items, startCallNumber, maxPerCall, segment) {
    if (!items.length) {
      return { calls: [], nextCallNumber: startCallNumber };
    }

    const sorted = [...items].sort(byPackingPriority(segment));

    const terminals = sorted.filter(function (item) {
      return K.isHardTerminal(item.terminalType);
    });

    /* Enough calls for the capacity ceiling and for one hard
       terminal each, whichever needs more. */
    const requiredCalls = Math.max(
      Math.ceil(sorted.length / maxPerCall),
      terminals.length,
      1
    );

    const targets = balancedTargets(sorted.length, requiredCalls, maxPerCall);

    const calls = Array.from({ length: requiredCalls }, function (_, index) {
      return createCall(sorted[0], startCallNumber + index, targets[index]);
    });

    const placed = new Set();

    /* Hard terminals are seated first, one per call. */
    terminals.forEach(function (item, index) {
      const call = calls[index];
      call.items.push(item);
      placed.add(item.executionKey);
    });

    const remaining = sorted.filter(function (item) {
      return !placed.has(item.executionKey);
    });

    for (const item of remaining) {
      let target = bestCallFor(calls, item, maxPerCall, segment);

      if (!target) {
        target = createCall(item, startCallNumber + calls.length, 1);
        calls.push(target);
      }

      target.items.push(item);
    }

    return { calls: calls, nextCallNumber: startCallNumber + calls.length };
  }

  /* ============================================================
     STAGE 7 - THE REGROUPING PASS

     After the first pass some calls hold only one or two
     scenarios. This pass tries to fix that, but every change has
     to prove itself first: the objective below must improve, or
     the change is discarded. The previous build applied merges
     without this check, which could leave two undersized calls
     where one had stood.

     The objective, compared left to right, smaller is better:

       [ calls below the preferred minimum,
         calls holding one scenario,
         calls holding two scenarios,
         total calls ]
     ============================================================ */

  function objective(calls, preferredMinimum) {
    return [
      calls.filter(function (call) { return call.items.length < preferredMinimum; }).length,
      calls.filter(function (call) { return call.items.length === 1; }).length,
      calls.filter(function (call) { return call.items.length === 2; }).length,
      calls.length
    ];
  }

  function improves(candidate, current) {
    for (let index = 0; index < current.length; index++) {
      if (candidate[index] < current[index]) { return true; }
      if (candidate[index] > current[index]) { return false; }
    }
    return false;
  }

  function cloneCalls(calls) {
    return calls.map(function (call) {
      return Object.assign({}, call, { items: [...call.items] });
    });
  }

  function bySizeThenNumber(first, second) {
    return first.items.length - second.items.length ||
      first.callNumber - second.callNumber;
  }

  function canAbsorb(target, source, maxPerCall, segment) {
    if (
      target.boundaryKey !== source.boundaryKey ||
      target.populationKey !== source.populationKey ||
      target.items.length + source.items.length > maxPerCall
    ) {
      return false;
    }

    const simulated = { ...target, items: [...target.items] };

    for (const item of source.items) {
      if (!canJoin(simulated, item, maxPerCall, segment)) {
        return false;
      }
      simulated.items.push(item);
    }

    return true;
  }

  const GUARD_LIMIT = 200;

  /* Fold a whole undersized call into another call. */
  function mergeWholeCalls(inputCalls, maxPerCall, preferredMinimum, segment) {
    let calls = cloneCalls(inputCalls);
    let changed = true;
    let guard = 0;

    while (changed && guard++ < GUARD_LIMIT) {
      changed = false;
      calls.sort(bySizeThenNumber);

      const current = objective(calls, preferredMinimum);

      for (let sourceIndex = 0; sourceIndex < calls.length && !changed; sourceIndex++) {
        if (calls[sourceIndex].items.length >= preferredMinimum) {
          continue;
        }

        for (let targetIndex = 0; targetIndex < calls.length; targetIndex++) {
          if (
            sourceIndex === targetIndex ||
            !canAbsorb(calls[targetIndex], calls[sourceIndex], maxPerCall, segment)
          ) {
            continue;
          }

          const proposal = cloneCalls(calls);
          proposal[targetIndex].items.push(...proposal[sourceIndex].items);
          proposal.splice(sourceIndex, 1);

          if (improves(objective(proposal, preferredMinimum), current)) {
            calls = proposal;
            changed = true;
            break;
          }
        }
      }
    }

    return calls;
  }

  /* Empty an undersized call by scattering its scenarios into
     other calls, removing the call entirely. */
  function scatterSmallCall(inputCalls, maxPerCall, preferredMinimum, segment) {
    let calls = cloneCalls(inputCalls);
    let changed = true;
    let guard = 0;

    while (changed && guard++ < GUARD_LIMIT) {
      changed = false;
      calls.sort(bySizeThenNumber);

      const current = objective(calls, preferredMinimum);

      for (let sourceIndex = 0; sourceIndex < calls.length && !changed; sourceIndex++) {
        const source = calls[sourceIndex];

        if (source.items.length >= preferredMinimum) {
          continue;
        }

        const proposal = cloneCalls(calls);
        const proposalSource = proposal[sourceIndex];
        const others = proposal.filter(function (_, index) { return index !== sourceIndex; });

        let allPlaced = true;

        for (const item of proposalSource.items) {
          const candidates = others
            .filter(function (call) { return canJoin(call, item, maxPerCall, segment); })
            .sort(bySizeThenNumber);

          if (!candidates.length) {
            allPlaced = false;
            break;
          }

          candidates[0].items.push(item);
        }

        if (!allPlaced) {
          continue;
        }

        proposal.splice(sourceIndex, 1);

        if (improves(objective(proposal, preferredMinimum), current)) {
          calls = proposal;
          changed = true;
        }
      }
    }

    return calls;
  }

  /* Move one scenario out of a comfortable call into an undersized
     one, without pushing the donor below the preferred minimum. */
  function borrowIntoSmallCall(inputCalls, maxPerCall, preferredMinimum, segment) {
    let calls = cloneCalls(inputCalls);
    let changed = true;
    let guard = 0;

    while (changed && guard++ < GUARD_LIMIT) {
      changed = false;
      calls.sort(bySizeThenNumber);

      const current = objective(calls, preferredMinimum);

      for (let targetIndex = 0; targetIndex < calls.length && !changed; targetIndex++) {
        const target = calls[targetIndex];

        if (target.items.length >= preferredMinimum || target.items.length >= maxPerCall) {
          continue;
        }

        const donorIndexes = calls
          .map(function (call, index) { return { call: call, index: index }; })
          .filter(function (entry) {
            return entry.index !== targetIndex &&
              entry.call.items.length > preferredMinimum;
          })
          .sort(function (first, second) {
            return second.call.items.length - first.call.items.length ||
              first.call.callNumber - second.call.callNumber;
          });

        for (const donorEntry of donorIndexes) {
          const movable = donorEntry.call.items
            .filter(function (item) { return !K.isHardTerminal(item.terminalType); })
            .sort(function (first, second) {
              return constraintScore(first, segment) - constraintScore(second, segment) ||
                U.compareText(first.sortKey, second.sortKey);
            });

          let moved = false;

          for (const item of movable) {
            if (!canJoin(target, item, maxPerCall, segment)) {
              continue;
            }

            const proposal = cloneCalls(calls);
            const proposalDonor = proposal[donorEntry.index];
            const proposalTarget = proposal[targetIndex];

            proposalDonor.items = proposalDonor.items.filter(function (candidate) {
              return candidate.executionKey !== item.executionKey;
            });
            proposalTarget.items.push(item);

            if (improves(objective(proposal, preferredMinimum), current)) {
              calls = proposal;
              changed = true;
              moved = true;
              break;
            }
          }

          if (moved) {
            break;
          }
        }
      }
    }

    return calls;
  }

  function regroup(calls, maxPerCall, segment) {
    const preferredMinimum = Math.min(C.PREFERRED_MINIMUM, maxPerCall);

    let output = cloneCalls(calls);
    output = mergeWholeCalls(output, maxPerCall, preferredMinimum, segment);
    output = scatterSmallCall(output, maxPerCall, preferredMinimum, segment);
    output = borrowIntoSmallCall(output, maxPerCall, preferredMinimum, segment);
    output = mergeWholeCalls(output, maxPerCall, preferredMinimum, segment);

    return output;
  }

  /* ============================================================
     STAGE 8 - STEP ORDER INSIDE A CALL

     Identity checks run first because everything after them
     depends on the caller being verified. A hard terminal always
     runs last because it ends the call.
     ============================================================ */

  function stageRank(item, segment) {
    if (K.isHardTerminal(item.terminalType)) {
      return C.STAGE_RANK_HARD_TERMINAL;
    }
    if (item.terminalType === C.TERMINAL.SOFT_BRANCH) {
      return C.STAGE_RANK_SOFT_BRANCH;
    }

    const family = M.structuredSignature(item, segment).intentFamily;
    const rank = C.STAGE_RANK[family];

    return rank === undefined ? C.STAGE_RANK_DEFAULT : rank;
  }

  function orderCallItems(items, segment) {
    const ordered = [...items].sort(function (first, second) {
      return stageRank(first, segment) - stageRank(second, segment) ||
        U.compareText(first.sortKey, second.sortKey);
    });

    /* Pull any declared prerequisite in front of the scenario that
       depends on it. */
    let changed = true;
    let guard = 0;

    while (changed && guard++ < GUARD_LIMIT) {
      changed = false;

      for (let index = 0; index < ordered.length && !changed; index++) {
        for (const dependency of ordered[index].dependencies || []) {
          const dependencyIndex = ordered.findIndex(function (candidate) {
            return U.matchText(candidate.id) === U.matchText(dependency);
          });

          if (dependencyIndex > index) {
            const moved = ordered.splice(dependencyIndex, 1)[0];
            ordered.splice(index, 0, moved);
            changed = true;
            break;
          }
        }
      }
    }

    /* A hard terminal ends the call, so it goes last whatever the
       dependency shuffle decided. */
    const terminalIndex = ordered.findIndex(function (item) {
      return K.isHardTerminal(item.terminalType);
    });

    if (terminalIndex >= 0 && terminalIndex !== ordered.length - 1) {
      const terminal = ordered.splice(terminalIndex, 1)[0];
      ordered.push(terminal);
    }

    return ordered;
  }

  /* ============================================================
     STAGE 9 - CALL DESCRIPTION
     ============================================================ */

  function dominantIntents(call) {
    const counts = new Map();

    for (const item of call.items) {
      const intent = item.intent || "Other";
      counts.set(intent, (counts.get(intent) || 0) + 1);
    }

    return [...counts.entries()]
      .sort(function (first, second) {
        return second[1] - first[1] || U.compareText(first[0], second[0]);
      })
      .slice(0, 3)
      .map(function (entry) { return entry[0]; });
  }

  function callName(call) {
    /* The device is reported in its own column and its own chip, so it
       is deliberately not repeated in the name. */
    let name = dominantIntents(call).join(" + ") || "QA Validation";

    const terminal = call.items.filter(function (item) {
      return K.isHardTerminal(item.terminalType);
    })[0];

    if (terminal) {
      const suffix = {
        TRANSFER: " with transfer",
        DISCONNECT: " with disconnect",
        TERMINAL: " with hard stop"
      };
      name += suffix[terminal.terminalType] || "";
    }

    return name;
  }

  function callType(call) {
    const present = new Set(call.items.map(function (item) { return item.terminalType; }));

    if (present.has(C.TERMINAL.DISCONNECT)) { return "Chained, ends in disconnect"; }
    if (present.has(C.TERMINAL.TRANSFER)) { return "Chained, ends in transfer"; }
    if (present.has(C.TERMINAL.TERMINAL)) { return "Chained, ends in hard stop"; }
    if (present.has(C.TERMINAL.SOFT_BRANCH)) { return "Chained, may branch"; }

    return "Chained, no defined endpoint";
  }

  function callProfile(call) {
    const callers = namedCallers(call);

    const personas = U.unique(
      call.items.map(function (item) {
        return item.executionTestData || item.mockDataPersona || item.testPersona;
      })
    );

    const parts = [];
    if (callers.length) { parts.push(callers.join(" + ")); }
    if (personas.length) { parts.push(personas.join(" | ")); }

    return parts.join(" | ") ||
      "No test-data profile supplied. Confirm before executing this call.";
  }

  function endpointGuidance(call) {
    const type = callType(call);

    if (type === "Chained, ends in transfer") {
      return "Run every preceding scenario first. The transfer scenario is last.";
    }
    if (type === "Chained, ends in disconnect") {
      return "Run every preceding scenario first. The disconnect scenario is last.";
    }
    if (type === "Chained, ends in hard stop") {
      return "Run every preceding scenario first. The hard stop is last.";
    }
    if (type === "Chained, may branch") {
      return "The branching scenario is not assumed to end the call. If the branch " +
        "taken does end it, resume the remaining scenarios on a new call.";
    }

    return "Run the scenarios in the order listed. No endpoint is required; " +
      "end the call after the last step.";
  }

  function callScript(call) {
    const lines = [
      "CALL " + call.callNumber,
      "Vendor: " + (call.vendor || "Unspecified"),
      "Business segment: " + C.SEGMENT_LABEL[call.businessSegment]
    ];

    if (call.population) {
      lines.push("Population: " + call.population);
    }

    lines.push("Release: " + (call.releaseDate || "Unspecified"));
    lines.push("Call name: " + call.callName);
    lines.push("Call type: " + call.callType);
    lines.push("Profile: " + call.userProfile);
    lines.push("");

    call.items.forEach(function (item, index) {
      lines.push("STEP " + (index + 1));
      lines.push("Scenario ID: " + item.id);

      if (item.intent) { lines.push("Intent: " + item.intent); }
      if (item.scenario) { lines.push("Scenario: " + item.scenario); }

      if (item.testSteps) {
        lines.push("");
        lines.push("Tester says or does:");
        lines.push(item.testSteps);
      }

      /* Source pass criteria is reproduced exactly as it arrived. */
      const criteria = item.passCriteria || item.expectedOutcome;
      if (criteria) {
        lines.push("");
        lines.push("Pass criteria:");
        lines.push(criteria);
      }

      if (index < call.items.length - 1) {
        lines.push("");
        lines.push("------------------------------------------------------------");
        lines.push("");
      }
    });

    lines.push("");
    lines.push("ENDPOINT GUIDANCE: " + call.endpointGuidance);

    return lines.join("\n");
  }

  function describeCall(call) {
    call.callName = callName(call);
    call.callType = callType(call);
    call.userProfile = callProfile(call);
    call.endpointGuidance = endpointGuidance(call);
    call.callScript = callScript(call);
    return call;
  }

  /* ============================================================
     STAGE 10 - THE RUN
     ============================================================ */

  function groupBy(items, read) {
    const groups = new Map();

    for (const item of items) {
      const key = read(item);
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key).push(item);
    }

    return groups;
  }

  function optimizeBoundaryGroup(items, maxPerCall, segment) {
    const populations = groupBy(items, populationKey);
    let calls = [];
    let nextCallNumber = 1;

    /* Populations are walked in sorted order, never in arrival order. */
    for (const entry of U.sortedEntries(populations)) {
      const packed = optimizePopulation(entry[1], nextCallNumber, maxPerCall, segment);
      calls = calls.concat(packed.calls);
      nextCallNumber = packed.nextCallNumber;
    }

    calls = regroup(calls, maxPerCall, segment);

    calls.sort(function (first, second) {
      return U.compareText(first.populationKey, second.populationKey) ||
        first.callNumber - second.callNumber;
    });

    calls.forEach(function (call, index) {
      call.callNumber = index + 1;
      call.items = orderCallItems(call.items, segment);
      describeCall(call);
    });

    return calls;
  }

  function optimizePopulation(items, startCallNumber, maxPerCall, segment) {
    /* Scenarios naming a specific caller are packed together first,
       because a named caller can never be mixed with another. */
    const named = groupBy(
      items.filter(function (item) { return item.userLabel; }),
      function (item) { return item.userLabel; }
    );

    const unnamed = items.filter(function (item) { return !item.userLabel; });

    let calls = [];
    let nextCallNumber = startCallNumber;

    for (const entry of U.sortedEntries(named)) {
      const packed = packPool(entry[1], nextCallNumber, maxPerCall, segment);
      calls = calls.concat(packed.calls);
      nextCallNumber = packed.nextCallNumber;
    }

    const remaining = [...unnamed].sort(byPackingPriority(segment));

    for (const item of remaining) {
      const target = bestCallFor(calls, item, maxPerCall, segment);

      if (target) {
        target.items.push(item);
        continue;
      }

      const packed = packPool([item], nextCallNumber, maxPerCall, segment);
      calls = calls.concat(packed.calls);
      nextCallNumber = packed.nextCallNumber;
    }

    calls = regroup(calls, maxPerCall, segment);

    return { calls: calls, nextCallNumber: nextCallNumber };
  }

  /* The public entry point. Returns everything the screen and the
     export need, plus the validation verdict. */
  function run(cases, options) {
    const segment = options.segment;
    const maxPerCall = options.maxScenariosPerCall;

    if (!Number.isInteger(maxPerCall) ||
        maxPerCall < 1 ||
        maxPerCall > C.MAX_SCENARIOS_PER_CALL_CEILING) {
      throw new Error(
        "Maximum scenarios per call must be a whole number between 1 and " +
        C.MAX_SCENARIOS_PER_CALL_CEILING + "."
      );
    }

    const built = buildExecutionInstances(cases, segment);
    const instances = built.instances;

    const boundaries = groupBy(instances, boundaryKey);
    let calls = [];

    for (const entry of U.sortedEntries(boundaries)) {
      calls = calls.concat(optimizeBoundaryGroup(entry[1], maxPerCall, segment));
    }

    calls.sort(function (first, second) {
      return U.compareText(first.boundaryKey, second.boundaryKey) ||
        first.callNumber - second.callNumber;
    });

    return {
      segment: segment,
      maxPerCall: maxPerCall,
      instances: instances,
      blocked: built.blocked,
      calls: calls,
      validation: validate(instances, calls, maxPerCall, segment)
    };
  }

  /* ============================================================
     STAGE 11 - VALIDATION

     The plan checks itself. Every one of these must pass before
     the plan may be exported.
     ============================================================ */

  function validate(instances, calls, maxPerCall, segment) {
    const results = [];
    const preferredMinimum = Math.min(C.PREFERRED_MINIMUM, maxPerCall);

    function add(label, status, detail) {
      results.push({ label: label, status: status, detail: detail });
    }

    /* Every execution instance appears exactly once, and nothing
       appears that was not in the input. This is the check that
       catches an invented or a vanished scenario. */
    const inputKeys = new Set(instances.map(function (item) { return item.executionKey; }));
    const placedCounts = new Map();

    calls.forEach(function (call) {
      call.items.forEach(function (item) {
        placedCounts.set(item.executionKey, (placedCounts.get(item.executionKey) || 0) + 1);
      });
    });

    const missing = [...inputKeys].filter(function (key) { return !placedCounts.has(key); });
    const duplicated = [...placedCounts.keys()].filter(function (key) {
      return placedCounts.get(key) > 1;
    });
    const invented = [...placedCounts.keys()].filter(function (key) {
      return !inputKeys.has(key);
    });

    add(
      "Every scenario placed exactly once",
      missing.length || duplicated.length || invented.length ? "FAIL" : "PASS",
      missing.length || duplicated.length || invented.length
        ? describeSetProblem(missing, duplicated, invented)
        : instances.length + " execution instances in, " +
          placedCounts.size + " placed, none added or lost."
    );

    add(
      "Execution keys unique",
      inputKeys.size === instances.length ? "PASS" : "FAIL",
      inputKeys.size === instances.length
        ? "Each scenario and population combination has its own key."
        : (instances.length - inputKeys.size) +
          " execution instance(s) share a key and would overwrite each other."
    );

    add(
      "Capacity ceiling",
      calls.every(function (call) { return call.items.length <= maxPerCall; }) ? "PASS" : "FAIL",
      "No call may hold more than " + maxPerCall + " " +
      U.pluralise(maxPerCall, "scenario") + "."
    );

    const smallCalls = calls.filter(function (call) {
      return call.items.length < preferredMinimum;
    });

    add(
      "Preferred minimum",
      smallCalls.length ? "WARN" : "PASS",
      smallCalls.length
        ? smallCalls.length + " " + U.pluralise(smallCalls.length, "call") +
          " below the preferred minimum of " + preferredMinimum +
          ". Hard constraints prevented further merging."
        : "Every call meets the preferred minimum of " + preferredMinimum + "."
    );

    add(
      "Business segment boundary",
      calls.every(function (call) { return call.businessSegment === segment; }) ? "PASS" : "FAIL",
      "Every call stays inside " + C.SEGMENT_LABEL[segment] + "."
    );

    add(
      "Vendor boundary",
      calls.every(function (call) {
        return U.unique(call.items.map(function (item) { return item.vendor; })).length <= 1;
      }) ? "PASS" : "FAIL",
      "Two vendors may not share one physical call."
    );

    add(
      "Release boundary",
      calls.every(function (call) {
        return U.unique(call.items.map(function (item) { return item.releaseDate; })).length <= 1;
      }) ? "PASS" : "FAIL",
      "Two release dates may not share one physical call."
    );

    if (segment === C.SEGMENT.B) {
      add(
        "Population boundary",
        calls.every(function (call) {
          return U.unique(call.items.map(function (item) { return item.population; })).length <= 1;
        }) ? "PASS" : "FAIL",
        C.POPULATION_LABELS.join(", ") + " may not share one physical call."
      );

      const unmapped = instances.filter(function (item) {
        return C.POPULATION_LABELS.indexOf(item.population) === -1;
      }).length;

      add(
        "Population mapping",
        unmapped ? "FAIL" : "PASS",
        unmapped
          ? unmapped + " execution instance(s) carry no population."
          : "Every execution instance names its population."
      );
    }

    add(
      "Device compatibility",
      calls.every(function (call) { return hardDevice(call.items) !== "CONFLICT"; })
        ? "PASS" : "FAIL",
      "Mobile-only and landline-only scenarios are never mixed."
    );

    add(
      "ANI compatibility",
      calls.every(function (call) { return hardANI(call.items) !== "CONFLICT"; })
        ? "PASS" : "FAIL",
      "Recognised and unrecognised ANI scenarios are never mixed."
    );

    add(
      "Time compatibility",
      calls.every(function (call) { return hardTime(call.items) !== "CONFLICT"; })
        ? "PASS" : "FAIL",
      "Business-hours-only and after-hours-only scenarios are never mixed."
    );

    add(
      "Routing ID compatibility",
      calls.every(function (call) { return hardRoutingId(call.items) !== "CONFLICT"; })
        ? "PASS" : "FAIL",
      "Two different routing IDs are never combined."
    );

    add(
      "Named caller integrity",
      calls.every(function (call) { return namedCallers(call).length <= 1; })
        ? "PASS" : "FAIL",
      "Two different named callers are never combined."
    );

    add(
      "One hard terminal per call",
      calls.every(function (call) { return hardTerminalCount(call.items) <= 1; })
        ? "PASS" : "FAIL",
      "A call that ends can only end once."
    );

    add(
      "Terminal runs last",
      calls.every(function (call) {
        const index = call.items.findIndex(function (item) {
          return K.isHardTerminal(item.terminalType);
        });
        return index === -1 || index === call.items.length - 1;
      }) ? "PASS" : "FAIL",
      "A scenario that ends the call is the final step of that call."
    );

    add(
      "Condition compatibility",
      calls.every(function (call) {
        for (let i = 0; i < call.items.length; i++) {
          for (let j = i + 1; j < call.items.length; j++) {
            const a = M.structuredSignature(call.items[i], segment).conditionMap;
            const b = M.structuredSignature(call.items[j], segment).conditionMap;
            if (K.mapsConflict(a, b)) {
              return false;
            }
          }
        }
        return true;
      }) ? "PASS" : "FAIL",
      "No call asks its test data to be two contradictory things at once."
    );

    return results;
  }

  function describeSetProblem(missing, duplicated, invented) {
    const parts = [];

    if (missing.length) {
      parts.push(missing.length + " scenario(s) missing from the plan: " +
        missing.slice(0, 6).join(", ") + (missing.length > 6 ? ", ..." : ""));
    }
    if (duplicated.length) {
      parts.push(duplicated.length + " scenario(s) placed more than once: " +
        duplicated.slice(0, 6).join(", ") + (duplicated.length > 6 ? ", ..." : ""));
    }
    if (invented.length) {
      parts.push(invented.length + " scenario(s) in the plan that were not in the input: " +
        invented.slice(0, 6).join(", ") + (invented.length > 6 ? ", ..." : ""));
    }

    return parts.join(" ");
  }

  return {
    run: run,
    buildExecutionInstances: buildExecutionInstances,
    canJoin: canJoin,
    constraintScore: constraintScore,
    packPool: packPool,
    regroup: regroup,
    orderCallItems: orderCallItems,
    validate: validate,
    hardDevice: hardDevice,
    hardANI: hardANI,
    hardTime: hardTime,
    hardRoutingId: hardRoutingId,
    hardTerminalCount: hardTerminalCount,
    boundaryKey: boundaryKey,
    describeCall: describeCall
  };
})();
