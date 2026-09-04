# Import format, version 1.0

A scenario package is a single `.json` file. The application reads exactly
one version at a time, declared at the top of the file.

There is a working example at `samples/sample-package-segment-a.json`, and
a Segment B example at `samples/sample-package-segment-b.json`.

## Shape of the file

```json
{
  "schemaVersion": "1.0",
  "sourceMetadata": {
    "generatedBy": "Approved upstream workflow",
    "generatedAt": "2026-08-28T14:05:00Z",
    "sourceFiles": ["VendorA_Flow_Pack_R1.pdf"]
  },
  "scenarios": [ ... ]
}
```

`schemaVersion` must read exactly `"1.0"`. A package declaring anything
else is refused with the version it asked for and the version this build
reads, rather than being partially imported.

`sourceMetadata` is optional and is carried through to the export.

## Required fields

A row missing any of these is reported and not imported.

| Field | Rule |
| --- | --- |
| `scenarioId` | 3 to 40 characters: letters, digits, dot, dash, underscore. Unique across the package. |
| `vendor` | `VendorA` or `VendorB` |
| `businessSegment` | `CB` for Segment A, `GB` for Segment B |
| `intent` | Free text. See the intent list below. |
| `scenario` | At least 5 characters |
| `expectedOutcome` | At least 5 characters |

## Optional fields

| Field | Type | Notes |
| --- | --- | --- |
| `releaseDate` | date | `YYYY-MM-DD`. See *Dates* below. |
| `category` | text | Worked out from the wording when absent |
| `conditions` | list of text | The state the test data must be in |
| `populationApplicability` | list of text | Segment B only. See below. |
| `sourceTestSteps` | text | What the tester says or does |
| `sourcePassCriteria` | text | Reproduced in the call script exactly as supplied |
| `agentExpectation` | text | |
| `notes` | text | |
| `testPersona` | text | |
| `testDataProfile` | text | |
| `mockStaging` | text | Environment: staging, mock, production |
| `routingId` | text | |
| `routingIdPopA`, `routingIdPopB`, `routingIdPopC` | text | Segment B, per population |
| `testDataPopA`, `testDataPopB`, `testDataPopC` | text | Segment B, per population |
| `deviceRequirement` | `ANY`, `MOBILE`, `LANDLINE` | See *Requirements* below |
| `aniRequirement` | `ANY`, `RECOGNIZED`, `UNRECOGNIZED` | |
| `timeRequirement` | `ANY`, `BUSINESS_HOURS_ONLY`, `AFTER_HOURS_ONLY` | |
| `terminalType` | `NONE`, `SOFT_BRANCH`, `TRANSFER`, `DISCONNECT`, `TERMINAL` | |
| `userLabel` | text | A specific named caller |
| `dependencies` | list of scenario IDs | Must run earlier in the same call |
| `sourceFile`, `sourceLocation`, `sourceEvidence` | text | Provenance |
| `sourceValidationStatus` | `SOURCE_VALIDATED`, `CLARIFICATION_REQUIRED`, `SOURCE_CONFLICT`, `NOT_VALIDATED` | Defaults to `NOT_VALIDATED` |
| `clarificationNeeded` | text | What a person needs to resolve |

A field the application does not recognise is reported but never blocks
the row, so upstream can add fields ahead of this build reading them.

## Dates

Only unambiguous dates are accepted:

- `2026-10-05` and `2026/10/05`
- `5 October 2026` and `October 5, 2026`

`03/04/2026` is **refused**, because it means 4 March in the United States
and 3 April in most of the rest of the world, and the browser's answer
depends on the machine's regional settings. A silently wrong release date
silently splits a call plan along the wrong boundary, so the application
asks rather than guesses.

## Populations, Segment B only

```json
"populationApplicability": ["Population A", "Population B"]
```

A Segment B scenario runs once per population it applies to, each with
that population's own routing ID and test data. Three populations means
three separate calls; they are never combined.

**An empty list means "not mapped yet". It never means "all of them".**
A scenario with no populations is accepted, listed on the plan under
*Held back*, exported on its own file, and kept out of every call. This is
deliberate: guessing that an unmapped scenario applies everywhere would
triple its execution instances on an assumption nobody made.

## Requirements

`deviceRequirement`, `aniRequirement`, `timeRequirement` and
`terminalType` behave differently depending on whether you supply them:

- **Left out entirely** — the application reads the answer out of the
  scenario wording. A scenario that says "on a landline" gets
  `LANDLINE`.
- **Supplied as `ANY` or `NONE`** — taken at face value. The scenario
  genuinely does not care, and the wording is not consulted.
- **Supplied as a specific value** — used exactly as given.

So leaving a field out and setting it to `ANY` are different statements.
Leave it out when you have not decided; set `ANY` when you have.

## Spreadsheet imports

A `.csv` or `.tsv` file is matched against three known column layouts and
mapped into the same fields. At least half of a layout's columns must be
present for it to be recognised. The exact column names, and the alternate
spellings accepted for each, are listed in `js/01-constants.js` under
`MASTER_HEADERS`, `SEGMENT_A_HEADERS`, `SEGMENT_B_HEADERS` and
`MASTER_HEADER_ALIASES`.

A spreadsheet does not carry a vendor or a release date, so both are taken
from the run settings on screen. The application refuses to load one until
a release date is set.

## Intents

The intent decides where a scenario sits in a call. Identity checks run
first, because everything after them depends on the caller being verified.
Anything that ends the call runs last.

The recognised intents are listed in `js/01-constants.js` under
`KNOWN_INTENTS`. An unrecognised intent is accepted and treated as
`Other`, which places it late in the call but before any ending.

## What happens to every row

Each row leaves the import with one of four dispositions, all of which
appear in the on-screen ledger and in the exported intake ledger:

| Disposition | Meaning |
| --- | --- |
| `ACCEPTED` | Imported |
| `MISSING_REQUIRED` | A required field was absent. The field is named. |
| `INVALID_FIELD` | A field had a value the schema does not allow. The field and the reason are named. |
| `EXACT_DUPLICATE` | Identical to an earlier row, which was kept. Both IDs are named. |

Rows read always equal accepted plus missing plus invalid, with duplicates
and consolidations accounted for separately. The arithmetic on screen
always closes.
