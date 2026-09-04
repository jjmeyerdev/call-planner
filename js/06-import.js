/* ==============================================================
   06-import.js
   --------------------------------------------------------------
   Reads files into memory. Nothing here touches the network.

   Two shapes of input are understood:

     .json   a structured package produced upstream, validated
             against the contract in 05-schema.js

     .csv    a spreadsheet exported as comma or tab separated
     .tsv    text, matched against the known column layouts

   Everything is read with the browser's own FileReader. There is
   no spreadsheet library, so .xlsx is not read directly: save the
   sheet as CSV first. The trade is deliberate - a CSV cannot carry
   colours or formulas, but it opens in Excel and it means this
   application has nothing to download and nothing to break.
   ============================================================== */

window.QA = window.QA || {};

QA.importer = (function () {
  "use strict";

  const C = QA.constants;
  const U = QA.utils;
  const S = QA.schema;

  /* ------------------------------------------------------------
     READING A FILE
     ------------------------------------------------------------ */

  function readFileAsText(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();

      reader.onload = function () {
        /* Strip a byte-order mark if the file was saved from Excel. */
        resolve(String(reader.result).replace(/^﻿/, ""));
      };

      reader.onerror = function () {
        reject(new Error("Could not read " + file.name + "."));
      };

      reader.readAsText(file);
    });
  }

  /* ------------------------------------------------------------
     DELIMITED TEXT

     A hand-written parser that follows the usual CSV conventions:
     fields may be wrapped in double quotes, a quoted field may
     contain the delimiter and line breaks, and a doubled quote
     inside a quoted field means one literal quote.
     ------------------------------------------------------------ */

  function detectDelimiter(text, fileName) {
    if (/\.tsv$/i.test(fileName || "")) {
      return "\t";
    }

    const firstLine = text.split(/\r?\n/)[0] || "";
    const tabs = (firstLine.match(/\t/g) || []).length;
    const commas = (firstLine.match(/,/g) || []).length;
    const semicolons = (firstLine.match(/;/g) || []).length;

    if (tabs > commas && tabs > semicolons) {
      return "\t";
    }
    if (semicolons > commas) {
      return ";";
    }
    return ",";
  }

  function parseDelimited(text, delimiter) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    let index = 0;

    while (index < text.length) {
      const character = text[index];

      if (inQuotes) {
        if (character === '"') {
          if (text[index + 1] === '"') {
            field += '"';
            index += 2;
            continue;
          }
          inQuotes = false;
          index++;
          continue;
        }
        field += character;
        index++;
        continue;
      }

      if (character === '"') {
        inQuotes = true;
        index++;
        continue;
      }

      if (character === delimiter) {
        row.push(field);
        field = "";
        index++;
        continue;
      }

      if (character === "\n" || character === "\r") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
        index += character === "\r" && text[index + 1] === "\n" ? 2 : 1;
        continue;
      }

      field += character;
      index++;
    }

    row.push(field);
    rows.push(row);

    /* Drop rows that are entirely empty, which trailing newlines create. */
    return rows.filter(function (candidate) {
      return candidate.some(function (value) { return U.cleanText(value); });
    });
  }

  /* ------------------------------------------------------------
     COLUMN MATCHING
     ------------------------------------------------------------ */

  function headerIndex(headers, name) {
    const wanted = U.matchText(name);

    for (let index = 0; index < headers.length; index++) {
      if (U.matchText(headers[index]) === wanted) {
        return index;
      }
    }

    return -1;
  }

  function valueByHeader(row, headers, name) {
    const index = headerIndex(headers, name);
    return index >= 0 ? U.rawString(row[index]) : "";
  }

  function valueByAliases(row, headers, aliases) {
    for (const alias of aliases) {
      const index = headerIndex(headers, alias);
      if (index >= 0) {
        const value = U.rawString(row[index]);
        if (U.cleanText(value)) {
          return value;
        }
      }
    }
    return "";
  }

  /* How many of a layout's columns are present, as a fraction. */
  function layoutScore(headers, expected) {
    let hits = 0;

    for (const name of expected) {
      if (headerIndex(headers, name) >= 0) {
        hits++;
      }
    }

    return hits / expected.length;
  }

  const LAYOUTS = [
    { name: "MASTER", headers: C.MASTER_HEADERS },
    { name: "SEGMENT_A", headers: C.SEGMENT_A_HEADERS },
    { name: "SEGMENT_B", headers: C.SEGMENT_B_HEADERS }
  ];

  function detectLayout(headers) {
    const scored = LAYOUTS
      .map(function (layout) {
        return { name: layout.name, score: layoutScore(headers, layout.headers) };
      })
      .sort(function (first, second) {
        return second.score - first.score || U.compareText(first.name, second.name);
      });

    const best = scored[0];

    if (!best || best.score < 0.5) {
      return { name: "", score: best ? best.score : 0, candidates: scored };
    }

    return { name: best.name, score: best.score, candidates: scored };
  }

  /* ------------------------------------------------------------
     SPREADSHEET ROW TO TEST CASE

     Produces the same validation records the package importer
     produces, so both routes report identically.
     ------------------------------------------------------------ */

  function rowToRawScenario(row, headers, layout, segment, defaults) {
    const A = C.MASTER_HEADER_ALIASES;

    const scenarioId =
      U.cleanText(valueByAliases(row, headers, A.scenarioNumber)) ||
      U.cleanText(valueByHeader(row, headers, "Scenario #")) ||
      U.cleanText(valueByHeader(row, headers, "TC#"));

    const raw = {
      scenarioId: scenarioId,
      vendor: defaults.vendor,
      businessSegment: segment,
      releaseDate: defaults.releaseDate,

      category: U.cleanText(valueByAliases(row, headers, A.category)),
      scenario: U.cleanText(valueByAliases(row, headers, A.scenario)),
      expectedOutcome:
        U.cleanText(valueByAliases(row, headers, A.passCriteria)) ||
        U.cleanText(valueByHeader(row, headers, "Agent Expectation")),

      sourcePassCriteria: U.cleanText(valueByAliases(row, headers, A.passCriteria)),
      agentExpectation: U.cleanText(valueByHeader(row, headers, "Agent Expectation")),
      notes: U.cleanText(valueByHeader(row, headers, "Notes")),

      testPersona: U.cleanText(valueByAliases(row, headers, A.testPersona)),
      testDataProfile: U.cleanText(valueByAliases(row, headers, A.mockDataPersona)),
      mockStaging: U.cleanText(valueByAliases(row, headers, A.mockStaging)),

      routingId: U.cleanText(valueByAliases(row, headers, A.routingId)),
      routingIdPopA: U.cleanText(valueByHeader(row, headers, "Routing ID POPA")),
      routingIdPopB: U.cleanText(valueByHeader(row, headers, "Routing ID POPB")),
      routingIdPopC: U.cleanText(valueByHeader(row, headers, "Routing ID PopC")),
      testDataPopA: U.cleanText(valueByHeader(row, headers, "Test data POPA")),
      testDataPopB: U.cleanText(valueByHeader(row, headers, "POPB Test Data")),
      testDataPopC: U.cleanText(valueByHeader(row, headers, "PopC Test Data")),

      sourceFile: defaults.sourceFile,
      sourceLocation: layout + " row " + defaults.rowNumber,
      sourceValidationStatus: "NOT_VALIDATED"
    };

    /* The intent column is optional in spreadsheets. When it is
       missing the classifier reads it from the scenario wording. */
    raw.intent =
      U.cleanText(valueByHeader(row, headers, "Intent")) ||
      QA.classify.findIntent(
        raw.category + " " + raw.scenario + " " + raw.expectedOutcome,
        "Other"
      );

    if (segment === C.SEGMENT.B) {
      raw.populationApplicability = populationsFromRow(row, headers);
    }

    return raw;
  }

  /* Segment B population applicability is taken from explicit
     per-population columns first, and from the Business Segment
     column only when those columns are absent. Nothing is inferred
     from prose. */
  function populationsFromRow(row, headers) {
    const labels = [];

    const columnPairs = [
      ["Population A", ["Routing ID POPA", "Test data POPA", "UAT Ready POPA"]],
      ["Population B", ["Routing ID POPB", "POPB Test Data", "UAT Ready POPB"]],
      ["Population C", ["Routing ID PopC", "PopC Test Data", "UAT Ready PopC"]]
    ];

    for (const pair of columnPairs) {
      const hasValue = pair[1].some(function (name) {
        return U.cleanText(valueByHeader(row, headers, name));
      });

      if (hasValue) {
        labels.push(pair[0]);
      }
    }

    if (labels.length) {
      return labels;
    }

    const declared = U.cleanText(valueByHeader(row, headers, "Business Segment"));

    for (const population of C.POPULATIONS) {
      const pattern = new RegExp(
        "\\b" + population.label.replace(/\s+/g, "\\s*") + "\\b|\\b" + population.code + "\\b",
        "i"
      );
      if (pattern.test(declared)) {
        labels.push(population.label);
      }
    }

    return labels;
  }

  /* ------------------------------------------------------------
     PUBLIC ENTRY POINTS
     ------------------------------------------------------------ */

  /* Reads a structured package. Returns a result object that always
     includes a record for every input row. */
  async function importPackageFile(file) {
    const text = await readFileAsText(file);

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      return {
        ok: false,
        source: file.name,
        format: "JSON package",
        errors: ["Malformed JSON: " + error.message],
        records: [],
        accepted: [],
        counts: { total: 0, accepted: 0, invalid: 0, missingRequired: 0 },
        sourceMetadata: {}
      };
    }

    const envelope = S.validatePackage(parsed);

    if (!envelope.ok) {
      return {
        ok: false,
        source: file.name,
        format: "JSON package",
        errors: envelope.errors,
        records: [],
        accepted: [],
        counts: { total: 0, accepted: 0, invalid: 0, missingRequired: 0 },
        sourceMetadata: envelope.sourceMetadata
      };
    }

    const validated = S.validateScenarios(envelope.scenarios);

    validated.accepted.forEach(function (testCase) {
      testCase.sourceFile = testCase.sourceFile || file.name;
    });

    return {
      ok: true,
      source: file.name,
      format: "JSON package",
      errors: [],
      records: validated.records,
      accepted: validated.accepted,
      counts: validated.counts,
      sourceMetadata: envelope.sourceMetadata
    };
  }

  /* Reads a delimited spreadsheet export. options carries the
     vendor, release date and segment the operator selected, since
     a spreadsheet usually does not name them. */
  async function importDelimitedFile(file, options) {
    const text = await readFileAsText(file);
    const delimiter = detectDelimiter(text, file.name);
    const rows = parseDelimited(text, delimiter);

    if (rows.length < 2) {
      return {
        ok: false,
        source: file.name,
        format: "Delimited",
        errors: ["The file has a header row but no data rows."],
        records: [],
        accepted: [],
        counts: { total: 0, accepted: 0, invalid: 0, missingRequired: 0 },
        layout: ""
      };
    }

    const headers = rows[0].map(U.cleanText);
    const layout = detectLayout(headers);

    if (!layout.name) {
      return {
        ok: false,
        source: file.name,
        format: "Delimited",
        errors: [
          "The column headings do not match any known layout. Best match was " +
          layout.candidates[0].name + " at " +
          Math.round(layout.candidates[0].score * 100) + "%.",
          "Found: " + headers.join(", ")
        ],
        records: [],
        accepted: [],
        counts: { total: 0, accepted: 0, invalid: 0, missingRequired: 0 },
        layout: ""
      };
    }

    const scenarios = rows.slice(1).map(function (row, index) {
      return rowToRawScenario(row, headers, layout.name, options.segment, {
        vendor: options.vendor,
        releaseDate: options.releaseDate,
        sourceFile: file.name,
        rowNumber: index + 2
      });
    });

    const validated = S.validateScenarios(scenarios);

    validated.accepted.forEach(function (testCase) {
      testCase.inputSchema = layout.name;
    });

    return {
      ok: true,
      source: file.name,
      format: "Delimited (" + (delimiter === "\t" ? "tab" : delimiter) + ")",
      errors: [],
      records: validated.records,
      accepted: validated.accepted,
      counts: validated.counts,
      layout: layout.name,
      headers: headers
    };
  }

  async function importFile(file, options) {
    if (/\.json$/i.test(file.name)) {
      return importPackageFile(file);
    }
    return importDelimitedFile(file, options);
  }

  return {
    readFileAsText: readFileAsText,
    detectDelimiter: detectDelimiter,
    parseDelimited: parseDelimited,
    detectLayout: detectLayout,
    headerIndex: headerIndex,
    valueByHeader: valueByHeader,
    valueByAliases: valueByAliases,
    importFile: importFile,
    importPackageFile: importPackageFile,
    importDelimitedFile: importDelimitedFile
  };
})();
