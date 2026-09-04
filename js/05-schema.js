/* ==============================================================
   05-schema.js
   --------------------------------------------------------------
   The import contract. One place that decides whether a row of
   incoming data is usable, and says exactly why when it is not.

   Two rules govern this file:
     1. No row is ever dropped in silence. Every input row leaves
        this stage with a disposition attached to it.
     2. No value is ever guessed. A field that cannot be read is
        reported, not invented.
   ============================================================== */

window.QA = window.QA || {};

QA.schema = (function () {
  "use strict";

  const C = QA.constants;
  const U = QA.utils;
  const M = QA.model;

  const DISPOSITION = {
    ACCEPTED: "ACCEPTED",
    INVALID_FIELD: "INVALID_FIELD",
    MISSING_REQUIRED: "MISSING_REQUIRED",
    EXACT_DUPLICATE: "EXACT_DUPLICATE"
  };

  /* ------------------------------------------------------------
     FIELD DEFINITIONS

     This list is the schema. Everything the validator does is
     driven by it, so adding a field means adding one entry here.

       name      the key in the package JSON
       target    the key on the internal test case
       required  the row is rejected without it
       type      "text" | "enum" | "date" | "list" | "populations"
       values    the allowed values when type is "enum"
       pattern   an extra shape check for "text"
       minLength shortest acceptable text
     ------------------------------------------------------------ */

  const FIELDS = [
    {
      name: "scenarioId",
      target: "id",
      required: true,
      type: "text",
      pattern: /^[A-Za-z0-9_.-]{3,40}$/,
      patternHint: "3 to 40 letters, digits, dot, dash or underscore"
    },
    {
      name: "vendor",
      target: "vendor",
      required: true,
      type: "enum",
      values: C.VENDORS
    },
    {
      name: "businessSegment",
      target: "businessSegment",
      required: true,
      type: "enum",
      values: [C.SEGMENT.A, C.SEGMENT.B]
    },
    { name: "releaseDate", target: "releaseDate", required: false, type: "date" },
    { name: "intent", target: "intent", required: true, type: "text" },
    { name: "category", target: "category", required: false, type: "text" },
    { name: "scenario", target: "scenario", required: true, type: "text", minLength: 5 },
    { name: "expectedOutcome", target: "expectedOutcome", required: true, type: "text", minLength: 5 },
    { name: "conditions", target: "conditions", required: false, type: "list" },

    { name: "sourceTestSteps", target: "testSteps", required: false, type: "text" },
    { name: "sourcePassCriteria", target: "passCriteria", required: false, type: "text" },
    { name: "agentExpectation", target: "agentExpectation", required: false, type: "text" },
    { name: "notes", target: "notes", required: false, type: "text" },

    { name: "sourceFile", target: "sourceFile", required: false, type: "text" },
    { name: "sourceLocation", target: "sourceLocation", required: false, type: "text" },
    { name: "sourceEvidence", target: "sourceEvidence", required: false, type: "text" },
    {
      name: "sourceValidationStatus",
      target: "sourceValidationStatus",
      required: false,
      type: "enum",
      values: C.SOURCE_VALIDATION_STATUSES,
      fallback: "NOT_VALIDATED"
    },
    { name: "clarificationNeeded", target: "clarificationNeeded", required: false, type: "text" },

    { name: "populationApplicability", target: "populationApplicability", required: false, type: "populations" },

    { name: "testDataProfile", target: "mockDataPersona", required: false, type: "text" },
    { name: "testPersona", target: "testPersona", required: false, type: "text" },
    { name: "mockStaging", target: "mockStaging", required: false, type: "text" },

    { name: "routingId", target: "routingId", required: false, type: "text" },
    { name: "routingIdPopA", target: "routingIdPopA", required: false, type: "text" },
    { name: "routingIdPopB", target: "routingIdPopB", required: false, type: "text" },
    { name: "routingIdPopC", target: "routingIdPopC", required: false, type: "text" },
    { name: "testDataPopA", target: "testDataPopA", required: false, type: "text" },
    { name: "testDataPopB", target: "testDataPopB", required: false, type: "text" },
    { name: "testDataPopC", target: "testDataPopC", required: false, type: "text" },

    /* These four deliberately have no fallback. A package that leaves
       one out is saying nothing about it, and 04-model.js then reads
       the answer out of the scenario wording. A package that writes
       "ANY" is saying the scenario genuinely does not care, and that
       answer is kept. */
    {
      name: "deviceRequirement",
      target: "device",
      required: false,
      type: "enum",
      values: [C.DEVICE.ANY, C.DEVICE.MOBILE, C.DEVICE.LANDLINE]
    },
    {
      name: "aniRequirement",
      target: "ani",
      required: false,
      type: "enum",
      values: [C.ANI.ANY, C.ANI.RECOGNIZED, C.ANI.UNRECOGNIZED]
    },
    {
      name: "timeRequirement",
      target: "timeRequirement",
      required: false,
      type: "enum",
      values: [C.TIME.ANY, C.TIME.BUSINESS, C.TIME.AFTER]
    },
    {
      name: "terminalType",
      target: "terminalType",
      required: false,
      type: "enum",
      values: [
        C.TERMINAL.NONE,
        C.TERMINAL.SOFT_BRANCH,
        C.TERMINAL.TRANSFER,
        C.TERMINAL.DISCONNECT,
        C.TERMINAL.TERMINAL
      ]
    },

    { name: "userLabel", target: "userLabel", required: false, type: "text" },
    { name: "dependencies", target: "dependencies", required: false, type: "list" }
  ];

  const FIELD_NAMES = FIELDS.map(function (field) { return field.name; });

  /* ------------------------------------------------------------
     PACKAGE-LEVEL VALIDATION
     ------------------------------------------------------------ */

  /* Checks the wrapper around the scenario list. Returns
     { ok, errors, scenarios, sourceMetadata }. */
  function validatePackage(parsed) {
    const errors = [];

    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        errors: ["The file must contain a single JSON object at the top level."],
        scenarios: [],
        sourceMetadata: {}
      };
    }

    const declared = U.cleanText(parsed.schemaVersion);

    if (!declared) {
      errors.push(
        'The package does not declare a schemaVersion. This build reads version ' +
        C.SUPPORTED_SCHEMA_VERSION + "."
      );
    } else if (declared !== C.SUPPORTED_SCHEMA_VERSION) {
      errors.push(
        "Unsupported schema version " + declared + ". This build reads version " +
        C.SUPPORTED_SCHEMA_VERSION + "."
      );
    }

    if (!Array.isArray(parsed.scenarios)) {
      errors.push('The package has no "scenarios" list.');
    } else if (!parsed.scenarios.length) {
      errors.push('The "scenarios" list is empty.');
    }

    return {
      ok: errors.length === 0,
      errors: errors,
      scenarios: Array.isArray(parsed.scenarios) ? parsed.scenarios : [],
      sourceMetadata: parsed.sourceMetadata || {}
    };
  }

  /* ------------------------------------------------------------
     ROW-LEVEL VALIDATION
     ------------------------------------------------------------ */

  /* Validates one raw scenario object. Always returns a record,
     even when the row is unusable. */
  function validateRow(raw, sourceOrder) {
    const problems = [];
    const testCase = M.blankCase();

    testCase.sourceOrder = sourceOrder;
    testCase.inputSchema = "PACKAGE_" + C.SUPPORTED_SCHEMA_VERSION;

    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return {
        disposition: DISPOSITION.INVALID_FIELD,
        rowNumber: sourceOrder,
        scenarioId: "",
        problems: ["The row is not an object."],
        testCase: null
      };
    }

    for (const field of FIELDS) {
      applyField(field, raw, testCase, problems);
    }

    /* Unknown keys are reported but never block the row. Upstream
       may legitimately add fields this build does not read yet. */
    const unknown = Object.keys(raw).filter(function (key) {
      return FIELD_NAMES.indexOf(key) === -1;
    });

    const missing = problems.filter(function (problem) {
      return problem.kind === DISPOSITION.MISSING_REQUIRED;
    });

    const invalid = problems.filter(function (problem) {
      return problem.kind === DISPOSITION.INVALID_FIELD;
    });

    let disposition = DISPOSITION.ACCEPTED;
    if (missing.length) {
      disposition = DISPOSITION.MISSING_REQUIRED;
    } else if (invalid.length) {
      disposition = DISPOSITION.INVALID_FIELD;
    }

    return {
      disposition: disposition,
      rowNumber: sourceOrder,
      scenarioId: testCase.id || U.cleanText(raw.scenarioId),
      problems: problems.map(function (problem) {
        return problem.field + ": " + problem.reason;
      }),
      unknownFields: unknown,
      testCase: disposition === DISPOSITION.ACCEPTED ? testCase : null
    };
  }

  function applyField(field, raw, testCase, problems) {
    const present = Object.prototype.hasOwnProperty.call(raw, field.name);
    const value = present ? raw[field.name] : undefined;

    if (field.type === "populations") {
      applyPopulations(field, value, testCase, problems);
      return;
    }

    if (field.type === "list") {
      testCase[field.target] = U.unique(
        Array.isArray(value) ? value : U.splitList(value)
      );
      return;
    }

    if (field.type === "date") {
      const text = U.cleanText(value);
      if (!text) {
        if (field.required) {
          problems.push({
            kind: DISPOSITION.MISSING_REQUIRED,
            field: field.name,
            reason: "required"
          });
        }
        return;
      }

      const parsed = U.parseDate(text);
      if (!parsed.ok) {
        problems.push({
          kind: DISPOSITION.INVALID_FIELD,
          field: field.name,
          reason: parsed.reason
        });
        return;
      }

      testCase[field.target] = parsed.value;
      return;
    }

    const text = U.cleanText(value);

    if (!text) {
      if (field.required) {
        problems.push({
          kind: DISPOSITION.MISSING_REQUIRED,
          field: field.name,
          reason: "required"
        });
      } else if (field.fallback) {
        testCase[field.target] = field.fallback;
      }
      return;
    }

    if (field.type === "enum") {
      if (field.values.indexOf(text) === -1) {
        problems.push({
          kind: DISPOSITION.INVALID_FIELD,
          field: field.name,
          reason:
            '"' + text + '" is not allowed. Use one of: ' + field.values.join(", ")
        });
        return;
      }
      testCase[field.target] = text;
      return;
    }

    if (field.minLength && text.length < field.minLength) {
      problems.push({
        kind: DISPOSITION.INVALID_FIELD,
        field: field.name,
        reason: "must be at least " + field.minLength + " characters"
      });
      return;
    }

    if (field.pattern && !field.pattern.test(text)) {
      problems.push({
        kind: DISPOSITION.INVALID_FIELD,
        field: field.name,
        reason: '"' + text + '" must be ' + field.patternHint
      });
      return;
    }

    testCase[field.target] = text;
  }

  /* An empty population list means "not yet mapped". It never means
     "applies to every population". Segment B scenarios that reach
     the optimizer without a mapping are blocked and listed, not
     spread across all three populations. */
  function applyPopulations(field, value, testCase, problems) {
    const applicability = { popa: false, popb: false, popc: false };

    if (value === undefined || value === null || value === "") {
      testCase.populationApplicability = applicability;
      return;
    }

    const entries = Array.isArray(value) ? value : U.splitList(value);

    for (const entry of entries) {
      const label = U.cleanText(entry);
      const key = M.populationKeyFromLabel(label);

      if (!key) {
        problems.push({
          kind: DISPOSITION.INVALID_FIELD,
          field: field.name,
          reason:
            '"' + label + '" is not a population. Use one of: ' +
            C.POPULATION_LABELS.join(", ")
        });
        continue;
      }

      applicability[key] = true;
    }

    testCase.populationApplicability = applicability;
  }

  /* ------------------------------------------------------------
     WHOLE-PACKAGE VALIDATION

     Produces the reconciliation figures the intake screen shows:
       rows in = accepted + invalid + missing, and separately
       duplicates removed, so the arithmetic always closes.
     ------------------------------------------------------------ */

  function validateScenarios(scenarios) {
    const records = [];
    const accepted = [];
    const seenIds = new Map();

    scenarios.forEach(function (raw, index) {
      const record = validateRow(raw, index + 1);

      /* Duplicate scenario IDs are a package authoring error. The
         second one is reported rather than overwriting the first. */
      if (record.testCase) {
        const key = U.matchText(record.testCase.id);
        if (seenIds.has(key)) {
          record.disposition = DISPOSITION.INVALID_FIELD;
          record.problems.push(
            "scenarioId: duplicated. Row " + seenIds.get(key) +
            " already uses this ID."
          );
          record.testCase = null;
        } else {
          seenIds.set(key, record.rowNumber);
        }
      }

      records.push(record);

      if (record.testCase) {
        accepted.push(record.testCase);
      }
    });

    return {
      records: records,
      accepted: accepted,
      counts: summarise(records)
    };
  }

  function summarise(records) {
    const counts = {
      total: records.length,
      accepted: 0,
      invalid: 0,
      missingRequired: 0
    };

    for (const record of records) {
      if (record.disposition === DISPOSITION.ACCEPTED) {
        counts.accepted++;
      } else if (record.disposition === DISPOSITION.MISSING_REQUIRED) {
        counts.missingRequired++;
      } else {
        counts.invalid++;
      }
    }

    return counts;
  }

  return {
    DISPOSITION: DISPOSITION,
    FIELDS: FIELDS,
    validatePackage: validatePackage,
    validateRow: validateRow,
    validateScenarios: validateScenarios
  };
})();
