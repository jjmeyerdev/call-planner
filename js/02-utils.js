/* ==============================================================
   02-utils.js
   --------------------------------------------------------------
   Small, general-purpose helpers used everywhere else.
   Nothing in this file knows anything about test cases.
   ============================================================== */

window.QA = window.QA || {};

QA.utils = (function () {
  "use strict";

  const C = QA.constants;

  /* ------------------------------------------------------------
     TEXT
     ------------------------------------------------------------ */

  function rawString(value) {
    if (value === null || value === undefined) {
      return "";
    }
    return String(value);
  }

  /* Trim and normalise line endings. Use for anything a person reads. */
  function cleanText(value) {
    return rawString(value)
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .trim();
  }

  /* Flatten to lowercase words. Use for comparing, never for display. */
  function matchText(value) {
    return cleanText(value)
      .toLowerCase()
      .replace(/\n/g, " ")
      .replace(/[._/\\()[\]{}-]/g, " ")
      .replace(/#/g, " number ")
      .replace(/&/g, " and ")
      .replace(/[?]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  /* Turn free text into an ENUM_STYLE_TOKEN. */
  function enumText(value) {
    return cleanText(value)
      .toUpperCase()
      .replace(/[\s/-]+/g, "_");
  }

  /* De-duplicate a list of strings, keeping the first spelling seen. */
  function unique(values) {
    const output = [];
    const seen = new Set();

    for (const value of values || []) {
      const text = cleanText(value);
      if (!text) {
        continue;
      }
      const key = text.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        output.push(text);
      }
    }

    return output;
  }

  function formatFileSize(bytes) {
    if (!Number.isFinite(bytes)) {
      return "";
    }
    if (bytes < 1024) {
      return bytes + " B";
    }
    if (bytes < 1024 * 1024) {
      return (bytes / 1024).toFixed(1) + " KB";
    }
    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  }

  function splitList(value) {
    return rawString(value)
      .split(/[\n;|]+/)
      .map(function (item) { return item.trim(); })
      .filter(Boolean);
  }

  /* Pull the first phone-number-shaped or ID-shaped token out of text. */
  function firstPhone(value) {
    const text = cleanText(value);
    if (!text) {
      return "";
    }

    const match = text.match(
      /(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}/
    );

    return match ? match[0].trim() : text.split(/\n/)[0].trim();
  }

  function safeFileBase(value) {
    return (
      cleanText(value)
        .replace(/\.(csv|tsv|json|xlsx)$/i, "")
        .replace(/[\\/:*?"<>|]/g, "_") || "QA_Output"
    );
  }

  /* ------------------------------------------------------------
     DATES

     Ambiguous formats are rejected on purpose. "03/04/2026" means
     March 4th in the United States and April 3rd almost everywhere
     else, and the browser's answer depends on the machine's locale.
     A silently wrong release date silently corrupts a call plan,
     so this function refuses to guess.
     ------------------------------------------------------------ */

  const MONTH_NAMES = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december"
  ];

  /* Returns { ok, value, reason }. value is always YYYY-MM-DD when ok. */
  function parseDate(value) {
    const text = cleanText(value);

    if (!text) {
      return { ok: true, value: "", reason: "" };
    }

    /* YYYY-MM-DD or YYYY/MM/DD - unambiguous, the only accepted numeric form. */
    const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (iso) {
      return buildDate(
        Number(iso[1]),
        Number(iso[2]),
        Number(iso[3]),
        text
      );
    }

    /* "4 March 2026" and "March 4, 2026" - unambiguous because the
       month is spelled out. */
    const dayFirst = text.match(/^(\d{1,2})\s+([A-Za-z]{3,})\.?,?\s+(\d{4})$/);
    if (dayFirst) {
      const monthIndex = monthNumber(dayFirst[2]);
      if (monthIndex > 0) {
        return buildDate(Number(dayFirst[3]), monthIndex, Number(dayFirst[1]), text);
      }
    }

    const monthFirst = text.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
    if (monthFirst) {
      const monthIndex = monthNumber(monthFirst[1]);
      if (monthIndex > 0) {
        return buildDate(Number(monthFirst[3]), monthIndex, Number(monthFirst[2]), text);
      }
    }

    if (/^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(text)) {
      return {
        ok: false,
        value: "",
        reason:
          'Ambiguous date "' + text +
          '". Day/month order cannot be determined. Use YYYY-MM-DD.'
      };
    }

    return {
      ok: false,
      value: "",
      reason: 'Unrecognised date "' + text + '". Use YYYY-MM-DD.'
    };
  }

  function monthNumber(name) {
    const key = cleanText(name).toLowerCase().replace(/\.$/, "");
    for (let index = 0; index < MONTH_NAMES.length; index++) {
      if (MONTH_NAMES[index] === key || MONTH_NAMES[index].slice(0, 3) === key) {
        return index + 1;
      }
    }
    return 0;
  }

  function buildDate(year, month, day, original) {
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return {
        ok: false,
        value: "",
        reason: 'Impossible date "' + original + '".'
      };
    }

    const check = new Date(Date.UTC(year, month - 1, day));

    if (
      check.getUTCFullYear() !== year ||
      check.getUTCMonth() !== month - 1 ||
      check.getUTCDate() !== day
    ) {
      return {
        ok: false,
        value: "",
        reason: 'Impossible date "' + original + '".'
      };
    }

    return {
      ok: true,
      value:
        year + "-" +
        String(month).padStart(2, "0") + "-" +
        String(day).padStart(2, "0"),
      reason: ""
    };
  }

  /* Convenience wrapper for places that only want the string. */
  function normalizeDate(value) {
    const parsed = parseDate(value);
    return parsed.ok ? parsed.value : "";
  }

  /* ------------------------------------------------------------
     SIMILARITY
     ------------------------------------------------------------ */

  /* Split text into meaningful words. The stop-word list is built
     once in 01-constants.js rather than rebuilt on every call. */
  function tokenSet(value) {
    return new Set(
      matchText(value)
        .split(" ")
        .filter(function (word) {
          return word.length > 2 && !C.STOP_WORDS.has(word);
        })
    );
  }

  function toSet(value) {
    return value instanceof Set ? value : new Set(value || []);
  }

  /* Overlap between two word sets, 0 to 1. */
  function jaccardSets(first, second) {
    const a = toSet(first);
    const b = toSet(second);

    if (!a.size && !b.size) {
      return 1;
    }
    if (!a.size || !b.size) {
      return 0;
    }

    let shared = 0;
    for (const value of a) {
      if (b.has(value)) {
        shared++;
      }
    }

    return shared / new Set([...a, ...b]).size;
  }

  function textTieBreak(first, second) {
    return jaccardSets(tokenSet(first), tokenSet(second));
  }

  /* ------------------------------------------------------------
     SORTING

     Every sort in this application ends in a tie-break that cannot
     produce two different answers for the same data. That is what
     makes the optimizer deterministic.
     ------------------------------------------------------------ */

  function compareText(first, second) {
    const a = rawString(first);
    const b = rawString(second);
    if (a < b) { return -1; }
    if (a > b) { return 1; }
    return 0;
  }

  /* Sort the entries of a Map by key so iteration never depends on
     the order rows happened to arrive in. */
  function sortedEntries(map) {
    return [...map.entries()].sort(function (first, second) {
      return compareText(first[0], second[0]);
    });
  }

  /* ------------------------------------------------------------
     FILE DOWNLOAD

     The object URL is released when the tab regains focus, or after
     a generous timeout, whichever happens first. Releasing it a
     second later - as the previous build did - broke downloads on
     machines where a virus scanner delayed the save dialog.
     ------------------------------------------------------------ */

  const RELEASE_TIMEOUT_MS = 120000;

  function downloadTextFile(fileName, text, mimeType) {
    const blob = new Blob([text], {
      type: (mimeType || "text/plain") + ";charset=utf-8"
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = fileName;
    link.rel = "noopener";
    link.hidden = true;

    document.body.appendChild(link);
    link.click();
    link.remove();

    let released = false;

    const release = function () {
      if (released) {
        return;
      }
      released = true;
      window.removeEventListener("focus", onFocus);
      URL.revokeObjectURL(url);
    };

    const onFocus = function () {
      /* Give the browser a moment to finish reading the blob. */
      window.setTimeout(release, 2000);
    };

    window.addEventListener("focus", onFocus);
    window.setTimeout(release, RELEASE_TIMEOUT_MS);
  }

  function pluralise(count, singular, plural) {
    return count === 1 ? singular : (plural || singular + "s");
  }

  return {
    rawString: rawString,
    cleanText: cleanText,
    matchText: matchText,
    enumText: enumText,
    unique: unique,
    formatFileSize: formatFileSize,
    splitList: splitList,
    firstPhone: firstPhone,
    safeFileBase: safeFileBase,

    parseDate: parseDate,
    normalizeDate: normalizeDate,

    tokenSet: tokenSet,
    jaccardSets: jaccardSets,
    textTieBreak: textTieBreak,

    compareText: compareText,
    sortedEntries: sortedEntries,

    downloadTextFile: downloadTextFile,
    pluralise: pluralise
  };
})();
