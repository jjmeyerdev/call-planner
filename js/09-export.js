/* ==============================================================
   09-export.js
   --------------------------------------------------------------
   Writes CSV files straight from the browser's memory to the
   user's disk. No library, no server, no network.

   Rows are built as objects keyed by column name, and the file is
   written by walking the column list in 01-constants.js. Reordering
   or renaming a column there is all it takes: nothing in this file
   depends on a column sitting in a particular position, which is
   how the previous build could silently shift every value one
   column to the left.
   ============================================================== */

window.QA = window.QA || {};

QA.exporter = (function () {
  "use strict";

  const C = QA.constants;
  const U = QA.utils;
  const O = QA.optimizer;

  /* ------------------------------------------------------------
     CSV WRITING
     ------------------------------------------------------------ */

  /* A field is quoted when it contains a comma, a quote, or a line
     break. Quotes inside are doubled. This is the convention Excel,
     Numbers and Sheets all read back correctly. */
  function csvField(value) {
    const text = U.rawString(value);

    if (/[",\n\r]/.test(text)) {
      return '"' + text.replace(/"/g, '""') + '"';
    }

    return text;
  }

  function toCsv(headers, rows) {
    const lines = [headers.map(csvField).join(",")];

    for (const row of rows) {
      lines.push(
        headers
          .map(function (header) { return csvField(row[header]); })
          .join(",")
      );
    }

    /* A trailing newline keeps the last row intact in every reader. */
    return lines.join("\r\n") + "\r\n";
  }

  /* ------------------------------------------------------------
     ROW BUILDERS
     ------------------------------------------------------------ */

  function assignmentIndex(calls) {
    const index = new Map();

    calls.forEach(function (call) {
      call.items.forEach(function (item, stepOrder) {
        index.set(item.executionKey, {
          callNumber: call.callNumber,
          stepOrder: stepOrder + 1,
          callName: call.callName,
          callType: call.callType
        });
      });
    });

    return index;
  }

  function libraryRows(result, vendor) {
    const index = assignmentIndex(result.calls);

    return result.instances
      .filter(function (item) { return item.vendor === vendor; })
      .sort(function (first, second) {
        return U.compareText(first.sortKey, second.sortKey);
      })
      .map(function (item) {
        const assigned = index.get(item.executionKey) || {};

        return {
          "Vendor": item.vendor,
          "Business Segment": item.businessSegment,
          "Population": item.population,
          "Release Date": item.releaseDate,
          "Execution Key": item.executionKey,
          "Scenario ID": item.id,
          "Intent": item.intent,
          "Category": item.category,
          "Scenario": item.scenario,
          "Mock / Staging": item.mockStaging,
          "Test Persona": item.executionTestData || item.testPersona,
          "Mock Data Persona": item.mockDataPersona,
          "Routing ID": item.executionRoutingId,
          "Device": item.device,
          "ANI": item.ani,
          "Time Requirement": item.timeRequirement,
          "Terminal Type": item.terminalType,
          "Source Validation": item.sourceValidationStatus,
          "Source Test Steps": item.testSteps,
          "Source Pass Criteria": item.passCriteria || item.expectedOutcome,
          "Assigned Call Number": assigned.callNumber || "",
          "Step Order": assigned.stepOrder || "",
          "Call Name": assigned.callName || "",
          "Call Type": assigned.callType || ""
        };
      });
  }

  function callPlanRows(result, vendor) {
    return result.calls
      .filter(function (call) { return call.vendor === vendor; })
      .map(function (call) {
        return {
          "Vendor": call.vendor,
          "Business Segment": call.businessSegment,
          "Population": call.population,
          "Release Date": call.releaseDate,
          "Call Number": call.callNumber,
          "Call Name": call.callName,
          "Call Type": call.callType,
          "Scenario Count": call.items.length,
          "Scenario IDs in Execution Order":
            call.items.map(function (item) { return item.id; }).join(", "),
          "User / Test-Data Profile": call.userProfile,
          "Routing ID": U.unique(
            call.items.map(function (item) { return item.executionRoutingId; })
          ).join(" | "),
          "Device": O.hardDevice(call.items),
          "ANI": O.hardANI(call.items),
          "Time Requirement": O.hardTime(call.items),
          "Execution / Endpoint Guidance": call.endpointGuidance,
          "Call Script": call.callScript
        };
      });
  }

  function overviewRows(result, intake) {
    const rows = [];

    function add(section, item, value, detail) {
      rows.push({
        "Section": section,
        "Item": item,
        "Value": value,
        "Detail": detail || ""
      });
    }

    add("Build", "Application version", C.BUILD_VERSION, C.BUILD_NAME);
    add("Build", "Import schema version", C.SUPPORTED_SCHEMA_VERSION, "");
    add("Build", "Generated", new Date().toISOString(), "Local browser clock");

    add("Offline integrity", "Status", intake.integrity.status, intake.integrity.detail);

    add("Intake", "Rows read", intake.counts.total, intake.sourceLabel);
    add("Intake", "Accepted", intake.counts.accepted, "");
    add("Intake", "Missing a required field", intake.counts.missingRequired, "Not imported");
    add("Intake", "Invalid field value", intake.counts.invalid, "Not imported");
    add("Intake", "Exact duplicates removed", intake.duplicatesRemoved, "");
    add("Intake", "Consolidation groups merged", intake.merges, "Reviewer decision");
    add("Intake", "Final scenario library", intake.finalCount, "");

    add("Optimization", "Business segment", C.SEGMENT_LABEL[result.segment], result.segment);
    add("Optimization", "Maximum scenarios per call", result.maxPerCall, "");
    add("Optimization", "Preferred minimum per call",
      Math.min(C.PREFERRED_MINIMUM, result.maxPerCall), "");
    add("Optimization", "Execution instances", result.instances.length, "");
    add("Optimization", "Physical calls", result.calls.length, "");
    add("Optimization", "Blocked scenarios", result.blocked.length,
      result.blocked.length ? "Listed on the Blocked Scenarios file" : "None");

    C.VENDORS.forEach(function (vendor) {
      const count = result.instances.filter(function (item) {
        return item.vendor === vendor;
      }).length;

      add("Optimization", vendor + " execution instances", count,
        count ? "Library and call plan files written" : "No files written");
    });

    result.validation.forEach(function (check) {
      add("Validation", check.label, check.status, check.detail);
    });

    result.blocked.forEach(function (entry) {
      add("Blocked scenario", entry.id, entry.reason, "Input row " + entry.sourceOrder);
    });

    return rows;
  }

  function blockedRows(result, casesById) {
    return result.blocked.map(function (entry) {
      const testCase = casesById.get(entry.id) || {};

      return {
        "Scenario ID": entry.id,
        "Business Segment": testCase.businessSegment || result.segment,
        "Population Applicability": "Not mapped",
        "Intent": testCase.intent || "",
        "Category": testCase.category || "",
        "Scenario": testCase.scenario || "",
        "Blocked Reason": entry.reason,
        "Source Validation": testCase.sourceValidationStatus || ""
      };
    });
  }

  function intakeLedgerRows(records) {
    return records.map(function (record) {
      return {
        "Input Row": record.rowNumber,
        "Scenario ID": record.scenarioId,
        "Disposition": record.disposition,
        "Detail": (record.problems || []).join(" | ")
      };
    });
  }

  const INTAKE_LEDGER_HEADERS = ["Input Row", "Scenario ID", "Disposition", "Detail"];

  function scenarioLibraryRows(cases, segment) {
    return cases.map(function (testCase) {
      return {
        "Scenario ID": testCase.id,
        "Vendor": testCase.vendor,
        "Business Segment": testCase.businessSegment,
        "Population Applicability": QA.model.populationLabel(testCase),
        "Release Date": testCase.releaseDate,
        "Intent": testCase.intent,
        "Category": testCase.category,
        "Scenario": testCase.scenario,
        "Conditions": (testCase.conditions || []).join("; "),
        "Expected Outcome": testCase.expectedOutcome,
        "Test Persona": testCase.testPersona,
        "Mock Data Persona": testCase.mockDataPersona,
        "Mock / Staging": testCase.mockStaging,
        "Routing ID": testCase.routingId,
        "Device": testCase.device,
        "ANI": testCase.ani,
        "Time Requirement": testCase.timeRequirement,
        "Terminal Type": testCase.terminalType,
        "Named Caller": testCase.userLabel,
        "Dependencies": (testCase.dependencies || []).join("; "),
        "Source File": testCase.sourceFile,
        "Source Location": testCase.sourceLocation,
        "Source Validation": testCase.sourceValidationStatus,
        "Clarification Needed": testCase.clarificationNeeded,
        "Notes": testCase.notes
      };
    });
  }

  const SCENARIO_LIBRARY_HEADERS = [
    "Scenario ID", "Vendor", "Business Segment", "Population Applicability",
    "Release Date", "Intent", "Category", "Scenario", "Conditions",
    "Expected Outcome", "Test Persona", "Mock Data Persona", "Mock / Staging",
    "Routing ID", "Device", "ANI", "Time Requirement", "Terminal Type",
    "Named Caller", "Dependencies", "Source File", "Source Location",
    "Source Validation", "Clarification Needed", "Notes"
  ];

  /* ------------------------------------------------------------
     DOWNLOADS

     A CSV holds one sheet, so a five-sheet workbook becomes five
     files. They are released a moment apart because browsers
     throttle a burst of downloads from one click.
     ------------------------------------------------------------ */

  const STAGGER_MS = 350;

  function downloadSet(files) {
    files.forEach(function (file, index) {
      window.setTimeout(function () {
        U.downloadTextFile(file.name, file.text, "text/csv");
      }, index * STAGGER_MS);
    });

    return files.map(function (file) { return file.name; });
  }

  function stamp() {
    const now = new Date();
    return now.getFullYear() +
      String(now.getMonth() + 1).padStart(2, "0") +
      String(now.getDate()).padStart(2, "0") + "-" +
      String(now.getHours()).padStart(2, "0") +
      String(now.getMinutes()).padStart(2, "0");
  }

  /* The full optimizer output: overview, then a library and a call
     plan for each vendor, plus blocked scenarios when there are any. */
  function buildCallPlanFiles(result, intake, casesById) {
    const base = U.safeFileBase(intake.fileBase || "QA_Call_Plan") + "_" + stamp();
    const files = [];

    files.push({
      name: base + "_1_Overview_and_Validation.csv",
      text: toCsv(C.OVERVIEW_EXPORT_HEADERS, overviewRows(result, intake))
    });

    /* A vendor with no scenarios in this run gets no files. An empty
       CSV with nothing but a header row tells a reader nothing and
       invites the question of whether something went missing. The
       overview sheet records which vendors were present. */
    C.VENDORS.forEach(function (vendor) {
      const library = libraryRows(result, vendor);
      const plan = callPlanRows(result, vendor);

      if (!library.length && !plan.length) {
        return;
      }

      const order = files.length + 1;

      files.push({
        name: base + "_" + order + "_" + vendor + "_Scenario_Library.csv",
        text: toCsv(C.LIBRARY_EXPORT_HEADERS, library)
      });

      files.push({
        name: base + "_" + (order + 1) + "_" + vendor + "_Call_Plan.csv",
        text: toCsv(C.CALL_PLAN_EXPORT_HEADERS, plan)
      });
    });

    if (result.blocked.length) {
      files.push({
        name: base + "_" + (files.length + 1) + "_Blocked_Scenarios.csv",
        text: toCsv(
          C.LIBRARY_EXPORT_HEADERS_UNASSIGNED,
          blockedRows(result, casesById)
        )
      });
    }

    return files;
  }

  function exportCallPlan(result, intake, casesById) {
    return downloadSet(buildCallPlanFiles(result, intake, casesById));
  }

  function exportScenarioLibrary(cases, segment, fileBase) {
    const name = U.safeFileBase(fileBase || "QA_Scenario_Library") + "_" +
      stamp() + "_Scenario_Library.csv";

    U.downloadTextFile(
      name,
      toCsv(SCENARIO_LIBRARY_HEADERS, scenarioLibraryRows(cases, segment)),
      "text/csv"
    );

    return [name];
  }

  function exportIntakeLedger(records, fileBase) {
    const name = U.safeFileBase(fileBase || "QA_Intake") + "_" +
      stamp() + "_Intake_Ledger.csv";

    U.downloadTextFile(
      name,
      toCsv(INTAKE_LEDGER_HEADERS, intakeLedgerRows(records)),
      "text/csv"
    );

    return [name];
  }

  return {
    csvField: csvField,
    toCsv: toCsv,
    libraryRows: libraryRows,
    callPlanRows: callPlanRows,
    overviewRows: overviewRows,
    scenarioLibraryRows: scenarioLibraryRows,
    intakeLedgerRows: intakeLedgerRows,
    buildCallPlanFiles: buildCallPlanFiles,
    exportCallPlan: exportCallPlan,
    exportScenarioLibrary: exportScenarioLibrary,
    exportIntakeLedger: exportIntakeLedger,
    SCENARIO_LIBRARY_HEADERS: SCENARIO_LIBRARY_HEADERS,
    INTAKE_LEDGER_HEADERS: INTAKE_LEDGER_HEADERS
  };
})();
