/* ==============================================================
   04-model.js
   --------------------------------------------------------------
   The shape of a test case, and the "structured signature" that
   every other stage compares against.

   Building a signature involves a lot of pattern matching, so each
   one is computed once and remembered. The previous build rebuilt
   the same signature tens of thousands of times while packing
   calls, which is where most of its running time went.
   ============================================================== */

window.QA = window.QA || {};

QA.model = (function () {
  "use strict";

  const C = QA.constants;
  const U = QA.utils;
  const K = QA.classify;

  /* ------------------------------------------------------------
     THE TEST CASE

     Every field a test case can hold, with a safe empty default.
     Adding a field here makes it available everywhere.
     ------------------------------------------------------------ */

  function blankCase() {
    return {
      /* Identity */
      id: "",
      sourceOrder: 0,

      /* Optimization boundaries */
      vendor: "",
      businessSegment: "",
      releaseDate: "",

      /* Content */
      intent: "Other",
      category: "",
      scenario: "",
      expectedOutcome: "",
      conditions: [],

      /* Test data and routing */
      routingId: "",
      routingIdPopA: "",
      routingIdPopB: "",
      routingIdPopC: "",
      mockStaging: "",
      testPersona: "",
      mockDataPersona: "",
      testDataPopA: "",
      testDataPopB: "",
      testDataPopC: "",
      agentExpectation: "",
      passCriteria: "",
      testSteps: "",
      notes: "",

      /* Hard execution requirements.

         These start empty rather than at "ANY", so that a package
         which says nothing can be told apart from one that explicitly
         says the scenario does not care. An empty value is filled in
         by reading the scenario wording; an explicit "ANY" is left
         alone. deriveExecutionFields() below settles them, and every
         scenario carries a concrete value from that point on. */
      device: "",
      ani: "",
      timeRequirement: "",
      terminalType: "",

      /* An explicitly named caller. Two different named callers can
         never share one physical call. */
      userLabel: "",

      /* Scenario IDs that must run earlier in the same call. */
      dependencies: [],

      /* Segment B population applicability. An empty set means
         "not yet mapped", never "applies to all". */
      populationApplicability: {
        popa: false,
        popb: false,
        popc: false
      },

      /* Provenance, carried through untouched from the package. */
      sourceFile: "",
      sourceLocation: "",
      sourceEvidence: "",
      sourceValidationStatus: "NOT_VALIDATED",
      clarificationNeeded: "",

      /* Set by the app, not by the import. */
      optimizerEligible: true,
      blockedReason: "",
      inputSchema: ""
    };
  }

  function cloneCase(testCase) {
    return Object.assign({}, testCase, {
      conditions: [...(testCase.conditions || [])],
      dependencies: [...(testCase.dependencies || [])],
      populationApplicability: Object.assign({}, testCase.populationApplicability)
    });
  }

  /* ------------------------------------------------------------
     POPULATIONS
     ------------------------------------------------------------ */

  function populationList(testCase) {
    const applicability = testCase.populationApplicability || {};

    return C.POPULATIONS
      .filter(function (population) { return applicability[population.key]; })
      .map(function (population) { return population.label; });
  }

  function populationLabel(testCase) {
    const labels = populationList(testCase);
    return labels.join(" / ");
  }

  function populationCodeSet(testCase) {
    const applicability = testCase.populationApplicability || {};
    const output = new Set();

    for (const population of C.POPULATIONS) {
      if (applicability[population.key]) {
        output.add(population.code);
      }
    }

    return output;
  }

  function populationKeyFromLabel(label) {
    const match = C.POPULATIONS.filter(function (population) {
      return population.label === label;
    })[0];

    return match ? match.key : "";
  }

  /* Two population sets can be consolidated when they match exactly,
     or when at least one side has not been mapped yet. */
  function populationsEquivalentOrUnknown(first, second) {
    if (!first.size || !second.size) {
      return true;
    }
    if (first.size !== second.size) {
      return false;
    }
    for (const value of first) {
      if (!second.has(value)) {
        return false;
      }
    }
    return true;
  }

  /* ------------------------------------------------------------
     STRUCTURED SIGNATURE

     A compact, comparable description of one scenario. Computed
     once per object and cached. Cloning a case produces a new
     object, which correctly produces a fresh signature.
     ------------------------------------------------------------ */

  const signatureCache = new WeakMap();

  function structuredSignature(testCase, segment) {
    const cached = signatureCache.get(testCase);

    if (cached && cached.segment === segment) {
      return cached.signature;
    }

    const signature = buildSignature(testCase, segment);
    signatureCache.set(testCase, { segment: segment, signature: signature });
    return signature;
  }

  function buildSignature(testCase, segment) {
    const conditionsText = (testCase.conditions || []).join(" ");

    const intentText = [
      testCase.category,
      testCase.scenario,
      testCase.passCriteria,
      testCase.testPersona
    ].join(" ");

    const conditionText = [
      testCase.scenario,
      conditionsText,
      testCase.routingId,
      testCase.routingIdPopA,
      testCase.routingIdPopB,
      testCase.routingIdPopC,
      testCase.mockStaging,
      testCase.testPersona,
      testCase.mockDataPersona,
      testCase.notes
    ].join(" ");

    const outcomeText = [
      testCase.expectedOutcome,
      testCase.passCriteria,
      testCase.agentExpectation
    ].join(" ");

    const combined = intentText + " " + conditionText + " " + outcomeText;

    const intent =
      testCase.intent && testCase.intent !== "Other"
        ? testCase.intent
        : K.findIntent(intentText, "Other");

    return {
      intent: intent,
      intentFamily: K.intentFamily(intent),

      category: K.classifyCategory(testCase.category + " " + testCase.scenario),

      conditionMap: K.extractConditionMap(conditionText),
      outcomeMap: K.extractOutcomeMap(outcomeText),
      subjects: K.extractSubjects(combined),

      population:
        segment === C.SEGMENT.B
          ? populationCodeSet(testCase)
          : new Set(),

      device: testCase.device || K.extractDevice(combined),
      ani: testCase.ani || K.extractANI(combined),
      time: testCase.timeRequirement || K.extractTimeRequirement(combined),
      environment: K.extractEnvironment(testCase.mockStaging),

      routingId: U.firstPhone(
        testCase.routingId ||
        testCase.routingIdPopA ||
        testCase.routingIdPopB ||
        testCase.routingIdPopC
      ),

      terminal: testCase.terminalType || K.detectTerminalType(outcomeText),

      text: [
        testCase.scenario,
        testCase.expectedOutcome,
        testCase.passCriteria,
        testCase.testPersona,
        testCase.mockDataPersona
      ].join(" ")
    };
  }

  /* Fill in any hard requirement the package left blank by reading the
     scenario text, and leave every explicit value exactly as supplied.
     Safe to call more than once on the same scenario. */
  function deriveExecutionFields(testCase, segment) {
    const signature = structuredSignature(testCase, segment);

    testCase.device = signature.device;
    testCase.ani = signature.ani;
    testCase.timeRequirement = signature.time;
    testCase.terminalType = signature.terminal;

    if (!testCase.intent || testCase.intent === "Other") {
      testCase.intent = signature.intent;
    }

    if (!testCase.category) {
      testCase.category = signature.category;
    }

    return testCase;
  }

  /* ------------------------------------------------------------
     EXACT DUPLICATES

     Two rows are the same row when every substantive field matches.
     A row with almost nothing filled in is never treated as a
     duplicate of anything, because near-empty rows would otherwise
     collapse into each other and quietly disappear.
     ------------------------------------------------------------ */

  const MINIMUM_POPULATED_FIELDS = 3;

  function exactDuplicateSignature(testCase, segment) {
    const substantive = [
      testCase.category,
      testCase.scenario,
      testCase.expectedOutcome,
      testCase.routingId ||
        testCase.routingIdPopA ||
        testCase.routingIdPopB ||
        testCase.routingIdPopC,
      testCase.mockStaging,
      testCase.testPersona,
      testCase.passCriteria,
      testCase.mockDataPersona
    ];

    const populated = substantive.filter(function (field) {
      return U.cleanText(field);
    }).length;

    if (populated < MINIMUM_POPULATED_FIELDS) {
      return "UNSAFE_TO_DEDUP|" + testCase.id + "|" + testCase.sourceOrder;
    }

    const populationPart =
      segment === C.SEGMENT.B
        ? [...populationCodeSet(testCase)].sort().join(",")
        : "";

    return substantive
      .map(U.matchText)
      .concat([populationPart])
      .join("|");
  }

  return {
    blankCase: blankCase,
    cloneCase: cloneCase,

    populationList: populationList,
    populationLabel: populationLabel,
    populationCodeSet: populationCodeSet,
    populationKeyFromLabel: populationKeyFromLabel,
    populationsEquivalentOrUnknown: populationsEquivalentOrUnknown,

    structuredSignature: structuredSignature,
    deriveExecutionFields: deriveExecutionFields,
    exactDuplicateSignature: exactDuplicateSignature
  };
})();
