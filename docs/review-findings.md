# What the code review asked for, and where it was done

This rebuild answers the two review documents. Every finding is listed
here with the file that addresses it, so a reviewer can check the work
without reading the whole codebase.

## Architecture decision

The review recommended retiring the local diagram and specification
reader. That recommendation was accepted. The PDF, OCR and DOCX parsing
engine is gone, and with it the four stacked overlay scripts that patched
each other at runtime, roughly 12,000 lines and three of the five external
dependencies.

The application now does one job: import a validated scenario package,
consolidate it, plan calls from it, and export the result.

## Blockers

| # | Finding | Where it is answered |
| --- | --- | --- |
| F1 | Five CDN `<script>` tags | No external resources at all. Everything is local. `js/00-integrity.js` audits the page after load and fails closed. |
| F2 | Four-deep monkey-patch chain across overlay scripts | Gone. Twelve plain files, each using only the ones before it. No function is ever reassigned. |

## Critical

| # | Finding | Where it is answered |
| --- | --- | --- |
| F3 | The network block only armed in test builds | `js/00-integrity.js` closes `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, `Worker`, `SharedWorker` and service worker registration unconditionally, at load. A Content Security Policy in `index.html` is the second layer, and a resource audit with a `MutationObserver` is the third. Import and export both call `assertSafe()` and refuse to run if the audit failed. |
| F4 | PDF.js worker fetched from a CDN | The PDF engine is gone. |
| F5 | Race between overlay installations | No overlays. One load order, declared once in `index.html`. |

## High

| # | Finding | Where it is answered |
| --- | --- | --- |
| F6 | Greedy packing is order-dependent | `js/08-optimizer.js`. Every group is walked in sorted key order via `U.sortedEntries`, never in arrival order. Every sort ends in `sortKey`, which is built from the scenario ID and population only — never the source row number — so re-ordering the input file cannot change the plan. Check T18 proves it by reversing the rows. |
| F7 | `executionKey` collisions could silently lose a scenario | The validator rejects duplicate scenario IDs at import, and `validate()` asserts that the input and output execution-key sets are identical: nothing missing, nothing doubled, nothing invented. |
| F8 | Segment chosen at export time, not at load time | `js/11-ui.js`. The segment switch is disabled the moment scenarios are loaded, and the spine says so. Clearing the workspace unlocks it. |
| F9 | Column-position-dependent export | `js/09-export.js` builds every row as `{ "Column Name": value }` and writes the file by walking the header list from `js/01-constants.js`. A column cannot land in the wrong place, and reordering the header list reorders the file with no other change. |
| F10 | `structuredSignatureFromCase` recomputed inside the packing loop | `js/04-model.js` caches each signature in a `WeakMap` keyed on the scenario object. Cloning a scenario correctly produces a fresh signature. |

## Medium and low

| # | Finding | Where it is answered |
| --- | --- | --- |
| F11 | Tesseract and the other reader dependencies are dead weight | Removed with the reader. |
| F12 | Object URL revoked after one second | `js/02-utils.js` releases it when the tab regains focus, or after two minutes, whichever comes first. |
| F13 | Jaccard similarity is sensitive to vocabulary quirks | `js/07-consolidate.js` runs eleven hard gates before any score is computed, buckets candidates so unrelated rows are never compared, and requires at least one substantive dimension to overlap. Nothing is ever merged automatically: groups are surfaced for a person. |
| F14 | `new Date(text)` parses ambiguous dates by locale | `js/02-utils.js` accepts only unambiguous forms and refuses `03/04/2026` with a message naming the problem. |
| F15 | Three identical `"Routing ID"` alias entries | `js/01-constants.js` alias lists carry no duplicates. |
| F16 | `stopWords` rebuilt on every call | Built once as `STOP_WORDS` in `js/01-constants.js`. |

## Optimizer audit

The review asked for a deterministic objective and a regrouping pass that
cannot make the plan worse.

`js/08-optimizer.js` sorts by `[constraintScore descending, sortKey
ascending]` and packs most-constrained-first. The regrouping pass runs
three strategies — fold a whole small call into another, scatter a small
call across the others, borrow one scenario into a small call — and each
proposed change is scored against this objective before it is accepted:

```text
[ calls below the preferred minimum,
  calls holding one scenario,
  calls holding two scenarios,
  total calls ]
```

Smaller is better, compared left to right. A change that does not improve
the vector is discarded. The previous build applied merges without this
check, which is how a merge could leave two undersized calls where one had
stood.

## Offline and privacy design

- No external resource of any kind.
- A Content Security Policy with `default-src 'none'` and
  `connect-src 'none'`.
- Every network API replaced with one that refuses.
- A page audit on load, plus a `MutationObserver` that keeps watching.
- Import and export refuse to run if the audit has failed.
- Nothing is written to `localStorage`, `sessionStorage` or IndexedDB.
  Closing the tab leaves nothing behind.
- The browser caveat is documented in the README: Chrome and Edge enforce
  CSP on `file://`, Firefox and Safari do not do so reliably, so serving
  from `localhost` is offered as the stronger option.

## Import schema

Implemented as version 1.0 in `js/05-schema.js`, documented in
[import-schema.md](import-schema.md). Every input row leaves the import
with one of four dispositions, all of which are shown on screen and
exported. Nothing is dropped in silence, and the reconciliation arithmetic
on screen always closes.

The one deliberate departure from the review's draft schema: the review
suggested bundling a JSON Schema validator. This build validates against a
field list instead, in about 200 readable lines, because pulling in a
library would mean shipping a download into a build whose entire point is
that it has none.

## Regression test matrix

All twenty checks from the review are implemented in `js/10-selftest.js`
and run from the link in the left spine. They build their own data in
memory and touch nothing the user has loaded.

| Check | What it proves |
| --- | --- |
| T1 | Vendor boundary |
| T2 | Business segment boundary |
| T3 | Population separation, one call per population |
| T4 | Release boundary, and call numbering restarting per release |
| T5 | A hard terminal is the last step of its call |
| T6 | Device compatibility |
| T7 | ANI compatibility |
| T8 | Time compatibility |
| T9 | Routing ID compatibility |
| T10 | Capacity ceiling |
| T11 | Preferred minimum packing |
| T12 | Exact duplicate removal |
| T13 | Consolidation review surfaced, not applied |
| T14 | An unmapped population scenario is held back and listed |
| T15 | Complete coverage, nothing invented |
| T16 | CSV round trip preserves quotes, commas and line breaks |
| T17 | Import validation reports every row and names the field |
| T18 | Same input, same plan, whatever the row order |
| T19 | An empty population list means unmapped, not all |
| T20 | Offline integrity |

## The dependency trade

The review noted that keeping XLSX support means keeping SheetJS and
ExcelJS. This build drops both and uses CSV.

What is lost: cell colours, column widths, frozen panes, and a single file
holding several sheets. A five-sheet workbook now arrives as five CSV
files.

What is gained: nothing to download, nothing to licence, nothing to
inline, nothing that can be blocked, and nothing that can be deprecated
out from under the application. In a locked-down environment that is the
better side of the trade, and it is the reason the offline guarantee in
this build is a fact about the file listing rather than a promise about
runtime behaviour.
