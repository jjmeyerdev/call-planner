/* ==============================================================
   01-constants.js
   --------------------------------------------------------------
   Every value a non-developer is likely to need to change lives
   in this file. Nothing here runs any logic. It is a settings
   sheet written in JavaScript.

   Load order matters. This file must load first.
   ============================================================== */

window.QA = window.QA || {};

QA.constants = (function () {
  "use strict";

  /* ------------------------------------------------------------
     BUILD
     ------------------------------------------------------------ */

  const BUILD_VERSION = "2026.09.04-offline-1.0.0";
  const BUILD_NAME = "Offline Rebuild 1.0";

  /* ------------------------------------------------------------
     IMPORT SCHEMA VERSION

     A package JSON file must declare "schemaVersion": "1.0".
     Bump this only when the field list below changes.
     ------------------------------------------------------------ */

  const SUPPORTED_SCHEMA_VERSION = "1.0";

  /* ------------------------------------------------------------
     CALL PACKING LIMITS
     ------------------------------------------------------------ */

  /* A physical call may never hold more scenarios than this. */
  const MAX_SCENARIOS_PER_CALL_CEILING = 8;

  /* Calls smaller than this are flagged and the optimizer tries
     to merge them away. It is a preference, not a hard rule. */
  const PREFERRED_MINIMUM = 3;

  /* ------------------------------------------------------------
     CONSOLIDATION
     ------------------------------------------------------------ */

  /* Two scenarios must score at or above this (out of 100) before
     they are offered for human consolidation review. Raise it to
     surface fewer pairs, lower it to surface more. Nothing is ever
     merged automatically at this stage. */
  const CONSOLIDATION_SIMILARITY_THRESHOLD = 86;

  /* ------------------------------------------------------------
     BUSINESS SEGMENTS AND POPULATIONS
     ------------------------------------------------------------ */

  const SEGMENT = {
    A: "CB",
    B: "GB"
  };

  const SEGMENT_LABEL = {
    CB: "Business Segment A",
    GB: "Business Segment B"
  };

  /* Segment B splits every scenario into one execution instance per
     applicable population. Order here is the order they are packed. */
  const POPULATIONS = [
    { code: "POPA", label: "Population A", key: "popa" },
    { code: "POPB", label: "Population B", key: "popb" },
    { code: "POPC", label: "Population C", key: "popc" }
  ];

  const POPULATION_LABELS = POPULATIONS.map(function (p) { return p.label; });

  const VENDORS = ["VendorA", "VendorB"];

  /* ------------------------------------------------------------
     HARD EXECUTION CONSTRAINTS

     These are the dimensions that may never be mixed inside one
     physical call. "ANY" means the scenario does not care.
     ------------------------------------------------------------ */

  const TERMINAL = {
    NONE: "NONE",
    SOFT_BRANCH: "SOFT_BRANCH",
    TRANSFER: "TRANSFER",
    DISCONNECT: "DISCONNECT",
    TERMINAL: "TERMINAL"
  };

  /* A call may contain at most one of these. It must be the last step. */
  const HARD_TERMINALS = [
    TERMINAL.TRANSFER,
    TERMINAL.DISCONNECT,
    TERMINAL.TERMINAL
  ];

  const DEVICE = {
    ANY: "ANY",
    MOBILE: "MOBILE",
    LANDLINE: "LANDLINE"
  };

  const ANI = {
    ANY: "ANY",
    RECOGNIZED: "RECOGNIZED",
    UNRECOGNIZED: "UNRECOGNIZED"
  };

  const TIME = {
    ANY: "ANY",
    BUSINESS: "BUSINESS_HOURS_ONLY",
    AFTER: "AFTER_HOURS_ONLY"
  };

  /* ------------------------------------------------------------
     SOURCE VALIDATION STATES

     Carried through from the upstream package. The app never
     invents these; it only reports them.
     ------------------------------------------------------------ */

  const SOURCE_VALIDATION_STATUSES = [
    "SOURCE_VALIDATED",
    "CLARIFICATION_REQUIRED",
    "SOURCE_CONFLICT",
    "NOT_VALIDATED"
  ];

  /* Rows carrying one of these need a person to look at them. */
  const REVIEW_REQUIRED_STATUSES = new Set([
    "CLARIFICATION_REQUIRED",
    "SOURCE_CONFLICT"
  ]);

  /* ------------------------------------------------------------
     SPREADSHEET COLUMN NAMES

     The app reads .csv and .tsv files. It matches the first row of
     the file against the lists below. Add a spelling to an alias
     list if a source file uses a different column heading.
     ------------------------------------------------------------ */

  const MASTER_HEADERS = [
    "Scenario Number",
    "Category",
    "Scenario",
    "Routing ID",
    "Mock / Staging",
    "Test Persona",
    "Pass Criteria",
    "Mock Data Persona"
  ];

  const MASTER_HEADER_ALIASES = {
    scenarioNumber: ["Scenario Number", "Scenario #", "Scenario#", "TC#", "TC #", "Scenario ID"],
    category: ["Category"],
    scenario: ["Scenario"],
    routingId: ["Routing ID", "Routing Id", "RoutingID"],
    mockStaging: ["Mock / Staging", "Mock / Staging?", "Mock/Staging", "Mock Staging"],
    testPersona: ["Test Persona", "Test Persona / User Condition"],
    passCriteria: ["Pass Criteria"],
    mockDataPersona: ["Mock Data Persona", "Mock Data", "Mock Persona"]
  };

  const SEGMENT_A_HEADERS = [
    "Scenario #",
    "Category",
    "Scenario",
    "Routing ID",
    "Test Persona",
    "Pass Criteria",
    "Agent Transfer",
    "Notes"
  ];

  const SEGMENT_B_HEADERS = [
    "TC#",
    "Category",
    "Scenario",
    "Business Segment",
    "Routing ID POPA",
    "Routing ID POPB",
    "Routing ID PopC",
    "Test Persona",
    "Test data POPA",
    "POPB Test Data",
    "PopC Test Data",
    "Agent Expectation",
    "Pass Criteria",
    "Notes"
  ];

  /* ------------------------------------------------------------
     EXPORT COLUMN NAMES

     Export rows are built as { "Column Name": value } objects and
     the file is written by walking these lists. Reordering a list
     reorders the exported file. Nothing else has to change.
     ------------------------------------------------------------ */

  const LIBRARY_EXPORT_HEADERS = [
    "Vendor",
    "Business Segment",
    "Population",
    "Release Date",
    "Execution Key",
    "Scenario ID",
    "Intent",
    "Category",
    "Scenario",
    "Mock / Staging",
    "Test Persona",
    "Mock Data Persona",
    "Routing ID",
    "Device",
    "ANI",
    "Time Requirement",
    "Terminal Type",
    "Source Validation",
    "Source Test Steps",
    "Source Pass Criteria",
    "Assigned Call Number",
    "Step Order",
    "Call Name",
    "Call Type"
  ];

  const CALL_PLAN_EXPORT_HEADERS = [
    "Vendor",
    "Business Segment",
    "Population",
    "Release Date",
    "Call Number",
    "Call Name",
    "Call Type",
    "Scenario Count",
    "Scenario IDs in Execution Order",
    "User / Test-Data Profile",
    "Routing ID",
    "Device",
    "ANI",
    "Time Requirement",
    "Execution / Endpoint Guidance",
    "Call Script"
  ];

  const OVERVIEW_EXPORT_HEADERS = [
    "Section",
    "Item",
    "Value",
    "Detail"
  ];

  const LIBRARY_EXPORT_HEADERS_UNASSIGNED = [
    "Scenario ID",
    "Business Segment",
    "Population Applicability",
    "Intent",
    "Category",
    "Scenario",
    "Blocked Reason",
    "Source Validation"
  ];

  /* ------------------------------------------------------------
     INTENTS

     The intent decides call step order and which scenarios group
     together naturally. Add a new intent here, and give its family
     a rank in STAGE_RANK below if it should run at a particular
     point in a call.
     ------------------------------------------------------------ */

  const KNOWN_INTENTS = [
    "Identity_Verification",
    "Enrollment / Eligibility",
    "Eligibility",
    "Program Details",
    "Service Details",
    "Records",
    "Record Disputes",
    "Disputes",
    "Access Credential",
    "Directory Lookup",
    "Profile_Maintenance",
    "Account Activity",
    "Pre-Approval",
    "Billing",
    "SECONDARY_ACCOUNT",
    "Statements",
    "Cancel Service",
    "PRIMARY_CONTACT",
    "Renewal",
    "Special Account Closure"
  ];

  /* Call step order. Lower number runs earlier in the call.
     Anything not listed lands at 80, just before branches and
     hard terminals. */
  const STAGE_RANK = {
    IDENTITY_VERIFICATION: 10,
    ELIGIBILITY: 20,
    SERVICE_DETAILS: 30,
    PRE_APPROVAL: 30,
    RECORDS_DISPUTES: 40,
    ACCOUNT_ACTIVITY: 50,
    BILLING: 50,
    ACCESS_CREDENTIAL: 60,
    DIRECTORY_LOOKUP: 60,
    PROFILE_MAINTENANCE: 70,
    RENEWAL: 70,
    STATEMENTS: 70,
    PRIMARY_CONTACT: 70,
    SPECIAL_ACCOUNT_CLOSURE: 70
  };

  const STAGE_RANK_DEFAULT = 80;
  const STAGE_RANK_SOFT_BRANCH = 90;
  const STAGE_RANK_HARD_TERMINAL = 100;

  /* ------------------------------------------------------------
     PACKING PRIORITY WEIGHTS

     A scenario with more hard requirements is placed first,
     because it has the fewest calls it can legally join.
     Raising a number makes that requirement more urgent.
     ------------------------------------------------------------ */

  const CONSTRAINT_WEIGHTS = {
    explicitUser: 100,
    device: 40,
    ani: 40,
    routingId: 40,
    timeRequirement: 35,
    terminal: 30,
    perDependency: 25,
    perCondition: 8
  };

  /* ------------------------------------------------------------
     TEXT ANALYSIS
     ------------------------------------------------------------ */

  /* Words with no discriminating value. Built once, reused forever. */
  const STOP_WORDS = new Set([
    "the", "and", "for", "with", "that", "this", "from", "into", "then",
    "when", "where", "what", "which", "user", "caller", "qa", "agent",
    "test", "case", "flow", "system", "should", "will", "would", "can",
    "could", "must", "has", "have", "had", "are", "was", "were", "after",
    "before", "during"
  ]);

  return {
    BUILD_VERSION: BUILD_VERSION,
    BUILD_NAME: BUILD_NAME,
    SUPPORTED_SCHEMA_VERSION: SUPPORTED_SCHEMA_VERSION,

    MAX_SCENARIOS_PER_CALL_CEILING: MAX_SCENARIOS_PER_CALL_CEILING,
    PREFERRED_MINIMUM: PREFERRED_MINIMUM,
    CONSOLIDATION_SIMILARITY_THRESHOLD: CONSOLIDATION_SIMILARITY_THRESHOLD,

    SEGMENT: SEGMENT,
    SEGMENT_LABEL: SEGMENT_LABEL,
    POPULATIONS: POPULATIONS,
    POPULATION_LABELS: POPULATION_LABELS,
    VENDORS: VENDORS,

    TERMINAL: TERMINAL,
    HARD_TERMINALS: HARD_TERMINALS,
    DEVICE: DEVICE,
    ANI: ANI,
    TIME: TIME,

    SOURCE_VALIDATION_STATUSES: SOURCE_VALIDATION_STATUSES,
    REVIEW_REQUIRED_STATUSES: REVIEW_REQUIRED_STATUSES,

    MASTER_HEADERS: MASTER_HEADERS,
    MASTER_HEADER_ALIASES: MASTER_HEADER_ALIASES,
    SEGMENT_A_HEADERS: SEGMENT_A_HEADERS,
    SEGMENT_B_HEADERS: SEGMENT_B_HEADERS,

    LIBRARY_EXPORT_HEADERS: LIBRARY_EXPORT_HEADERS,
    LIBRARY_EXPORT_HEADERS_UNASSIGNED: LIBRARY_EXPORT_HEADERS_UNASSIGNED,
    CALL_PLAN_EXPORT_HEADERS: CALL_PLAN_EXPORT_HEADERS,
    OVERVIEW_EXPORT_HEADERS: OVERVIEW_EXPORT_HEADERS,

    KNOWN_INTENTS: KNOWN_INTENTS,
    STAGE_RANK: STAGE_RANK,
    STAGE_RANK_DEFAULT: STAGE_RANK_DEFAULT,
    STAGE_RANK_SOFT_BRANCH: STAGE_RANK_SOFT_BRANCH,
    STAGE_RANK_HARD_TERMINAL: STAGE_RANK_HARD_TERMINAL,

    CONSTRAINT_WEIGHTS: CONSTRAINT_WEIGHTS,
    STOP_WORDS: STOP_WORDS
  };
})();
