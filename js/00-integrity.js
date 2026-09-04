/* ==============================================================
   00-integrity.js
   --------------------------------------------------------------
   Offline guarantee. This file loads before everything else so
   that the network is closed before any other code can run.

   Three layers, because no single one is sufficient:

     1. A Content Security Policy in index.html. Chrome and Edge
        enforce it on a local file. Firefox and Safari do not
        enforce it reliably on file:// URLs, which is why the
        other two layers exist.

     2. The blocks installed below. Every browser API that can
        reach the network is replaced with one that refuses.
        Unconditional - there is no "test build" exemption.

     3. A resource audit run once the page has loaded, plus a
        watcher that keeps looking. If any external URL is found,
        the application refuses to import or export anything.

   Layer 3 is what makes this fail closed. A build that somehow
   reached a network would not silently work; it would stop.
   ============================================================== */

window.QA = window.QA || {};

QA.integrity = (function () {
  "use strict";

  const BLOCK_MESSAGE =
    "Blocked by the offline guarantee. This application never contacts a network.";

  const findings = [];
  let audited = false;

  function refuse(detail) {
    const error = new Error(BLOCK_MESSAGE + (detail ? " (" + detail + ")" : ""));
    error.name = "OfflineGuaranteeError";
    return error;
  }

  /* ------------------------------------------------------------
     LAYER 2 - CLOSE THE NETWORK APIS
     ------------------------------------------------------------ */

  function installBlocks() {
    if (typeof window.fetch === "function") {
      window.fetch = function () {
        return Promise.reject(refuse("fetch"));
      };
    }

    if (window.XMLHttpRequest) {
      const open = window.XMLHttpRequest.prototype.open;

      window.XMLHttpRequest.prototype.open = function (method, url) {
        /* Reading a local blob the app itself created is not a
           network request and stays allowed. */
        if (typeof url === "string" && /^blob:/i.test(url)) {
          return open.apply(this, arguments);
        }
        throw refuse("XMLHttpRequest " + url);
      };
    }

    if (window.WebSocket) {
      window.WebSocket = function () {
        throw refuse("WebSocket");
      };
    }

    if (window.EventSource) {
      window.EventSource = function () {
        throw refuse("EventSource");
      };
    }

    if (window.navigator && typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon = function () {
        return false;
      };
    }

    if (window.Worker) {
      const NativeWorker = window.Worker;

      window.Worker = function (url) {
        if (typeof url === "string" && /^blob:/i.test(url)) {
          return new NativeWorker(url);
        }
        throw refuse("Worker " + url);
      };
    }

    if (window.SharedWorker) {
      window.SharedWorker = function () {
        throw refuse("SharedWorker");
      };
    }

    if (window.navigator && navigator.serviceWorker) {
      try {
        navigator.serviceWorker.register = function () {
          return Promise.reject(refuse("ServiceWorker"));
        };
      } catch (error) {
        /* Some browsers make this read-only. The CSP still covers it. */
      }
    }
  }

  /* ------------------------------------------------------------
     LAYER 3 - AUDIT WHAT THE PAGE ACTUALLY LOADED
     ------------------------------------------------------------ */

  const URL_ATTRIBUTES = [
    ["script", "src"],
    ["link", "href"],
    ["img", "src"],
    ["image", "href"],
    ["iframe", "src"],
    ["frame", "src"],
    ["embed", "src"],
    ["object", "data"],
    ["source", "src"],
    ["track", "src"],
    ["audio", "src"],
    ["video", "src"],
    ["video", "poster"],
    ["input", "src"],
    ["use", "href"]
  ];

  /* A resource counts as external when it comes from anywhere other
     than this application itself. Local files, same-origin files and
     data or blob URLs the app made are internal. Anything on another
     host, and any websocket or ftp URL, is external.

     Being served from a local static server is a supported way to run
     this - it is what makes the Content Security Policy enforceable in
     Firefox and Safari - so a same-origin http://localhost script is
     not a finding. A page served from a remote host is, and that is
     reported separately by remoteHostFinding() below. */
  function isExternal(value) {
    if (!value) {
      return false;
    }

    const text = String(value).trim();

    if (/^(data:|blob:|#|javascript:|mailto:)/i.test(text)) {
      return false;
    }

    let resolved;

    try {
      resolved = new URL(text, document.baseURI);
    } catch (error) {
      return false;
    }

    if (/^(ws|wss|ftp|ftps):$/i.test(resolved.protocol)) {
      return true;
    }

    if (resolved.protocol === "file:") {
      return false;
    }

    if (/^https?:$/i.test(resolved.protocol)) {
      return resolved.origin !== window.location.origin;
    }

    return false;
  }

  /* The page itself must be local. Loopback and file are local;
     anything else means this copy is being served over a network. */
  const LOOPBACK = ["localhost", "127.0.0.1", "[::1]", "::1", ""];

  function remoteHostFinding() {
    if (window.location.protocol === "file:") {
      return "";
    }

    if (LOOPBACK.indexOf(window.location.hostname) >= 0) {
      return "";
    }

    return "page served from remote host " + window.location.host;
  }

  function auditElement(element) {
    if (!element || element.nodeType !== 1) {
      return;
    }

    const tag = String(element.tagName || "").toLowerCase();

    for (const pair of URL_ATTRIBUTES) {
      if (pair[0] !== tag) {
        continue;
      }

      const value = element.getAttribute(pair[1]);

      if (isExternal(value)) {
        findings.push(tag + "[" + pair[1] + "] " + value);
      }
    }

    /* An inline style can pull an image from a URL. */
    const style = element.getAttribute && element.getAttribute("style");
    if (style) {
      const matches = style.match(/url\((['"]?)([^'")]+)\1\)/gi) || [];
      for (const match of matches) {
        const inner = match.replace(/^url\((['"]?)/i, "").replace(/(['"]?)\)$/, "");
        if (isExternal(inner)) {
          findings.push(tag + "[style] " + inner);
        }
      }
    }
  }

  function audit() {
    findings.length = 0;

    auditElement(document.documentElement);
    const all = document.querySelectorAll("*");

    for (const element of all) {
      auditElement(element);
    }

    const remote = remoteHostFinding();

    if (remote) {
      findings.push(remote);
    }

    audited = true;
    return status();
  }

  function watch() {
    if (!window.MutationObserver) {
      return;
    }

    const observer = new MutationObserver(function (mutations) {
      let recheck = false;

      for (const mutation of mutations) {
        if (mutation.addedNodes && mutation.addedNodes.length) {
          recheck = true;
          break;
        }
        if (mutation.type === "attributes") {
          recheck = true;
          break;
        }
      }

      if (recheck) {
        const before = findings.length;
        audit();
        if (findings.length !== before) {
          publish();
        }
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "href", "data", "poster", "style"]
    });
  }

  /* ------------------------------------------------------------
     STATUS
     ------------------------------------------------------------ */

  function status() {
    const pass = audited && findings.length === 0;

    return {
      status: pass ? "PASS" : (audited ? "FAIL" : "PENDING"),
      externalResources: [...findings],
      detail: pass
        ? "No external resource is referenced and every network API is blocked."
        : (audited
            ? findings.length + " external resource(s) found, starting with " +
              findings.slice(0, 3).join("; ") +
              (findings.length > 3 ? ", and " + (findings.length - 3) + " more." : ".") +
              " The full list is in window.QA_OFFLINE_INTEGRITY."
            : "The resource audit has not run yet."),
      cspPresent: Boolean(
        document.querySelector('meta[http-equiv="Content-Security-Policy"]')
      ),
      protocol: window.location.protocol
    };
  }

  function isSafe() {
    return status().status === "PASS";
  }

  /* Data operations call this first. When the audit has failed the
     application does nothing rather than doing it unsafely. */
  function assertSafe(operation) {
    if (isSafe()) {
      return;
    }

    throw refuse(
      (operation || "operation") + " halted. " + status().detail
    );
  }

  function publish() {
    window.QA_OFFLINE_INTEGRITY = status();

    document.dispatchEvent(
      new CustomEvent("qa:integrity", { detail: window.QA_OFFLINE_INTEGRITY })
    );
  }

  function start() {
    audit();
    watch();
    publish();
  }

  installBlocks();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }

  return {
    audit: audit,
    status: status,
    isSafe: isSafe,
    assertSafe: assertSafe,
    isExternal: isExternal,
    publish: publish,
    BLOCK_MESSAGE: BLOCK_MESSAGE
  };
})();
