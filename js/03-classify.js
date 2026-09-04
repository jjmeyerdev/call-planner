/* ==============================================================
   03-classify.js
   --------------------------------------------------------------
   Reads the words in a scenario and works out what it is testing:
   its intent, its category, the conditions it needs, the outcome
   it expects, and the hard execution requirements it carries.

   Everything here is pattern matching over text. To teach the app
   a new phrase, add it to the matching list below.
   ============================================================== */

window.QA = window.QA || {};

QA.classify = (function () {
  "use strict";

  const C = QA.constants;
  const U = QA.utils;

  /* ------------------------------------------------------------
     INTENT
     ------------------------------------------------------------ */

  const INTENT_PATTERNS = [
    ["Special Account Closure", /\bspecial account closure\b|\bdeceased user\b/],
    ["Pre-Approval", /\bpre approval\b|\bpreauth\b|\bprecert\b/],
    ["Record Disputes", /\brecord dispute\b|\bappeal\b/],
    ["Records", /\brecords? flow\b|\brecord\b|\bdate of service\b/],
    ["Access Credential", /\baccess credential\b|\bidentification card\b|\bmember card\b/],
    ["Directory Lookup", /\bdirectory lookup\b|\bprovider search\b|\bprovider directory\b/],
    ["Billing", /\bpayments? flow\b|\bpayment\b|\bbill pay\b|\bpremium\b|\bautopay\b/],
    ["Account Activity", /\baccount activity\b|\bspending account\b/],
    ["Statements", /\bstatement\b|\btax document\b/],
    ["Profile_Maintenance", /\bdemographic\b|\bchange address\b|\bupdate address\b|\bchange phone\b|\bupdate phone\b/],
    ["Renewal", /\brenewal\b|\brecertification\b/],
    ["PRIMARY_CONTACT", /\bprimary service contact\b|\bprimary contact\b/],
    ["SECONDARY_ACCOUNT", /\bsecondary account coordination\b|\bsecondary account\b/],
    ["Cancel Service", /\bcancel service\b|\bcancel entitlement\b/],
    ["Service Details", /\bservice details?\b|\bservice level\b|\bcopay\b|\bcoinsurance\b|\bdeductible\b/],
    ["Program Details", /\bprogram details?\b|\baccumulator\b|\bout of pocket\b/],
    ["Enrollment / Eligibility", /\beligibility\b|\benrollment\b|\bcoverage status\b|\beffective date\b/],
    ["Identity_Verification", /\bidentity verification\b|\bauthentication\b|\bauthenticate\b|\bmember id\b/]
  ];

  function findIntent(value, fallback) {
    const raw = U.cleanText(value);
    const text = U.matchText(value);
    const result = fallback || "Other";

    if (!text) {
      return result;
    }

    /* An explicit "Intent: X" always wins over guesswork. */
    const explicit = raw.match(/\bIntent\s*:\s*([^|\n]+)/i);
    if (explicit) {
      return U.cleanText(explicit[1]);
    }

    for (const entry of INTENT_PATTERNS) {
      if (entry[1].test(text)) {
        return entry[0];
      }
    }

    for (const intent of C.KNOWN_INTENTS) {
      if (text.includes(U.matchText(intent))) {
        return intent;
      }
    }

    return result;
  }

  /* Several intents mean the same thing for grouping purposes.
     The family is what the optimizer and the consolidator compare. */
  function intentFamily(intent) {
    const key = U.matchText(intent);

    if (["program details", "service details", "service level details"].includes(key)) {
      return "SERVICE_DETAILS";
    }

    if (["records", "record disputes", "disputes"].includes(key)) {
      return "RECORDS_DISPUTES";
    }

    if (["enrollment eligibility", "eligibility"].includes(key)) {
      return "ELIGIBILITY";
    }

    return key.toUpperCase().replace(/\s+/g, "_") || "OTHER";
  }

  function intentCompatibility(first, second) {
    if (U.matchText(first) === U.matchText(second)) {
      return 1;
    }
    if (intentFamily(first) === intentFamily(second)) {
      return 0.78;
    }
    return 0;
  }

  /* ------------------------------------------------------------
     CATEGORY
     ------------------------------------------------------------ */

  const CATEGORY_PATTERNS = [
    ["Guardrail", /\bguardrail\b|\bprivacy restriction\b|\bprohibit/],
    ["Auto-Escalation", /\bauto escalation\b/],
    ["Error", /\bapi failure\b|\bsystem failure\b|\berror\b|\bfailed\b|\bfailure\b/],
    ["Fallback", /\binvalid\b|\bretry\b|\bcannot\b|\bno match\b|\bnot found\b/],
    ["Boundary", /\bboundary\b|\bminimum\b|\bmaximum\b|\bzero\b|\bnegative balance\b/],
    ["Branch", /\baccepted\b|\bdeclined\b|\bbranch\b/],
    ["Entry", /\bentry\b|\bidentity verification\b|\bauthentication\b|\bauthenticate\b/]
  ];

  function classifyCategory(text) {
    const normalized = U.matchText(text);

    for (const entry of CATEGORY_PATTERNS) {
      if (entry[1].test(normalized)) {
        return entry[0];
      }
    }

    return "Happy Path";
  }

  /* ------------------------------------------------------------
     TERMINAL BEHAVIOUR

     A hard terminal ends the call, so it must be the last step and
     no call may hold two of them. Anything hedged with "if" or
     "may" is only a soft branch: it might end the call, so the plan
     tells the tester what to do if it does.
     ------------------------------------------------------------ */

  function detectTerminalType(text) {
    const normalized = U.matchText(text);
    const conditional = /\b(if|may|might|could|depending|conditional)\b/.test(normalized);

    if (!conditional) {
      if (/\bdisconnect\b|\bend call\b|\bends the call\b|\bthe call ends\b|\bcall is ended\b/.test(normalized)) {
        return C.TERMINAL.DISCONNECT;
      }
      if (/\btransfer\b|\broute to agent\b|\blive agent\b/.test(normalized)) {
        return C.TERMINAL.TRANSFER;
      }
      if (/\bhard stop\b|\bterminal\b/.test(normalized)) {
        return C.TERMINAL.TERMINAL;
      }
    }

    if (/\btransfer\b|\bdisconnect\b|\bbranch\b/.test(normalized)) {
      return C.TERMINAL.SOFT_BRANCH;
    }

    return C.TERMINAL.NONE;
  }

  function isHardTerminal(terminalType) {
    return C.HARD_TERMINALS.indexOf(terminalType) >= 0;
  }

  function terminalFamily(terminalType) {
    if (isHardTerminal(terminalType)) {
      return terminalType;
    }
    if (terminalType === C.TERMINAL.SOFT_BRANCH) {
      return "SOFT";
    }
    return "NON_TERMINAL";
  }

  /* ------------------------------------------------------------
     HARD EXECUTION REQUIREMENTS
     ------------------------------------------------------------ */

  function extractDevice(text) {
    const normalized = U.matchText(text);

    if (/\blandline\b|\bnon mobile\b/.test(normalized)) {
      return C.DEVICE.LANDLINE;
    }
    if (/\bmobile\b|\bsms\b|\btext message\b/.test(normalized)) {
      return C.DEVICE.MOBILE;
    }
    return C.DEVICE.ANY;
  }

  function extractANI(text) {
    const normalized = U.matchText(text);

    if (/\bunrecognized ani\b|\bani no match\b|\bunknown ani\b/.test(normalized)) {
      return C.ANI.UNRECOGNIZED;
    }
    if (/\brecognized ani\b|\bani match\b/.test(normalized)) {
      return C.ANI.RECOGNIZED;
    }
    return C.ANI.ANY;
  }

  function extractTimeRequirement(text) {
    const normalized = U.matchText(text);

    if (/\bafter hours\b/.test(normalized)) {
      return C.TIME.AFTER;
    }
    if (/\bbusiness hours\b/.test(normalized)) {
      return C.TIME.BUSINESS;
    }
    return C.TIME.ANY;
  }

  function extractEnvironment(value) {
    const text = U.matchText(value);

    if (!text) {
      return "ANY";
    }
    if (/\bstaging\b|\bpre prod\b|\bpre production\b|\buat\b/.test(text)) {
      return "STAGING";
    }
    if (/\bmock\b|\bsimulated\b/.test(text)) {
      return "MOCK";
    }
    if (/\bproduction\b|\bprod\b/.test(text) && !/\bpre produc/.test(text)) {
      return "PRODUCTION";
    }
    return U.enumText(value);
  }

  function extractAuthState(text) {
    const normalized = U.matchText(text);

    if (/\bunauthenticated\b|\bbefore identity verification\b|\bwithout identity verification\b/.test(normalized)) {
      return "PRE_AUTH";
    }
    if (/\bpost auth\b|\bauthenticated user\b|\bafter identity verification\b|\bsuccessfully verified\b/.test(normalized)) {
      return "POST_AUTH";
    }
    return "ANY";
  }

  /* Two hard requirements can share a call when at least one of them
     does not care, or when they ask for exactly the same thing. */
  function hardEnumCompatible(first, second, anyValue) {
    const any = anyValue || "ANY";

    if (!first || first === any) {
      return true;
    }
    if (!second || second === any) {
      return true;
    }
    return first === second;
  }

  /* ------------------------------------------------------------
     CONDITIONS

     A condition map records the state the test data must be in.
     Two scenarios whose maps disagree on any shared key cannot run
     in the same call: one needs an active account, the other needs
     a terminated one, and the same caller cannot be both.
     ------------------------------------------------------------ */

  const CONDITION_RULES = [
    ["entitlement", [
      ["FUTURE_ACTIVE", /\bfuture active\b|\bfuture effective\b/, true],
      ["TERMED", /\bterminated\b|\btermed\b|\binactive entitlement\b|\bnot enrolled\b/, true],
      ["ACTIVE", /\bactive user\b|\bactive entitlement\b|\bstatus active\b/, false]
    ]],
    ["validity", [
      ["INVALID", /\binvalid\b|\bincorrect\b|\bwrong\b/, true],
      ["VALID", /\bvalid\b|\bcorrect\b/, false]
    ]],
    ["ani", [
      ["UNRECOGNIZED", /\bunrecognized ani\b|\bani no match\b|\bunknown ani\b/, true],
      ["RECOGNIZED", /\brecognized ani\b|\bani match\b/, false]
    ]],
    ["device", [
      ["LANDLINE", /\blandline\b|\bnon mobile\b/, false],
      ["MOBILE", /\bmobile\b|\bsms capable\b/, false]
    ]],
    ["time", [
      ["AFTER_HOURS", /\bafter hours\b/, false],
      ["BUSINESS_HOURS", /\bbusiness hours\b/, false]
    ]],
    ["consent", [
      ["ACCEPTED", /\baccepted\b/, false],
      ["DECLINED", /\bdeclined\b/, false]
    ]],
    ["record_count", [
      ["MULTIPLE", /\bmultiple records\b/, false],
      ["SINGLE", /\bsingle record\b|\bone record\b/, false]
    ]],
    ["same_dos", [
      ["YES", /\bsame date of service\b|\bsame dos\b/, false]
    ]],
    ["record_status", [
      ["PAID", /\bpaid record\b/, false],
      ["DENIED", /\bdenied record\b/, false],
      ["PENDING", /\bpending record\b|\bin process record\b/, false]
    ]],
    ["caller_role", [
      ["PRIMARY_USER", /\bprimary user\b|\bsubscriber\b/, false],
      ["ASSOCIATED_USER", /\bassociated user\b|\bdependent\b/, false]
    ]],
    ["same_birth_date", [
      ["YES", /\btwins\b|\btriplets\b|\bsame birth date\b/, false]
    ]],
    ["groups", [
      ["MULTIPLE", /\bmultiple groups\b/, false]
    ]],
    ["previous_engagement", [
      ["NO", /\bno previous engagement\b|\bno previous text engagement\b/, true],
      ["YES", /\bprevious engagement\b|\bprevious text engagement\b/, false]
    ]],
    ["privacy", [
      ["DECLINED", /\bprivacy declined\b/, true],
      ["ACCEPTED", /\bprivacy accepted\b/, false]
    ]],
    ["network", [
      ["OUT_OF_NETWORK", /\bout of network\b/, true],
      ["IN_NETWORK", /\bin network\b/, false]
    ]],
    ["lookup", [
      ["MULTIPLE_MATCHES", /\bmultiple match\b|\bmultiple records\b|\bduplicate record\b/, true],
      ["NO_MATCH", /\bno match\b|\bnot found\b/, false]
    ]]
  ];

  function extractConditionMap(text) {
    const normalized = U.matchText(text);
    const map = {};

    for (const rule of CONDITION_RULES) {
      const key = rule[0];

      for (const option of rule[1]) {
        if (!option[1].test(normalized)) {
          continue;
        }
        const overwrite = option[2];
        if (overwrite || !map[key]) {
          map[key] = option[0];
        }
        break;
      }
    }

    const authState = extractAuthState(text);
    if (authState !== "ANY" && !map.auth_state) {
      map.auth_state = authState;
    }

    return map;
  }

  /* ------------------------------------------------------------
     OUTCOMES
     ------------------------------------------------------------ */

  const OUTCOME_RULES = [
    ["terminal", [
      ["DISCONNECT", /\bdisconnect\b|\bend call\b|\bends the call\b|\bthe call ends\b|\bcall is ended\b/, true],
      ["TRANSFER", /\btransfer\b|\blive agent\b|\broute to agent\b/, false]
    ]],
    ["next_action", [
      ["RETRY", /\bretry\b|\btry again\b|\breprompt\b|\bprompt again\b/, true],
      ["CONTINUE", /\bcontinue\b|\bproceed\b|\bmove on\b/, false]
    ]],
    ["auth_result", [
      ["FAIL", /\bauthentication fail\b|\bauthentication unsuccessful\b|\bauth failed\b/, true],
      ["SUCCESS", /\bauthentication successful\b|\bauthenticated successfully\b|\bauth success\b/, false]
    ]],
    ["sms", [
      ["NO_SEND", /\bdo not send sms\b|\bno sms\b|\bno text\b/, true],
      ["SEND", /\bsend sms\b|\bsend text\b|\btext is sent\b|\btext message is sent\b/, false]
    ]],
    ["email", [
      ["NO_SEND", /\bdo not send email\b|\bno email\b/, true],
      ["SEND", /\bsend email\b|\bemail is sent\b/, false]
    ]],
    ["mail", [
      ["SEND", /\bmail card\b|\bphysical card\b|\bmail is sent\b/, false]
    ]],
    ["response", [
      ["PROVIDE_INFO", /\bprovide\b|\brecite\b|\bread out\b|\breturn\b|\bdisplay\b|\bpresent\b/, false]
    ]],
    ["confirmation", [
      ["YES", /\bconfirm\b|\bconfirmation\b/, false]
    ]],
    ["result", [
      ["ERROR", /\berror message\b|\berror response\b|\bfailure message\b/, true],
      ["SUCCESS", /\bsuccess\b|\bsuccessful\b/, false]
    ]],
    ["lookup_result", [
      ["NOT_FOUND", /\bnot found\b|\bno match\b/, true],
      ["FOUND", /\bfound\b|\bmatch found\b/, false]
    ]],
    ["access", [
      ["DENY", /\bdeny\b|\bprohibit\b|\bnot permitted\b/, true],
      ["ALLOW", /\ballow\b|\bpermitted\b/, false]
    ]],
    ["post_call", [
      ["SURVEY", /\bsurvey\b/, false]
    ]]
  ];

  function extractOutcomeMap(text) {
    const normalized = U.matchText(text);
    const map = {};

    for (const rule of OUTCOME_RULES) {
      const key = rule[0];

      for (const option of rule[1]) {
        if (!option[1].test(normalized)) {
          continue;
        }
        const overwrite = option[2];
        if (overwrite || !map[key]) {
          map[key] = option[0];
        }
        break;
      }
    }

    return map;
  }

  /* ------------------------------------------------------------
     SUBJECTS

     What the scenario is actually about. Used to stop two
     unrelated scenarios that share vocabulary from being offered
     as consolidation candidates.
     ------------------------------------------------------------ */

  const SUBJECT_RULES = [
    ["VERIFY_USER_ID", /\bmember id\b|\buser id\b/],
    ["AUTH_POSTAL_CODE", /\bpostal code\b|\bzip code\b/],
    ["AUTH_BIRTH_DATE", /\bdate of birth\b|\bbirth date\b/],
    ["AUTH_SENSITIVE_ID", /\bsensitive id\b|\bgovernment identifier\b/],
    ["ENTITLEMENT_STATUS", /\bcoverage status\b|\beligibility\b|\benrollment\b/],
    ["GROUP_SELECTION", /\bgroup id\b|\bmultiple groups\b/],
    ["PROGRAM_DETAIL", /\bprogram detail\b|\bdeductible\b|\bcopay\b|\bcoinsurance\b|\bout of pocket\b/],
    ["SERVICE_DETAIL", /\bservice detail\b|\bservice level\b/],
    ["PRE_APPROVAL", /\bpre approval\b|\bpreauth\b|\bprecert\b/],
    ["RECORD", /\brecord\b|\bdate of service\b/],
    ["RECORD_STATEMENT", /\bexplanation of\b|\bstatement of record\b/],
    ["DISPUTE", /\bappeal\b|\bdispute\b/],
    ["ACCESS_CREDENTIAL", /\baccess credential\b|\bmember card\b/],
    ["DIRECTORY_LOOKUP", /\bdirectory lookup\b|\bprovider search\b|\bprovider directory\b/],
    ["PRIMARY_CONTACT", /\bprimary service contact\b|\bprimary contact\b/],
    ["BILLING_ITEM", /\bpayment\b|\bpremium\b|\bautopay\b|\bbill\b/],
    ["SPENDING", /\baccount activity\b|\bspending account\b/],
    ["PROFILE_MAINTENANCE", /\baddress\b|\bphone number\b|\bdemographic\b|\bname change\b/],
    ["STATEMENT", /\bstatement\b|\btax document\b/],
    ["RENEWAL", /\brenewal\b|\brecertification\b/],
    ["DEATH", /\bdeath\b|\bdeceased\b/],
    ["SMS", /\bsms\b|\btext message\b/],
    ["EMAIL", /\bemail\b/],
    ["MAIL", /\bphysical mail\b|\bmail card\b/]
  ];

  function extractSubjects(text) {
    const normalized = U.matchText(text);
    const output = new Set();

    for (const rule of SUBJECT_RULES) {
      if (rule[1].test(normalized)) {
        output.add(rule[0]);
      }
    }

    return output;
  }

  /* ------------------------------------------------------------
     MAP COMPARISON
     ------------------------------------------------------------ */

  function mapToTagSet(map) {
    return new Set(
      Object.entries(map || {}).map(function (entry) {
        return entry[0] + "=" + entry[1];
      })
    );
  }

  /* Returns the first disagreement between two maps, or null. */
  function mapConflict(sourceMap, candidateMap) {
    for (const entry of Object.entries(sourceMap || {})) {
      const key = entry[0];
      const sourceValue = entry[1];

      if (!candidateMap || !candidateMap[key]) {
        continue;
      }
      if (candidateMap[key] !== sourceValue) {
        return {
          key: key,
          sourceValue: sourceValue,
          candidateValue: candidateMap[key]
        };
      }
    }

    return null;
  }

  function mapsConflict(first, second) {
    return Boolean(mapConflict(first, second) || mapConflict(second, first));
  }

  /* "Ends the call" and "carry on to the next step" contradict each
     other even though they are recorded under different keys. */
  function outcomeContradiction(first, second) {
    const direct = mapConflict(first, second) || mapConflict(second, first);
    if (direct) {
      return direct;
    }

    if (first && first.terminal && second && second.next_action === "CONTINUE") {
      return {
        key: "terminal_vs_continue",
        sourceValue: first.terminal,
        candidateValue: second.next_action
      };
    }

    if (second && second.terminal && first && first.next_action === "CONTINUE") {
      return {
        key: "terminal_vs_continue",
        sourceValue: second.terminal,
        candidateValue: first.next_action
      };
    }

    return null;
  }

  return {
    findIntent: findIntent,
    intentFamily: intentFamily,
    intentCompatibility: intentCompatibility,

    classifyCategory: classifyCategory,

    detectTerminalType: detectTerminalType,
    isHardTerminal: isHardTerminal,
    terminalFamily: terminalFamily,

    extractDevice: extractDevice,
    extractANI: extractANI,
    extractTimeRequirement: extractTimeRequirement,
    extractEnvironment: extractEnvironment,
    extractAuthState: extractAuthState,
    hardEnumCompatible: hardEnumCompatible,

    extractConditionMap: extractConditionMap,
    extractOutcomeMap: extractOutcomeMap,
    extractSubjects: extractSubjects,

    mapToTagSet: mapToTagSet,
    mapConflict: mapConflict,
    mapsConflict: mapsConflict,
    outcomeContradiction: outcomeContradiction
  };
})();
