# Making changes

Written for someone who is comfortable editing a text file but does not
write software for a living.

## Before you start

1. Copy the whole folder somewhere safe. That is your undo.
2. Open the application and click **Run the built-in test suite**. Note
   that all twenty checks pass.
3. Make one change.
4. Reload the page and run the test suite again. All twenty should still
   pass.

If a check fails after your change, undo it. The failure message names
what broke.

## Editing rules that apply everywhere

- Text inside `"double quotes"` is words. You can change it freely.
- A line ending in `,` is one item in a list. Keep the commas.
- A line starting with `//` or wrapped in `/* ... */` is a note to a
  human. It is ignored by the browser, so you can rewrite it.
- Never delete a `{`, `}`, `[`, `]`, `(` or `)` unless you delete its
  matching partner too.

---

## Change a colour

Open `css/tokens.css`. Every colour in the application is defined once, at
the top.

```css
--purple:      #241773;
--gold:        #9e7c0c;
--red:         #c60c30;
```

Change a value and it changes everywhere it is used. Nothing else needs
touching.

The palette is the official Baltimore Ravens set. Gold is deliberately
used for only three things — the current view in the left spine, the step
that ends a call, and a warning — so that it keeps its meaning. If you
start using it elsewhere, it stops signalling anything.

---

## Change a limit

Open `js/01-constants.js`. The limits are at the top, each with a note
explaining it.

```js
/* A physical call may never hold more scenarios than this. */
const MAX_SCENARIOS_PER_CALL_CEILING = 8;

/* Calls smaller than this are flagged and the optimizer tries
   to merge them away. It is a preference, not a hard rule. */
const PREFERRED_MINIMUM = 3;
```

Change the number. Do not remove the `;`.

---

## Make the app recognise a different column heading

A source spreadsheet uses `TC Number` where the application expects
`Scenario Number`.

Open `js/01-constants.js` and find `MASTER_HEADER_ALIASES`. Add the new
spelling to the right list:

```js
scenarioNumber: ["Scenario Number", "Scenario #", "TC#", "TC Number"],
```

Save, reload, load the spreadsheet again.

---

## Add, rename or reorder an export column

Open `js/01-constants.js` and find the list you want:

- `LIBRARY_EXPORT_HEADERS` — the scenario library file
- `CALL_PLAN_EXPORT_HEADERS` — the call plan file
- `OVERVIEW_EXPORT_HEADERS` — the overview and validation file

Reordering the list reorders the exported file. Nothing else needs
changing: the export walks the list and looks each column up by name, so
no value can end up in the wrong column.

**Adding** a column is two steps. Add the name to the list here, then open
`js/09-export.js` and add a matching line to the row builder just above,
in `libraryRows` or `callPlanRows`:

```js
"Your New Column": item.someField,
```

The name in quotes has to match exactly, including capital letters.

---

## Teach the app a new phrase

The application decides whether a scenario ends the call, needs a mobile
handset, and so on, by reading the wording. All of that lives in
`js/03-classify.js`.

Say a source pack writes "the system hangs up" where yours says
"disconnect". Find `detectTerminalType` and add it:

```js
if (/\bdisconnect\b|\bend call\b|\bhangs up\b/.test(normalized)) {
  return C.TERMINAL.DISCONNECT;
}
```

The `\b` marks a word boundary, so `\bhangs up\b` matches "the system
hangs up" but not "overhangs upward". Separate alternatives with `|`.

The same file holds the lists for intents, categories, device, ANI, time
of day, test-data conditions, expected outcomes and subjects. Each has a
comment saying what it is for.

**Test your change:** load a package containing that wording and check the
scenario shows the value you expected in the scenario library table.

---

## Add a field to the import format

Open `js/05-schema.js` and find the `FIELDS` list. Add an entry:

```js
{
  name: "yourFieldName",     // the key in the JSON file
  target: "yourFieldName",   // the name used inside the app
  required: false,
  type: "text"               // "text", "enum", "date", "list"
},
```

Then open `js/04-model.js`, find `blankCase`, and add the field with an
empty starting value:

```js
yourFieldName: "",
```

If you want it in an export, follow *Add an export column* above.

Bump `SUPPORTED_SCHEMA_VERSION` in `js/01-constants.js` if the change
means older packages will no longer work. Existing packages will then be
refused with a clear message rather than half-imported.

---

## Change wording on screen

All the visible text is in `index.html`. Search for the phrase you want to
change and edit it between the tags.

Text that changes as you work — counts, messages, validation results — is
generated in `js/11-ui.js`. Search for a distinctive phrase there.

---

## Adding a check to the test suite

Open `js/10-selftest.js` and add an entry to the `TESTS` list:

```js
["T21 What you are checking", function () {
  const cases = makeMany(4, function (index) {
    return { id: "X-" + index };
  });

  const result = plan(cases);

  return verdict(
    result.calls.length === 1,          // true means the check passed
    "Four scenarios were packed into " + result.calls.length + " call."
  );
}],
```

`makeCase`, `makeMany` and `plan` are helpers defined at the top of the
file. The message is shown whether the check passes or fails, so write it
to be useful in both cases.

---

## Things to leave alone

- `js/00-integrity.js` is what keeps the application offline. Changing it
  weakens that guarantee.
- The `<meta http-equiv="Content-Security-Policy">` block at the top of
  `index.html` does the same job at the browser level.
- The numbered order of the `<script>` tags at the bottom of
  `index.html`. Each file uses the ones before it, so reordering them
  breaks the application.

---

## If something breaks

1. Open the browser's developer tools. In Chrome and Edge that is
   View, Developer, Developer Tools; in Safari, Develop, Show Web
   Inspector. Click **Console**.
2. A red line names the file and the line number. Nine times in ten it is
   a missing comma or an unmatched bracket on the line above the one
   named.
3. If you cannot see it, restore your copy of the folder and make the
   change again in smaller steps.
