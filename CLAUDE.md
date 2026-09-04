# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An offline, single-page browser application ("Call Planner") that turns a
validated list of UAT test scenarios into a plan of physical phone calls and
exports the result as CSV. No build step, no package manager, no dependencies,
no network access. Twelve plain `<script>` files loaded in a fixed order.

## Running and verifying

There is nothing to install and nothing to compile.

```bash
# Open directly — this is the whole process
open index.html

# Or serve locally, which makes Firefox/Safari actually enforce the CSP
python3 -m http.server 8777   # then http://127.0.0.1:8777/index.html
```

The test suite is twenty checks that build their own data in memory. Run it
from **Run the built-in test suite** at the bottom of the left spine, or from
the browser console:

```js
QA.selftest.run()          // → { total, passed, failed, results }
window.QA_SELF_TEST        // last run's summary, also set by the UI
```

To run a single check, call its entry directly — `TESTS` is an array of
`[name, fn]` pairs and each `fn` returns `{ pass, detail }`:

```js
QA.selftest.TESTS.find(t => t[0].startsWith("T18"))[1]()
```

Run the full twenty after any change under `js/`. All twenty must pass; a
failure here is the only regression signal this project has.

## Architecture

### Load order is the dependency graph

Every file attaches one closure to the global `QA` namespace
(`QA.constants`, `QA.utils`, `QA.classify`, `QA.model`, `QA.schema`,
`QA.importer`, `QA.consolidate`, `QA.optimizer`, `QA.exporter`,
`QA.selftest`, `QA.ui`). The numeric prefixes are load order, declared once in
the `<script>` block at the bottom of `index.html`, and **a file may only use
the ones before it**. There are no modules, no bundler and no import
statements — that ordering is the entire dependency system, so reordering the
tags breaks the app. No function is ever reassigned or monkey-patched; a
previous build did that and it is what this rebuild exists to undo.

### The pipeline

`11-ui.js` holds all state and orchestrates; it contains no planning rules of
its own. Data flows one way:

1. **`06-import.js`** reads `.json` packages or `.csv`/`.tsv` exports via
   `FileReader`. No spreadsheet library exists here, so `.xlsx` is never read
   directly — save as CSV first. This is deliberate: a library would be a
   download and an audit surface.
2. **`05-schema.js`** validates every row against the field contract and
   attaches a `DISPOSITION` (`ACCEPTED`, `INVALID_FIELD`, `MISSING_REQUIRED`,
   `EXACT_DUPLICATE`).
3. **`07-consolidate.js`** removes exact duplicates automatically; near
   duplicates are grouped and scored but *never* removed by the app.
4. **`08-optimizer.js`** packs scenarios into calls. This is the heart.
5. **`09-export.js`** writes CSV keyed by column name.

`03-classify.js` (pattern-matching over scenario wording) and `04-model.js`
(the case shape plus its cached `structuredSignature`) feed stages 2–4.
Signatures are computed once and memoized because rebuilding them inside the
packing loop was the previous build's main cost.

### Two invariants that constrain almost every edit

**Determinism.** The same scenarios must produce the same plan on any machine,
regardless of source row order. `08-optimizer.js` therefore walks every group
via `U.sortedEntries` in sorted key order, never arrival order, and every sort
ends in a tie-break (`sortKey`, built from scenario ID and population — never
the source row number). Check T18 proves this by reversing the input rows.
Anything you add that iterates a collection must preserve this.

**Nothing dropped, nothing invented.** Every input row leaves validation
with a disposition attached, and `O.validate()` asserts the input and output
execution-key sets are identical. A field that cannot be read is reported, not
guessed.

### Hard boundaries vs. soft preferences

`boundaryKey()` and `canJoin()` in `08-optimizer.js` are the authority. Hard
boundaries are never crossed under any circumstance: vendor, business segment,
release date, population, named caller, device, ANI, time of day, routing ID,
at most one hard terminal per call (running last), and the capacity ceiling.
Soft preferences — the preferred minimum per call, grouping by shared
intent or test data — are improved where possible and flagged, never
enforced. A regroup pass only accepts a change that measurably improves
the plan.

### Segment A vs. Segment B

Segment is chosen at load time and locked once scenarios are loaded. A Segment
A scenario becomes one execution instance. A **Segment B scenario fans
out into one instance per population it applies to**, each carrying that
population's own routing ID and test data — so scenario count and
execution count differ. A Segment B scenario with no population mapping
is held back and listed
(`SEGMENT_B_POPULATION_MAPPING_REQUIRED`), never spread across all three and
never dropped.

### The offline guarantee is load-bearing

Three layers, and `js/00-integrity.js` must load first: the CSP in
`index.html`, unconditional replacement of every network-reaching browser API,
and a post-load resource audit with a `MutationObserver`. `11-ui.js` calls
`QA.integrity.assertSafe()` at both the import and the export entry points, so
either refuses to run if the audit failed. Never add a CDN reference, a remote
font, or a fetch — the app fails closed, and check T20 asserts it.

## Where to change things

`js/01-constants.js` is a settings sheet, not logic: limits, segment and
population codes, recognised spreadsheet column headings and aliases, export
column lists, known intents, stage ranks. Export order comes from walking the
header lists there, so renaming or reordering a column needs no other edit.
New scenario wording goes in `03-classify.js`; new import fields in
`05-schema.js`; on-screen text in `index.html`.

`docs/making-changes.md` is written for non-developers and is the canonical
task-by-task guide; `docs/import-schema.md` is the full field contract.

## Conventions

- ES5-style function expressions inside `"use strict"` IIFEs — match it.
- Prose in Markdown is hand-wrapped at 78 columns. `.markdownlint.json`
  disables MD013 only because table rows cannot be wrapped.
- Comments here explain *why*, often at length, and are aimed partly at
  non-developers. Preserve that register rather than stripping them.

## The `docs/` fixtures

The flow PDFs/HTML and UAT workbooks in `docs/` are **synthetic fixtures with
no requirement authority** — generated to exercise the scenario-building
process, and intentionally containing detached frames, unmapped branches and
open questions. They are gitignored. Vendor names in them are deliberate
placeholders (`Vendor Alpha`, `Vendor Bravo`); keep using placeholders rather
than real vendor names in anything generated here, and keep the two vendors'
workstreams in separate workbooks — no requirement, term, assumption or
expected behavior is ever carried between them.
