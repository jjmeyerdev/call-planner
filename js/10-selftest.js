/* ==============================================================
   10-selftest.js
   --------------------------------------------------------------
   Twenty checks that prove the rules the rest of the application
   claims to follow. They build their own data in memory, so they
   never touch anything you have loaded and they never write a file.

   Run them from the link at the bottom of the left spine, or from
   the browser console with QA.selftest.run().

   Adding a check: append an entry to the TESTS list. Each entry is
   a name and a function that returns { pass, detail }.
   ============================================================== */

window.QA = window.QA || {};

QA.selftest = (function () {
  "use strict";

  const C = QA.constants;
  const U = QA.utils;
  const M = QA.model;
  const S = QA.schema;
  const I = QA.importer;
  const G = QA.consolidate;
  const O = QA.optimizer;
  const X = QA.exporter;

  /* ------------------------------------------------------------
     TEST DATA HELPERS
     ------------------------------------------------------------ */

  function makeCase(overrides) {
    const testCase = M.blankCase();

    Object.assign(testCase, {
      id: "TC-001",
      vendor: "VendorA",
      businessSegment: C.SEGMENT.A,
      releaseDate: "2026-01-01",
      intent: "Eligibility",
      category: "Happy Path",
      scenario: "Caller asks for coverage status and the system returns it.",
      expectedOutcome: "The system provides the coverage status.",
      passCriteria: "The system provides the coverage status.",
      sourceValidationStatus: "SOURCE_VALIDATED"
    }, overrides || {});

    return testCase;
  }

  function makeMany(count, build) {
    return Array.from({ length: count }, function (_, index) {
      const testCase = makeCase(build ? build(index) : {});
      testCase.sourceOrder = index + 1;
      return testCase;
    });
  }

  function plan(cases, options) {
    return O.run(cases, Object.assign({
      segment: C.SEGMENT.A,
      maxScenariosPerCall: 8
    }, options || {}));
  }

  function callsContaining(result, id) {
    return result.calls.filter(function (call) {
      return call.items.some(function (item) { return item.id === id; });
    });
  }

  function fingerprint(result) {
    return result.calls
      .map(function (call) {
        return call.callNumber + ":" + call.vendor + ":" + call.population + ":" +
          call.items.map(function (item) { return item.executionKey; }).join(">");
      })
      .join(" | ");
  }

  function verdict(pass, detail) {
    return { pass: pass, detail: detail };
  }

  /* ------------------------------------------------------------
     THE CHECKS
     ------------------------------------------------------------ */

  const TESTS = [

    ["T1  Vendor boundary", function () {
      const cases = makeMany(10, function (index) {
        return {
          id: "V-" + String(index + 1).padStart(2, "0"),
          vendor: index < 5 ? "VendorA" : "VendorB"
        };
      });

      const result = plan(cases);

      const mixed = result.calls.filter(function (call) {
        return U.unique(call.items.map(function (item) { return item.vendor; })).length > 1;
      });

      return verdict(
        mixed.length === 0 && result.calls.length >= 2,
        result.calls.length + " calls, no call mixes vendors."
      );
    }],

    ["T2  Business segment boundary", function () {
      const cases = makeMany(10, function (index) {
        return {
          id: "S-" + String(index + 1).padStart(2, "0"),
          businessSegment: index < 5 ? C.SEGMENT.A : C.SEGMENT.B,
          populationApplicability: index < 5
            ? { popa: false, popb: false, popc: false }
            : { popa: true, popb: false, popc: false }
        };
      });

      const result = plan(cases);

      const mixed = result.calls.filter(function (call) {
        return U.unique(
          call.items.map(function (item) { return item.businessSegment; })
        ).length > 1;
      });

      return verdict(
        mixed.length === 0,
        "No call mixes business segments."
      );
    }],

    ["T3  Population separation", function () {
      const cases = makeMany(3, function (index) {
        return {
          id: "P-" + (index + 1),
          businessSegment: C.SEGMENT.B,
          populationApplicability: { popa: true, popb: true, popc: true }
        };
      });

      const result = plan(cases, { segment: C.SEGMENT.B });

      const mixed = result.calls.filter(function (call) {
        return U.unique(
          call.items.map(function (item) { return item.population; })
        ).length > 1;
      });

      return verdict(
        result.instances.length === 9 && mixed.length === 0 && result.calls.length === 3,
        "3 scenarios became 9 execution instances in " + result.calls.length +
        " calls, one per population."
      );
    }],

    ["T4  Release boundary and numbering", function () {
      const cases = makeMany(10, function (index) {
        return {
          id: "R-" + String(index + 1).padStart(2, "0"),
          releaseDate: index < 5 ? "2026-01-01" : "2026-07-01"
        };
      });

      const result = plan(cases);

      const mixed = result.calls.filter(function (call) {
        return U.unique(
          call.items.map(function (item) { return item.releaseDate; })
        ).length > 1;
      });

      const firstNumbers = U.unique(
        [...new Set(result.calls.map(function (call) { return call.releaseDate; }))]
          .map(function (release) {
            return String(Math.min.apply(null, result.calls
              .filter(function (call) { return call.releaseDate === release; })
              .map(function (call) { return call.callNumber; })));
          })
      );

      return verdict(
        mixed.length === 0 && firstNumbers.length === 1 && firstNumbers[0] === "1",
        "Each release numbers its calls from 1 and never shares a call."
      );
    }],

    ["T5  Terminal runs last", function () {
      const cases = makeMany(4, function (index) {
        return index === 0
          ? {
              id: "T-END",
              intent: "Identity_Verification",
              scenario: "The system disconnects the caller after three failures.",
              expectedOutcome: "The system disconnects the call.",
              terminalType: C.TERMINAL.DISCONNECT
            }
          : { id: "T-" + index };
      });

      const result = plan(cases);
      const call = callsContaining(result, "T-END")[0];

      return verdict(
        Boolean(call) &&
        call.items[call.items.length - 1].id === "T-END",
        "The disconnect scenario sits at step " + (call ? call.items.length : "?") +
        " of " + (call ? call.items.length : "?") + "."
      );
    }],

    ["T6  Device compatibility", function () {
      const cases = [
        makeCase({ id: "D-MOB", device: C.DEVICE.MOBILE }),
        makeCase({ id: "D-LAND", device: C.DEVICE.LANDLINE })
      ];

      const result = plan(cases);

      return verdict(
        result.calls.length === 2,
        "A mobile-only and a landline-only scenario were given " +
        result.calls.length + " separate calls."
      );
    }],

    ["T7  ANI compatibility", function () {
      const cases = [
        makeCase({ id: "A-REC", ani: C.ANI.RECOGNIZED }),
        makeCase({ id: "A-UNR", ani: C.ANI.UNRECOGNIZED })
      ];

      return verdict(
        plan(cases).calls.length === 2,
        "Recognised and unrecognised ANI scenarios were separated."
      );
    }],

    ["T8  Time compatibility", function () {
      const cases = [
        makeCase({ id: "H-BUS", timeRequirement: C.TIME.BUSINESS }),
        makeCase({ id: "H-AFT", timeRequirement: C.TIME.AFTER })
      ];

      return verdict(
        plan(cases).calls.length === 2,
        "Business-hours and after-hours scenarios were separated."
      );
    }],

    ["T9  Routing ID compatibility", function () {
      const cases = [
        makeCase({ id: "N-X", routingId: "555-010-1000" }),
        makeCase({ id: "N-Y", routingId: "555-010-2000" })
      ];

      return verdict(
        plan(cases).calls.length === 2,
        "Two different routing IDs were separated."
      );
    }],

    ["T10 Capacity ceiling", function () {
      const cases = makeMany(20, function (index) {
        return { id: "C-" + String(index + 1).padStart(2, "0") };
      });

      const result = plan(cases, { maxScenariosPerCall: 8 });
      const largest = Math.max.apply(null, result.calls.map(function (call) {
        return call.items.length;
      }));

      return verdict(
        largest <= 8 && result.calls.length >= 3,
        "20 compatible scenarios filled " + result.calls.length +
        " calls, largest holding " + largest + "."
      );
    }],

    ["T11 Preferred minimum packing", function () {
      const cases = makeMany(4, function (index) {
        return { id: "M-" + (index + 1) };
      });

      const result = plan(cases, { maxScenariosPerCall: 8 });

      return verdict(
        result.calls.length === 1 && result.calls[0].items.length === 4,
        "4 compatible scenarios were packed into " + result.calls.length +
        " call rather than split."
      );
    }],

    ["T12 Exact duplicate removal", function () {
      const first = makeCase({ id: "DUP-1", sourceOrder: 1 });
      const second = makeCase({ id: "DUP-2", sourceOrder: 2 });

      const outcome = G.removeExactDuplicates([first, second], C.SEGMENT.A);

      return verdict(
        outcome.kept.length === 1 && outcome.removed.length === 1 &&
        outcome.removed[0].retainedId === "DUP-1",
        "Two identical rows became 1 retained and 1 reported duplicate."
      );
    }],

    ["T13 Consolidation review surfaced", function () {
      const first = makeCase({
        id: "CG-A",
        scenario: "An active caller asks for their coverage status and hears it.",
        expectedOutcome: "The system provides the coverage status successfully.",
        passCriteria: "The system provides the coverage status successfully."
      });

      const second = makeCase({
        id: "CG-B",
        scenario: "The active caller requests coverage status and the status is heard.",
        expectedOutcome: "The system successfully provides the coverage status.",
        passCriteria: "The system successfully provides the coverage status."
      });

      const groups = G.findGroups([first, second], C.SEGMENT.A);

      return verdict(
        groups.length === 1 && groups[0].members.length === 2 &&
        groups[0].decision === "KEEP_ALL",
        groups.length + " review group raised, defaulting to keeping both rows."
      );
    }],

    ["T14 Unmapped population held back", function () {
      const cases = [
        makeCase({
          id: "B-NOPOP",
          businessSegment: C.SEGMENT.B,
          populationApplicability: { popa: false, popb: false, popc: false }
        }),
        makeCase({
          id: "B-POPA",
          businessSegment: C.SEGMENT.B,
          populationApplicability: { popa: true, popb: false, popc: false }
        })
      ];

      const result = plan(cases, { segment: C.SEGMENT.B });

      return verdict(
        result.blocked.length === 1 &&
        result.blocked[0].id === "B-NOPOP" &&
        callsContaining(result, "B-NOPOP").length === 0,
        "The unmapped scenario was listed and kept out of every call."
      );
    }],

    ["T15 Complete coverage, nothing invented", function () {
      const cases = makeMany(25, function (index) {
        return { id: "F-" + String(index + 1).padStart(2, "0") };
      });

      const result = plan(cases);

      const placed = result.calls.reduce(function (total, call) {
        return total + call.items.length;
      }, 0);

      const placedIds = new Set(
        result.calls.flatMap(function (call) {
          return call.items.map(function (item) { return item.id; });
        })
      );

      const coverageCheck = result.validation.filter(function (check) {
        return check.label === "Every scenario placed exactly once";
      })[0];

      return verdict(
        placed === 25 && placedIds.size === 25 && coverageCheck.status === "PASS",
        "25 in, " + placed + " placed across " + result.calls.length +
        " calls, none added or lost."
      );
    }],

    ["T16 CSV round trip keeps every value", function () {
      const cases = [
        makeCase({
          id: "RT-1",
          scenario: 'Caller says "check my status, please" and the system, politely, does.',
          notes: "Line one\nLine two",
          routingId: "555-010-3000"
        })
      ];

      const csv = X.toCsv(
        X.SCENARIO_LIBRARY_HEADERS,
        X.scenarioLibraryRows(cases, C.SEGMENT.A)
      );

      const rows = I.parseDelimited(csv, ",");
      const headers = rows[0];
      const values = rows[1];

      const scenarioBack = values[headers.indexOf("Scenario")];
      const notesBack = values[headers.indexOf("Notes")];
      const routingBack = values[headers.indexOf("Routing ID")];

      return verdict(
        scenarioBack === cases[0].scenario &&
        notesBack === cases[0].notes &&
        routingBack === cases[0].routingId,
        "Quotes, commas and line breaks survived the write and the read."
      );
    }],

    ["T17 Import validation reports every row", function () {
      const validated = S.validateScenarios([
        {
          scenarioId: "OK-1",
          vendor: "VendorA",
          businessSegment: "CB",
          intent: "Eligibility",
          scenario: "A valid scenario line long enough to pass.",
          expectedOutcome: "A valid expected outcome long enough to pass."
        },
        {
          scenarioId: "BAD-1",
          vendor: "VendorA",
          businessSegment: "CB",
          intent: "Eligibility",
          scenario: "Missing its expected outcome entirely."
        }
      ]);

      const bad = validated.records[1];

      return verdict(
        validated.counts.total === 2 &&
        validated.counts.accepted === 1 &&
        validated.counts.missingRequired === 1 &&
        bad.problems.join(" ").indexOf("expectedOutcome") >= 0,
        "2 rows in, 1 accepted, 1 reported as " + bad.disposition +
        " with the field named."
      );
    }],

    ["T18 Same input, same plan", function () {
      const build = function (index) {
        return {
          id: "Z-" + String(index + 1).padStart(2, "0"),
          device: index % 3 === 0 ? C.DEVICE.MOBILE : C.DEVICE.ANY,
          terminalType: index === 7 ? C.TERMINAL.TRANSFER : C.TERMINAL.NONE,
          routingId: index % 4 === 0 ? "555-010-4000" : ""
        };
      };

      const forward = makeMany(14, build);
      const reversed = makeMany(14, build).reverse().map(function (item, index) {
        item.sourceOrder = index + 1;
        return item;
      });

      const first = fingerprint(plan(forward));
      const second = fingerprint(plan(reversed));

      return verdict(
        first === second,
        first === second
          ? "Reversing the input rows produced an identical plan."
          : "Plans differed. Forward: " + first + " Reversed: " + second
      );
    }],

    ["T19 Empty population list means unmapped", function () {
      const record = S.validateRow({
        scenarioId: "EP-1",
        vendor: "VendorA",
        businessSegment: "GB",
        intent: "Eligibility",
        scenario: "A scenario with no population mapped yet.",
        expectedOutcome: "The system returns the expected result.",
        populationApplicability: []
      }, 1);

      const applicability = record.testCase
        ? record.testCase.populationApplicability
        : null;

      return verdict(
        record.disposition === "ACCEPTED" &&
        applicability &&
        !applicability.popa && !applicability.popb && !applicability.popc,
        "The row was accepted and left unmapped rather than treated as all populations."
      );
    }],

    ["T20 Offline integrity", function () {
      const status = QA.integrity.status();

      return verdict(
        status.status === "PASS",
        status.detail + " Content Security Policy present: " +
        (status.cspPresent ? "yes" : "no") + "."
      );
    }]
  ];

  /* ------------------------------------------------------------
     RUNNER
     ------------------------------------------------------------ */

  function run() {
    const results = TESTS.map(function (entry) {
      const name = entry[0];

      try {
        const outcome = entry[1]();
        return {
          name: name,
          status: outcome.pass ? "PASS" : "FAIL",
          detail: outcome.detail
        };
      } catch (error) {
        return {
          name: name,
          status: "FAIL",
          detail: "Threw: " + error.message
        };
      }
    });

    const summary = {
      total: results.length,
      passed: results.filter(function (item) { return item.status === "PASS"; }).length,
      failed: results.filter(function (item) { return item.status === "FAIL"; }).length,
      results: results
    };

    window.QA_SELF_TEST = summary;
    return summary;
  }

  return { run: run, TESTS: TESTS };
})();
