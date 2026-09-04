/* ==============================================================
   11-ui.js
   --------------------------------------------------------------
   Everything the person using the application sees and clicks.

   This file holds the current state of the workspace, draws it,
   and calls the modules above to do the actual work. It contains
   no test-planning rules of its own: if you are looking for why
   two scenarios ended up in different calls, that answer is in
   08-optimizer.js, not here.
   ============================================================== */

window.QA = window.QA || {};

QA.ui = (function () {
  "use strict";

  const C = QA.constants;
  const U = QA.utils;
  const M = QA.model;
  const I = QA.importer;
  const G = QA.consolidate;
  const O = QA.optimizer;
  const X = QA.exporter;

  /* ------------------------------------------------------------
     STATE

     Everything lives in memory and in this object. Nothing is
     written to local storage, session storage or a database, so
     closing the tab leaves nothing behind.
     ------------------------------------------------------------ */

  const state = {
    view: "intake",

    /* Locked as soon as scenarios are loaded, because export
       column layouts depend on it. Changing it mid-session used to
       silently write the wrong columns. */
    segment: C.SEGMENT.A,

    vendor: C.VENDORS[0],
    releaseDate: "",
    maxPerCall: 8,

    files: [],
    records: [],
    cases: [],

    duplicatesRemoved: [],
    groups: [],
    merges: [],

    result: null
  };

  /* ------------------------------------------------------------
     SMALL DOM HELPERS
     ------------------------------------------------------------ */

  function $(id) {
    return document.getElementById(id);
  }

  function el(tag, options, children) {
    const node = document.createElement(tag);
    const settings = options || {};

    if (settings.className) { node.className = settings.className; }
    if (settings.text !== undefined) { node.textContent = settings.text; }

    for (const key of Object.keys(settings.attrs || {})) {
      node.setAttribute(key, settings.attrs[key]);
    }

    for (const child of children || []) {
      if (child) {
        node.appendChild(child);
      }
    }

    return node;
  }

  function clear(node) {
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  function notice(node, tone, message, bullets) {
    clear(node);
    node.hidden = false;
    node.setAttribute("data-tone", tone);
    node.appendChild(el("p", { text: message }));

    if (bullets && bullets.length) {
      node.appendChild(
        el("ul", {}, bullets.map(function (line) {
          return el("li", { text: line });
        }))
      );
    }
  }

  function hide(node) {
    node.hidden = true;
    clear(node);
  }

  /* ------------------------------------------------------------
     LEDGER STRIP
     ------------------------------------------------------------ */

  function renderLedger(node, entries) {
    clear(node);

    entries.forEach(function (entry) {
      const item = el("div", {
        className: "ledger__item" + (entry.total ? " ledger__item--total" : "")
      }, [
        el("p", { className: "ledger__value", text: String(entry.value) }),
        el("p", { className: "ledger__label", text: entry.label })
      ]);

      if (entry.tone) {
        item.setAttribute("data-tone", entry.tone);
      }

      node.appendChild(item);
    });
  }

  /* ------------------------------------------------------------
     VIEW SWITCHING
     ------------------------------------------------------------ */

  const VIEW_COPY = {
    intake: {
      title: "Intake",
      lede:
        "Load a scenario package, see exactly what was accepted, and settle " +
        "anything that needs a decision before planning calls."
    },
    plan: {
      title: "Call plan",
      lede:
        "Every scenario placed into the fewest calls its constraints allow, " +
        "in the order a tester will work through them."
    }
  };

  function setView(view) {
    state.view = view;

    $("view-intake").hidden = view !== "intake";
    $("view-plan").hidden = view !== "plan";

    $("stageTitle").textContent = VIEW_COPY[view].title;
    $("stageLede").textContent = VIEW_COPY[view].lede;

    document.querySelectorAll(".spine__link").forEach(function (link) {
      const isCurrent = link.getAttribute("data-view") === view;
      link.classList.toggle("is-current", isCurrent);

      if (isCurrent) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });

    $("stage").focus();
    window.scrollTo(0, 0);
  }

  function setPipeline(step) {
    const order = ["import", "validate", "consolidate", "optimize", "export"];
    const position = order.indexOf(step);

    document.querySelectorAll(".pipeline__step").forEach(function (node, index) {
      node.classList.toggle("is-done", index < position);
      node.classList.toggle("is-current", index === position);
    });
  }

  /* ------------------------------------------------------------
     SEGMENT MODE
     ------------------------------------------------------------ */

  const SEGMENT_NOTES = {
    CB: "Segment A scenarios run once each.",
    GB: "Segment B scenarios run once per population they apply to."
  };

  function setSegment(segment) {
    if (state.cases.length) {
      return;
    }

    state.segment = segment;

    document.querySelectorAll(".segment__option").forEach(function (button) {
      const isActive = button.getAttribute("data-segment") === segment;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-checked", isActive ? "true" : "false");
    });

    $("segmentNote").textContent = SEGMENT_NOTES[segment];
  }

  function refreshSegmentLock() {
    const locked = state.cases.length > 0;

    document.querySelectorAll(".segment__option").forEach(function (button) {
      button.disabled = locked;
    });

    $("segmentLock").hidden = !locked;
  }

  /* ------------------------------------------------------------
     INTAKE
     ------------------------------------------------------------ */

  async function handleFiles(fileList, kind) {
    const files = [...fileList];

    if (!files.length) {
      return;
    }

    try {
      QA.integrity.assertSafe("Import");
    } catch (error) {
      notice($("importNotice"), "fail", error.message);
      return;
    }

    if (!state.releaseDate && kind === "sheet") {
      notice(
        $("importNotice"),
        "warn",
        "Set a release date before loading a spreadsheet. A spreadsheet does " +
        "not carry one, and the release date is a call boundary."
      );
      return;
    }

    const problems = [];

    for (const file of files) {
      const result = await I.importFile(file, {
        segment: state.segment,
        vendor: state.vendor,
        releaseDate: state.releaseDate
      });

      state.files.push({
        name: file.name,
        size: file.size,
        format: result.format,
        accepted: result.counts.accepted,
        total: result.counts.total
      });

      if (!result.ok) {
        problems.push(file.name + ": " + result.errors.join(" "));
        continue;
      }

      /* A row that names the other business segment is refused rather
         than loaded into the wrong mode. Its columns, its populations
         and its export layout all differ, and importing it here would
         mean quietly planning it under the wrong set of rules. */
      const wrongSegment = new Set(
        result.accepted
          .filter(function (testCase) {
            return testCase.businessSegment !== state.segment;
          })
          .map(function (testCase) { return testCase.id; })
      );

      if (wrongSegment.size) {
        problems.push(
          file.name + ": " + wrongSegment.size + " " +
          U.pluralise(wrongSegment.size, "row") + " name " +
          "the other business segment and " +
          U.pluralise(wrongSegment.size, "was", "were") + " not imported. " +
          "Switch the mode in the left spine and load the file again."
        );
      }

      /* Records from every file accumulate, so the ledger always
         accounts for everything that was ever loaded. */
      const offset = state.records.length;

      result.records.forEach(function (record) {
        const rejected = wrongSegment.has(record.scenarioId);

        state.records.push(Object.assign({}, record, {
          rowNumber: offset + record.rowNumber,
          sourceFile: file.name,
          disposition: rejected ? "INVALID_FIELD" : record.disposition,
          testCase: rejected ? null : record.testCase,
          problems: rejected
            ? (record.problems || []).concat([
                "businessSegment: names the other business segment, and " +
                C.SEGMENT_LABEL[state.segment] + " is selected."
              ])
            : record.problems
        }));
      });

      result.accepted
        .filter(function (testCase) { return !wrongSegment.has(testCase.id); })
        .forEach(function (testCase) {
          testCase.sourceOrder = state.cases.length + 1;
          testCase.vendor = testCase.vendor || state.vendor;
          testCase.releaseDate = testCase.releaseDate || state.releaseDate;
          M.deriveExecutionFields(testCase, state.segment);
          state.cases.push(testCase);
        });
    }

    if (problems.length) {
      notice($("importNotice"), "warn", "Not everything was imported.", problems);
    } else {
      hide($("importNotice"));
    }

    afterImport();
  }

  function afterImport() {
    const deduped = G.removeExactDuplicates(state.cases, state.segment);

    state.duplicatesRemoved = deduped.removed;
    state.cases = deduped.kept;

    state.groups = G.findGroups(state.cases, state.segment);
    state.result = null;

    refreshSegmentLock();
    renderFileList();
    renderReconciliation();
    renderConsolidation();
    renderLibrary();

    setPipeline(state.groups.length ? "consolidate" : "optimize");

    $("navIntakeNote").textContent =
      state.cases.length + " " + U.pluralise(state.cases.length, "scenario") + " loaded";

    document.querySelector('[data-view="plan"]').disabled = true;
    $("navPlanNote").textContent = "Ready to plan";
  }

  function renderFileList() {
    const node = $("fileList");
    clear(node);

    state.files.forEach(function (file) {
      node.appendChild(el("li", {}, [
        el("span", { className: "filelist__name", text: file.name }),
        el("span", {
          className: "filelist__meta",
          text: file.format + " · " + U.formatFileSize(file.size) +
            " · " + file.accepted + "/" + file.total + " rows accepted"
        })
      ]));
    });
  }

  function counts() {
    const totals = { total: 0, accepted: 0, invalid: 0, missingRequired: 0 };

    state.records.forEach(function (record) {
      totals.total++;

      if (record.disposition === "ACCEPTED") {
        totals.accepted++;
      } else if (record.disposition === "MISSING_REQUIRED") {
        totals.missingRequired++;
      } else {
        totals.invalid++;
      }
    });

    return totals;
  }

  function renderReconciliation() {
    const panel = $("reconciliationPanel");

    if (!state.records.length) {
      panel.hidden = true;
      return;
    }

    panel.hidden = false;

    const totals = counts();
    const merged = state.merges.reduce(function (sum, merge) {
      return sum + merge.droppedIds.length;
    }, 0);

    renderLedger($("ledgerStrip"), [
      { value: totals.total, label: "rows read" },
      { value: totals.accepted, label: "accepted", tone: "pass" },
      {
        value: totals.missingRequired,
        label: "missing a required field",
        tone: totals.missingRequired ? "fail" : null
      },
      {
        value: totals.invalid,
        label: "invalid value",
        tone: totals.invalid ? "fail" : null
      },
      {
        value: state.duplicatesRemoved.length,
        label: "exact duplicates removed",
        tone: state.duplicatesRemoved.length ? "warn" : null
      },
      {
        value: merged,
        label: "consolidated by review",
        tone: merged ? "warn" : null
      },
      { value: state.cases.length, label: "final scenarios", total: true }
    ]);

    renderLedgerTable();
  }

  const DISPOSITION_TONE = {
    ACCEPTED: "pass",
    INVALID_FIELD: "fail",
    MISSING_REQUIRED: "fail",
    EXACT_DUPLICATE: "warn"
  };

  function renderLedgerTable() {
    const body = $("ledgerBody");
    clear(body);

    state.records.forEach(function (record) {
      const disposition = el("td", { text: record.disposition });
      disposition.setAttribute("data-tone", DISPOSITION_TONE[record.disposition] || "");

      body.appendChild(el("tr", {}, [
        el("td", { className: "cell-id", text: String(record.rowNumber) }),
        el("td", { className: "cell-id", text: record.scenarioId || "—" }),
        disposition,
        el("td", { text: (record.problems || []).join(" | ") || "—" })
      ]));
    });

    state.duplicatesRemoved.forEach(function (entry) {
      const disposition = el("td", { text: "EXACT_DUPLICATE" });
      disposition.setAttribute("data-tone", "warn");

      body.appendChild(el("tr", {}, [
        el("td", { className: "cell-id", text: String(entry.removedRow) }),
        el("td", { className: "cell-id", text: entry.removedId }),
        disposition,
        el("td", { text: "Identical to " + entry.retainedId + ", which was kept." })
      ]));
    });
  }

  /* ------------------------------------------------------------
     CONSOLIDATION REVIEW
     ------------------------------------------------------------ */

  function renderConsolidation() {
    const panel = $("consolidationPanel");
    const container = $("consolidationGroups");

    clear(container);

    if (!state.groups.length) {
      panel.hidden = state.cases.length === 0;
      $("consolidationNote").textContent =
        "No two scenarios look close enough to be the same test written twice.";
      $("consolidationActions").hidden = true;
      return;
    }

    panel.hidden = false;
    $("consolidationActions").hidden = false;

    $("consolidationNote").textContent =
      state.groups.length + " " + U.pluralise(state.groups.length, "group") +
      " of scenarios scored at or above " + C.CONSOLIDATION_SIMILARITY_THRESHOLD +
      " out of 100 against each other. Nothing has been removed. Choose what " +
      "to do with each group; the first scenario listed is the one that would " +
      "be kept.";

    state.groups.forEach(function (group) {
      container.appendChild(renderGroup(group));
    });
  }

  function renderGroup(group) {
    const members = el("div", { className: "group__members" },
      group.members.map(function (member) {
        return el("div", { className: "group__member" }, [
          el("span", { className: "group__member-id", text: member.id }),
          el("span", { text: member.scenario })
        ]);
      })
    );

    const decision = el("div", { className: "group__decision" }, [
      radio(group, "KEEP_ALL", "Keep every scenario"),
      radio(group, "MERGE", "Keep the first, fold the rest into it")
    ]);

    return el("div", { className: "group" }, [
      el("div", { className: "group__head" }, [
        el("span", { className: "group__id", text: group.groupId }),
        el("span", { text: group.intent }),
        group.population ? el("span", { className: "chip chip--population", text: group.population }) : null,
        el("span", {
          className: "group__score",
          text: group.minScore === group.maxScore
            ? group.minScore + "/100"
            : group.minScore + "–" + group.maxScore + "/100"
        })
      ]),
      el("p", {
        className: "group__reasons",
        text: group.reasons.length
          ? "Matched on: " + group.reasons.join(", ") + "."
          : "Matched on overall wording."
      }),
      members,
      decision
    ]);
  }

  function radio(group, value, labelText) {
    const input = el("input", {
      attrs: { type: "radio", name: group.groupId, value: value }
    });

    input.checked = group.decision === value;

    input.addEventListener("change", function () {
      if (input.checked) {
        group.decision = value;
      }
    });

    return el("label", {}, [input, el("span", { text: labelText })]);
  }

  function applyConsolidation() {
    const outcome = G.applyDecisions(state.cases, state.groups);

    state.cases = outcome.kept;
    state.merges = state.merges.concat(outcome.merges);
    state.groups = G.findGroups(state.cases, state.segment);
    state.result = null;

    renderReconciliation();
    renderConsolidation();
    renderLibrary();
    setPipeline("optimize");
  }

  /* ------------------------------------------------------------
     SCENARIO LIBRARY
     ------------------------------------------------------------ */

  function renderLibrary() {
    const panel = $("libraryPanel");

    if (!state.cases.length) {
      panel.hidden = true;
      return;
    }

    panel.hidden = false;

    const needingReview = state.cases.filter(function (testCase) {
      return C.REVIEW_REQUIRED_STATUSES.has(testCase.sourceValidationStatus);
    }).length;

    $("libraryNote").textContent =
      state.cases.length + " " + U.pluralise(state.cases.length, "scenario") +
      " ready to plan." +
      (needingReview
        ? " " + needingReview + " " + U.pluralise(needingReview, "carries", "carry") +
          " a source status that needs a person to look at it before execution."
        : "");

    const body = $("libraryBody");
    clear(body);

    state.cases.forEach(function (testCase) {
      const terminal = QA.classify.isHardTerminal(testCase.terminalType);
      const terminalCell = el("td", { text: terminal ? testCase.terminalType : "—" });

      if (terminal) {
        terminalCell.setAttribute("data-tone", "warn");
      }

      const sourceCell = el("td", { text: testCase.sourceValidationStatus || "—" });

      if (C.REVIEW_REQUIRED_STATUSES.has(testCase.sourceValidationStatus)) {
        sourceCell.setAttribute("data-tone", "warn");
      }

      body.appendChild(el("tr", {}, [
        el("td", { className: "cell-id", text: testCase.id }),
        el("td", { text: testCase.intent }),
        el("td", { className: "cell-wide", text: testCase.scenario }),
        el("td", {
          text: state.segment === C.SEGMENT.B
            ? (M.populationLabel(testCase) || "not mapped")
            : "—"
        }),
        el("td", { text: testCase.device }),
        el("td", { text: testCase.ani }),
        terminalCell,
        sourceCell
      ]));
    });
  }

  /* ------------------------------------------------------------
     OPTIMIZE
     ------------------------------------------------------------ */

  function optimize() {
    hide($("optimizeNotice"));

    if (!state.cases.length) {
      notice($("optimizeNotice"), "warn", "Load scenarios before planning calls.");
      return;
    }

    const missingBoundaries = state.cases.filter(function (testCase) {
      return !testCase.vendor || !testCase.releaseDate;
    });

    if (missingBoundaries.length) {
      notice(
        $("optimizeNotice"),
        "fail",
        missingBoundaries.length + " " +
        U.pluralise(missingBoundaries.length, "scenario") +
        " has no vendor or no release date. Both are call boundaries, so " +
        "planning is stopped rather than guessing.",
        missingBoundaries.slice(0, 8).map(function (testCase) {
          return testCase.id + ": " +
            (testCase.vendor ? "" : "no vendor. ") +
            (testCase.releaseDate ? "" : "no release date.");
        })
      );
      return;
    }

    try {
      state.result = O.run(state.cases, {
        segment: state.segment,
        maxScenariosPerCall: state.maxPerCall
      });
    } catch (error) {
      notice($("optimizeNotice"), "fail", error.message);
      return;
    }

    renderPlan();

    document.querySelector('[data-view="plan"]').disabled = false;
    $("navPlanNote").textContent =
      state.result.calls.length + " " +
      U.pluralise(state.result.calls.length, "call") + " planned";

    setPipeline("export");
    setView("plan");
  }

  /* ------------------------------------------------------------
     PLAN RENDERING
     ------------------------------------------------------------ */

  function renderPlan() {
    const result = state.result;

    const failures = result.validation.filter(function (check) {
      return check.status === "FAIL";
    }).length;

    const warnings = result.validation.filter(function (check) {
      return check.status === "WARN";
    }).length;

    const smallCalls = result.calls.filter(function (call) {
      return call.items.length < Math.min(C.PREFERRED_MINIMUM, result.maxPerCall);
    }).length;

    renderLedger($("planStrip"), [
      { value: state.cases.length, label: "scenarios" },
      { value: result.instances.length, label: "execution instances" },
      {
        value: result.blocked.length,
        label: "held back",
        tone: result.blocked.length ? "warn" : null
      },
      {
        value: smallCalls,
        label: "calls below preferred minimum",
        tone: smallCalls ? "warn" : null
      },
      {
        value: failures
          ? failures + " failed"
          : (warnings ? warnings + " to review" : "All pass"),
        label: "validation",
        tone: failures ? "fail" : (warnings ? "warn" : "pass")
      },
      { value: result.calls.length, label: "physical calls", total: true }
    ]);

    renderValidation(result.validation);
    renderBlocked(result.blocked);
    renderCalls(result);

    $("exportPlanBtn").disabled = failures > 0;

    if (failures) {
      notice(
        $("exportNotice"),
        "fail",
        "Export is disabled because the plan failed validation. " +
        "A failing plan must not be executed."
      );
    } else {
      hide($("exportNotice"));
    }
  }

  function renderValidation(checks) {
    const list = $("validationList");
    clear(list);

    checks.forEach(function (check) {
      const item = el("li", {}, [
        el("span", { className: "checklist__status", text: check.status }),
        el("span", { className: "checklist__label" }, [
          document.createTextNode(check.label),
          el("span", { className: "checklist__detail", text: check.detail })
        ])
      ]);

      item.setAttribute("data-status", check.status);
      list.appendChild(item);
    });
  }

  function renderBlocked(blocked) {
    const panel = $("blockedPanel");

    if (!blocked.length) {
      panel.hidden = true;
      return;
    }

    panel.hidden = false;

    $("blockedNote").textContent =
      blocked.length + " " + U.pluralise(blocked.length, "scenario") +
      " could not be placed and is listed here rather than dropped. " +
      "Map its population in the source package and load it again.";

    const list = $("blockedList");
    clear(list);

    blocked.forEach(function (entry) {
      list.appendChild(el("li", {}, [
        el("span", { className: "cell-id", text: entry.id }),
        el("span", { text: readableReason(entry.reason) })
      ]));
    });
  }

  const REASON_TEXT = {
    SEGMENT_B_POPULATION_MAPPING_REQUIRED:
      "No population is mapped. A Segment B scenario has to name the " +
      "populations it applies to; an empty list is not read as all of them."
  };

  function readableReason(reason) {
    return REASON_TEXT[reason] || reason;
  }

  function renderCalls(result) {
    const container = $("callsList");
    clear(container);

    const preferredMinimum = Math.min(C.PREFERRED_MINIMUM, result.maxPerCall);

    $("callsNote").textContent =
      result.calls.length + " " + U.pluralise(result.calls.length, "call") +
      " covering " + result.instances.length + " execution " +
      U.pluralise(result.instances.length, "instance") +
      ". Call numbers start again for each vendor and release, because a " +
      "call never spans either. Steps run top to bottom.";

    /* Calls are grouped under the boundary they belong to. Without the
       heading, two calls both numbered 1 would look like a mistake
       rather than two separate vendors each starting from one. */
    const groups = new Map();

    result.calls.forEach(function (call) {
      const key = O.boundaryKey(call.items[0]);

      if (!groups.has(key)) {
        groups.set(key, []);
      }

      groups.get(key).push(call);
    });

    U.sortedEntries(groups).forEach(function (entry) {
      const calls = entry[1];
      const first = calls[0];

      container.appendChild(
        el("h3", {
          className: "calls__group",
          text: first.vendor + ", release " + (first.releaseDate || "unspecified") +
            " — " + calls.length + " " + U.pluralise(calls.length, "call")
        })
      );

      calls.forEach(function (call) {
        container.appendChild(renderCall(call, preferredMinimum, result.maxPerCall));
      });
    });
  }

  function renderCall(call, preferredMinimum, maxPerCall) {
    const chips = [];

    if (call.population) {
      chips.push(el("span", { className: "chip chip--population", text: call.population }));
    }

    chips.push(el("span", { className: "chip", text: call.vendor }));
    chips.push(el("span", { className: "chip", text: call.releaseDate }));
    chips.push(el("span", { className: "chip", text: call.callType }));

    const device = O.hardDevice(call.items);
    if (device !== C.DEVICE.ANY) {
      chips.push(el("span", { className: "chip", text: "Device: " + device }));
    }

    const ani = O.hardANI(call.items);
    if (ani !== C.ANI.ANY) {
      chips.push(el("span", { className: "chip", text: "ANI: " + ani }));
    }

    const time = O.hardTime(call.items);
    if (time !== C.TIME.ANY) {
      chips.push(el("span", { className: "chip", text: time.replace(/_/g, " ").toLowerCase() }));
    }

    const routing = O.hardRoutingId(call.items);
    if (routing) {
      chips.push(el("span", { className: "chip", text: "Routing " + routing }));
    }

    if (call.items.length < preferredMinimum) {
      chips.push(el("span", {
        className: "chip chip--terminal",
        text: "Below preferred minimum"
      }));
    }

    const steps = el("ol", { className: "call__steps" },
      call.items.map(function (item, index) {
        return renderStep(item, index + 1);
      })
    );

    const scriptId = "script-" + call.vendor + "-" + call.callNumber;

    const scriptToggle = el("button", {
      className: "button button--quiet call__script-toggle",
      text: "Show the call script",
      attrs: { type: "button", "aria-expanded": "false", "aria-controls": scriptId }
    });

    const script = el("pre", {
      className: "call__script",
      text: call.callScript,
      attrs: { id: scriptId }
    });

    script.hidden = true;

    scriptToggle.addEventListener("click", function () {
      const showing = !script.hidden;
      script.hidden = showing;
      scriptToggle.setAttribute("aria-expanded", showing ? "false" : "true");
      scriptToggle.textContent = showing ? "Show the call script" : "Hide the call script";
    });

    return el("article", { className: "call" }, [
      el("div", { className: "call__head" }, [
        el("span", { className: "call__number", text: "Call " + call.callNumber }),
        el("h3", { className: "call__name", text: call.callName }),
        el("span", {
          className: "call__count",
          text: call.items.length + "/" + maxPerCall
        })
      ]),
      el("div", { className: "call__meta" }, chips),
      steps,
      el("p", { className: "call__guidance", text: call.endpointGuidance }),
      scriptToggle,
      script
    ]);
  }

  function renderStep(item, stepNumber) {
    const isTerminal = QA.classify.isHardTerminal(item.terminalType);

    const node = el("li", { className: "call__step" }, [
      el("div", { className: "call__step-head" }, [
        el("span", { className: "call__step-id", text: item.id }),
        el("span", { className: "call__step-intent", text: item.intent })
      ]),
      el("p", { className: "call__step-text", text: item.scenario }),
      isTerminal
        ? el("p", {
            className: "call__step-note",
            text: "Ends the call: " + item.terminalType.toLowerCase() + "."
          })
        : null
    ]);

    node.setAttribute("data-step", String(stepNumber));
    node.classList.toggle("is-terminal", isTerminal);

    return node;
  }

  /* ------------------------------------------------------------
     EXPORTS
     ------------------------------------------------------------ */

  function intakeSummary() {
    return {
      counts: counts(),
      duplicatesRemoved: state.duplicatesRemoved.length,
      merges: state.merges.reduce(function (sum, merge) {
        return sum + merge.droppedIds.length;
      }, 0),
      finalCount: state.cases.length,
      sourceLabel: state.files.map(function (file) { return file.name; }).join(", "),
      fileBase: state.files.length ? state.files[0].name : "QA_Call_Plan",
      integrity: QA.integrity.status()
    };
  }

  function guardedExport(button, noticeNode, run) {
    try {
      QA.integrity.assertSafe("Export");
      const names = run();
      notice(
        noticeNode,
        "pass",
        names.length === 1
          ? "Saved " + names[0] + "."
          : "Saving " + names.length + " files:",
        names.length === 1 ? null : names
      );
    } catch (error) {
      notice(noticeNode, "fail", error.message);
    }
  }

  /* ------------------------------------------------------------
     SELF TEST
     ------------------------------------------------------------ */

  function runSelfTest() {
    const summary = QA.selftest.run();

    renderLedger($("selfTestStrip"), [
      { value: summary.total, label: "checks" },
      { value: summary.passed, label: "passed", tone: "pass" },
      { value: summary.failed, label: "failed", tone: summary.failed ? "fail" : null },
      {
        value: summary.failed ? "Review" : "Healthy",
        label: "verdict",
        total: true
      }
    ]);

    const list = $("selfTestList");
    clear(list);

    summary.results.forEach(function (item) {
      const node = el("li", {}, [
        el("span", { className: "checklist__status", text: item.status }),
        el("span", { className: "checklist__label" }, [
          document.createTextNode(item.name),
          el("span", { className: "checklist__detail", text: item.detail })
        ])
      ]);

      node.setAttribute("data-status", item.status);
      list.appendChild(node);
    });

    $("selfTestDialog").showModal();
  }

  /* ------------------------------------------------------------
     RESET
     ------------------------------------------------------------ */

  function clearWorkspace() {
    state.files = [];
    state.records = [];
    state.cases = [];
    state.duplicatesRemoved = [];
    state.groups = [];
    state.merges = [];
    state.result = null;

    $("packageInput").value = "";
    $("sheetInput").value = "";

    refreshSegmentLock();
    renderFileList();

    $("reconciliationPanel").hidden = true;
    $("consolidationPanel").hidden = true;
    $("libraryPanel").hidden = true;

    hide($("importNotice"));
    hide($("optimizeNotice"));
    hide($("exportNotice"));

    document.querySelector('[data-view="plan"]').disabled = true;
    $("navPlanNote").textContent = "Waiting on scenarios";
    $("navIntakeNote").textContent = "No package loaded";

    setPipeline("import");
    setView("intake");
  }

  /* ------------------------------------------------------------
     INTEGRITY INDICATOR
     ------------------------------------------------------------ */

  function renderIntegrity(status) {
    const panel = $("integrityPanel");

    panel.setAttribute(
      "data-state",
      status.status === "PASS" ? "pass" : (status.status === "FAIL" ? "fail" : "pending")
    );

    $("integrityStatus").textContent =
      status.status === "PASS"
        ? "Offline, verified"
        : (status.status === "FAIL" ? "Offline check failed" : "Checking");

    $("integrityDetail").textContent = status.detail;
  }

  /* ------------------------------------------------------------
     DROP ZONES
     ------------------------------------------------------------ */

  function wireDropzone(zoneId, inputId, kind) {
    const zone = $(zoneId);
    const input = $(inputId);

    zone.addEventListener("click", function () {
      input.click();
    });

    zone.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        input.click();
      }
    });

    input.addEventListener("change", function () {
      handleFiles(input.files, kind);
      input.value = "";
    });

    ["dragenter", "dragover"].forEach(function (name) {
      zone.addEventListener(name, function (event) {
        event.preventDefault();
        zone.classList.add("is-over");
      });
    });

    ["dragleave", "drop"].forEach(function (name) {
      zone.addEventListener(name, function (event) {
        event.preventDefault();
        zone.classList.remove("is-over");
      });
    });

    zone.addEventListener("drop", function (event) {
      if (event.dataTransfer && event.dataTransfer.files.length) {
        handleFiles(event.dataTransfer.files, kind);
      }
    });
  }

  /* ------------------------------------------------------------
     START
     ------------------------------------------------------------ */

  function fillControls() {
    const vendorSelect = $("vendorSelect");

    C.VENDORS.forEach(function (vendor) {
      vendorSelect.appendChild(el("option", { text: vendor, attrs: { value: vendor } }));
    });

    vendorSelect.value = state.vendor;

    const maxSelect = $("maxPerCallSelect");

    for (let value = 1; value <= C.MAX_SCENARIOS_PER_CALL_CEILING; value++) {
      maxSelect.appendChild(
        el("option", { text: String(value), attrs: { value: String(value) } })
      );
    }

    maxSelect.value = String(state.maxPerCall);

    $("schemaVersionLabel").textContent = C.SUPPORTED_SCHEMA_VERSION;
    $("buildStamp").textContent = C.BUILD_VERSION;
    updatePreferredMinimumHint();
  }

  function updatePreferredMinimumHint() {
    const preferred = Math.min(C.PREFERRED_MINIMUM, state.maxPerCall);

    $("preferredMinimumHint").textContent =
      "The planner aims for at least " + preferred + " per call and never " +
      "exceeds " + state.maxPerCall + ".";
  }

  function wire() {
    fillControls();

    document.querySelectorAll(".spine__link").forEach(function (link) {
      link.addEventListener("click", function () {
        setView(link.getAttribute("data-view"));
      });
    });

    document.querySelectorAll(".segment__option").forEach(function (button) {
      button.addEventListener("click", function () {
        setSegment(button.getAttribute("data-segment"));
      });
    });

    $("vendorSelect").addEventListener("change", function (event) {
      state.vendor = event.target.value;
    });

    $("releaseInput").addEventListener("change", function (event) {
      const parsed = U.parseDate(event.target.value);
      state.releaseDate = parsed.ok ? parsed.value : "";
    });

    $("maxPerCallSelect").addEventListener("change", function (event) {
      state.maxPerCall = Number(event.target.value);
      updatePreferredMinimumHint();
    });

    wireDropzone("packageZone", "packageInput", "package");
    wireDropzone("sheetZone", "sheetInput", "sheet");

    $("applyConsolidationBtn").addEventListener("click", applyConsolidation);
    $("optimizeBtn").addEventListener("click", optimize);
    $("clearWorkspaceBtn").addEventListener("click", clearWorkspace);
    $("backToIntakeBtn").addEventListener("click", function () {
      setView("intake");
    });

    $("exportLedgerBtn").addEventListener("click", function () {
      guardedExport($("exportLedgerBtn"), $("importNotice"), function () {
        return X.exportIntakeLedger(state.records, intakeSummary().fileBase);
      });
    });

    $("exportLibraryBtn").addEventListener("click", function () {
      guardedExport($("exportLibraryBtn"), $("optimizeNotice"), function () {
        return X.exportScenarioLibrary(
          state.cases, state.segment, intakeSummary().fileBase
        );
      });
    });

    $("exportPlanBtn").addEventListener("click", function () {
      guardedExport($("exportPlanBtn"), $("exportNotice"), function () {
        const byId = new Map(state.cases.map(function (testCase) {
          return [testCase.id, testCase];
        }));

        return X.exportCallPlan(state.result, intakeSummary(), byId);
      });
    });

    $("openSelfTestBtn").addEventListener("click", runSelfTest);

    document.addEventListener("qa:integrity", function (event) {
      renderIntegrity(event.detail);
    });

    renderIntegrity(QA.integrity.status());
    setSegment(state.segment);
    refreshSegmentLock();
    setPipeline("import");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }

  return { state: state, optimize: optimize, clearWorkspace: clearWorkspace };
})();
