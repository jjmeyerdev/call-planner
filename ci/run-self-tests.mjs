/* ==============================================================
   run-self-tests.mjs
   --------------------------------------------------------------
   Runs the twenty checks in js/10-selftest.js in a real headless
   Chrome and exits non-zero if any of them fail.

   The application has no dependencies, and neither does this. It
   uses only what Node ships with: an http server for the pages,
   and the built-in WebSocket to speak the Chrome DevTools
   Protocol. Adding Playwright or Puppeteer here would put a
   node_modules tree next to a project whose entire premise is
   that it has none.

   The page is served over http rather than opened as a file://
   URL on purpose. Firefox and Safari do not enforce the Content
   Security Policy on local files, and check T20 asserts the
   policy is present and the integrity audit passed, so the run
   should happen under the same conditions the README recommends.
   ============================================================== */

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OVERALL_TIMEOUT_MS = 90_000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".tsv": "text/tab-separated-values; charset=utf-8"
};

/* ------------------------------------------------------------
   STATIC SERVER
   ------------------------------------------------------------ */

function startServer() {
  const server = createServer(async (request, response) => {
    const requested = decodeURIComponent(new URL(request.url, "http://x").pathname);
    const relative = normalize(requested).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
    const target = join(ROOT, relative === "" ? "index.html" : relative);

    /* Never serve anything outside the project folder. */
    if (!target.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) {
      response.writeHead(403).end("Forbidden");
      return;
    }

    try {
      const body = await readFile(target);
      response.writeHead(200, { "content-type": MIME[extname(target)] || "application/octet-stream" });
      response.end(body);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

/* ------------------------------------------------------------
   CHROME
   ------------------------------------------------------------ */

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].filter(Boolean);

  const found = candidates.find((path) => existsSync(path));
  if (!found) {
    throw new Error(
      "No Chrome found. Set CHROME_PATH, or install Google Chrome / Chromium.\nLooked in:\n  " +
      candidates.join("\n  ")
    );
  }
  return found;
}

async function waitForDevTools(port) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* Chrome is still starting. */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Chrome did not expose a debuggable page within 30s.");
}

/* ------------------------------------------------------------
   DEVTOOLS PROTOCOL
   ------------------------------------------------------------ */

function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 0;

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);

    if (message.id !== undefined && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      message.error ? reject(new Error(message.error.message)) : resolve(message.result);
      return;
    }

    /* Surface anything the page complains about. A thrown error
       during load would otherwise show up only as a timeout. */
    if (message.method === "Runtime.exceptionThrown") {
      const detail = message.params.exceptionDetails;
      console.error("  page exception: " + (detail.exception?.description || detail.text));
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      console.error("  page console.error: " + message.params.args.map((a) => a.value ?? a.description).join(" "));
    }
  });

  const ready = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("Could not connect to Chrome.")), { once: true });
  });

  function send(method, params = {}) {
    const id = nextId++;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  }

  return { ready, send, close: () => socket.close() };
}

/* The page is polled rather than raced against a load event: the
   twelve scripts are plain tags with no module graph, so the only
   signal that they are all in is QA.selftest existing.

   That alone is not enough to start. 00-integrity.js runs its
   resource audit on DOMContentLoaded, which is after 10-selftest.js
   has parsed, so QA.selftest can exist while QA.integrity.status()
   is still PENDING - and check T20 asserts the audit passed, not
   that it is pending. Waiting for both makes the run depend on the
   page being ready rather than on how fast the machine is. */
const RUN_IN_PAGE = `
  new Promise((resolve, reject) => {
    const deadline = Date.now() + 30000;
    (function tick() {
      const loaded = window.QA && QA.selftest && typeof QA.selftest.run === "function";
      const audited = window.QA && QA.integrity && QA.integrity.status().status !== "PENDING";

      if (loaded && audited) {
        try { resolve(QA.selftest.run()); } catch (error) { reject(error); }
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error(
          "Page never became ready. QA.selftest present: " + Boolean(loaded) +
          ", integrity audit run: " + Boolean(audited) + "."
        ));
        return;
      }
      setTimeout(tick, 50);
    })();
  })
`;

/* ------------------------------------------------------------
   RUN
   ------------------------------------------------------------ */

async function main() {
  const { server, port } = await startServer();
  const profile = await mkdtemp(join(tmpdir(), "callplanner-ci-"));
  const debugPort = 9222 + Math.floor(Math.random() * 1000);

  const chrome = spawn(findChrome(), [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${debugPort}`,
    `http://127.0.0.1:${port}/index.html`
  ], { stdio: "ignore" });

  let client;
  let exitCode = 1;

  /* Tearing down must never change the verdict. Chrome is still
     flushing its profile as it dies, so deleting the directory the
     instant after SIGKILL loses a race with it - wait for the
     process to actually exit, retry the removal, and swallow
     whatever is left. It is a temp directory either way. */
  const cleanup = async () => {
    try {
      client?.close();
      server.close();

      const exited = new Promise((resolve) => chrome.once("exit", resolve));
      chrome.kill("SIGKILL");
      await Promise.race([exited, new Promise((r) => setTimeout(r, 5_000))]);

      await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {
      /* Leaving a temp directory behind is not a test failure. */
    }
  };

  const timer = setTimeout(async () => {
    console.error(`\nTimed out after ${OVERALL_TIMEOUT_MS / 1000}s.`);
    await cleanup();
    process.exit(1);
  }, OVERALL_TIMEOUT_MS);

  try {
    const wsUrl = await waitForDevTools(debugPort);
    client = connect(wsUrl);
    await client.ready;
    await client.send("Runtime.enable");

    const evaluated = await client.send("Runtime.evaluate", {
      expression: RUN_IN_PAGE,
      awaitPromise: true,
      returnByValue: true
    });

    if (evaluated.exceptionDetails) {
      throw new Error(
        evaluated.exceptionDetails.exception?.description ||
        evaluated.exceptionDetails.text
      );
    }

    const summary = evaluated.result.value;

    for (const check of summary.results) {
      console.log(`  ${check.status === "PASS" ? "PASS" : "FAIL"}  ${check.name}`);
      if (check.status !== "PASS") console.log(`        ${check.detail}`);
    }

    console.log(`\n${summary.passed}/${summary.total} checks passed.`);
    exitCode = summary.failed === 0 ? 0 : 1;
  } catch (error) {
    console.error("\nSelf-test run failed: " + error.message);
    exitCode = 1;
  } finally {
    clearTimeout(timer);
    await cleanup();
  }

  process.exit(exitCode);
}

main();
