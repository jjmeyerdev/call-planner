# Call Planner

[![Self-tests](https://github.com/jjmeyerdev/call-planner/actions/workflows/self-test.yml/badge.svg)](https://github.com/jjmeyerdev/call-planner/actions/workflows/self-test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

An offline workspace that turns a validated list of test scenarios into a
plan of physical phone calls, and writes the result out as CSV files.

It runs entirely inside a browser tab. It has no dependencies, no build
step, no installer, and no network access of any kind.

## Running it

Double-click `index.html`. That is the whole process.

For the strongest offline guarantee, serve the folder from a local static
server instead. Chrome and Edge enforce a Content Security Policy on a
`file://` page; Firefox and Safari do not enforce it reliably, so on those
two browsers the policy only becomes binding when the page is served over
`localhost`. Any static server will do:

```bash
cd "path/to/this/folder"
python3 -m http.server 8777
```

Then open <http://127.0.0.1:8777/index.html>. Nothing leaves the machine
either way; serving locally only makes the browser enforce the policy.

## What it does

1. **Import.** Load a `.json` scenario package or a `.csv` / `.tsv`
   spreadsheet export.
2. **Validate.** Every row is checked field by field. Every row is
   reported back, whether it was accepted or not. Nothing is dropped in
   silence.
3. **Consolidate.** Rows that are literally identical are removed and
   listed. Rows that merely look alike are grouped and left for a person
   to decide about.
4. **Optimize.** Scenarios are packed into the fewest calls their
   constraints allow, without ever crossing a hard boundary.
5. **Export.** The plan is written as CSV files that open directly in
   Excel.

## The rules the planner will not break

These are enforced by the code and re-checked after every run. If any of
them fails, the plan cannot be exported.

| Boundary | Meaning |
| --- | --- |
| Vendor | Two vendors never share a call |
| Business segment | Segment A and Segment B never share a call |
| Release date | Two releases never share a call |
| Population | Population A, B and C never share a call |
| Named caller | Two different named callers never share a call |
| Device | Mobile-only and landline-only never share a call |
| ANI | Recognised and unrecognised never share a call |
| Time of day | Business-hours-only and after-hours-only never share a call |
| Routing ID | Two different routing IDs never share a call |
| Test data | Contradictory test-data conditions never share a call |
| Hard terminal | At most one per call, and it runs last |
| Capacity | Never more than the maximum you set, up to 8 |

The planner also *prefers* at least three scenarios per call, but that is
a preference. When constraints make it impossible, the call is flagged
rather than the constraint being broken.

## Same input, same plan

The planner is deterministic. The same scenarios produce the same call
plan every time, on every machine, regardless of the order the rows
appeared in the source file. If you ever see two runs of the same data
disagree, that is a bug worth reporting.

## Spreadsheets

The application reads and writes CSV, not XLSX. This is a deliberate
trade: reading Excel's own format needs a third-party library, and a
third-party library is a download, a licence, and something that can
break. CSV is built into the browser and into Excel.

**To load a spreadsheet:** in Excel, File, Save As, and choose
*CSV UTF-8 (Comma delimited)*.

**When you export:** a CSV holds one sheet, so a five-sheet workbook
arrives as five files. Your browser will ask once for permission to save
several at a time. To recombine them, open the first file in Excel and use
Data, Get Data, From File for the rest.

## Checking it still works

The left spine has a link reading **Run the built-in test suite**. It runs
twenty checks covering every boundary in the table above, plus duplicate
handling, import validation, determinism, and the offline guarantee. They
use data built in memory and touch nothing you have loaded.

Run it after any change to the files in `js/`. All twenty should pass.

The same twenty run automatically on every push, in headless Chrome, via
`ci/run-self-tests.mjs`. To run them that way yourself:

```bash
node ci/run-self-tests.mjs
```

It serves the folder, drives Chrome over the DevTools Protocol, prints each
check and exits non-zero if any fail. Like the application, it has no
dependencies; it needs only Node and a Chrome or Chromium on the machine.

## Where things live

```text
index.html            The page itself. All the visible text is here.
css/
  tokens.css          Every colour and size. Change a value once, here.
  base.css            Defaults for ordinary elements.
  layout.css          The spine and the working area.
  components.css      The individual pieces, in the order they appear.
js/
  00-integrity.js     Closes the network. Runs before everything else.
  01-constants.js     Settings. Limits, column names, intents, wordings.
  02-utils.js         Small general helpers. Knows nothing about testing.
  03-classify.js      Reads scenario wording. Add new phrases here.
  04-model.js         The shape of a scenario, and its signature.
  05-schema.js        The import contract. What a valid row looks like.
  06-import.js        Reading JSON and CSV files.
  07-consolidate.js   Duplicates and near-duplicates.
  08-optimizer.js     Packing scenarios into calls. The heart of it.
  09-export.js        Writing CSV files.
  10-selftest.js      The twenty checks.
  11-ui.js            The screen. Holds no planning rules of its own.
samples/              Example files to try the application with.
docs/                 The import format, and how to change things.
```

The `js` files are numbered because they load in that order, and each one
may only use the ones before it. There are no modules and no bundler: the
browser loads eleven plain files.

## Common changes

See [docs/making-changes.md](docs/making-changes.md) for step-by-step
instructions. The short version:

| You want to | Open |
| --- | --- |
| Change a colour | `css/tokens.css` |
| Change a limit, such as the maximum per call | `js/01-constants.js` |
| Add a spreadsheet column heading the app should recognise | `js/01-constants.js` |
| Add or rename an export column | `js/01-constants.js` |
| Teach the app a new phrase, such as another way of saying "transfer" | `js/03-classify.js` |
| Add a field to the import format | `js/05-schema.js` |
| Change wording on screen | `index.html` |

## Import format

See [docs/import-schema.md](docs/import-schema.md) for every field, and
`samples/` for working examples.
