import assert from "node:assert/strict";
import { chromium } from "playwright";
import { Chess } from "chess.js";

const baseUrl = (process.env.BASE_URL || process.env.PRODUCTION_URL || "https://askmoina-voice.thenewtongs.workers.dev").replace(/\/$/, "");
const rawCookie = process.env.ASKMOINA_SYNTHETIC_COOKIE || "";
const match = rawCookie.match(/^moina_session=([A-Za-z0-9_-]{43})$/);
if (!match) throw new Error("Live Stockfish smoke requires the masked authenticated synthetic session.");

async function main() {
  const browser = await chromium.launch({ headless: true });
  let context;
  try {
    context = await browser.newContext({ serviceWorkers: "block" });
    await context.addCookies([{
      name: "moina_session",
      value: match[1],
      url: baseUrl,
      httpOnly: true,
      secure: true,
      sameSite: "Lax"
    }]);
    const page = await context.newPage();
    // Production deliberately redirects browser tabs to /install. The test must
    // emulate an installed PWA before the HTML gate runs, like the passkey smoke.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "standalone", { configurable: true, value: true });
    });
    const errors = [];
    const assetResponses = [];
    const policyViolations = [];
    page.on("pageerror", error => errors.push("pageerror: " + error.message.slice(0, 220)));
    page.on("console", message => {
      if (message.type() === "error") errors.push("console: " + message.text().slice(0, 220));
    });
    context.on("requestfailed", request => {
      if (/stockfish|chess\.wasm/i.test(request.url())) {
        errors.push("requestfailed: " + request.url().split("?")[0] + " " + (request.failure()?.errorText || ""));
      }
    });
    context.on("response", response => {
      if (/stockfish-19-single\.(?:js|wasm)/.test(response.url())) {
        assetResponses.push({
          path: new URL(response.url()).pathname,
          status: response.status(),
          contentType: response.headers()["content-type"] || null,
          csp: response.headers()["content-security-policy"] || null
        });
      }
    });
    await page.addInitScript(() => {
      window.__askmoinaCspViolations = [];
      window.addEventListener("securitypolicyviolation", event => {
        window.__askmoinaCspViolations.push({
          directive: event.violatedDirective,
          blockedURI: event.blockedURI,
          disposition: event.disposition
        });
      });
    });

    const response = await page.goto(baseUrl + "/copilot", { waitUntil: "domcontentloaded", timeout: 30000 });
    if (!response || !response.ok()) {
      throw new Error("Authenticated Co-Pilot page failed to load (HTTP " + (response?.status() ?? "no response") + ").");
    }
    const shell = await page.evaluate(() => ({
      title: document.title,
      chessButtonPresent: Boolean(document.querySelector("#chessAssistantButton")),
      chessModulePresent: Boolean(document.querySelector('script[src*="/chess/chess-ui.js"]')),
      cspMeta: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content || ""
    }));
    assert.equal(shell.chessButtonPresent, true, "must test the real Co-Pilot page, not a PWA install redirect; page=" + page.url() + "; title=" + shell.title);
    assert.equal(shell.chessModulePresent, true, "the real chess UI module must be present; page=" + page.url());
    assert.match(shell.cspMeta, /script-src 'self' 'wasm-unsafe-eval'/,
      "the Co-Pilot HTML CSP must allow WebAssembly without allowing general unsafe-eval");
    assert.doesNotMatch(shell.cspMeta, /(?:^|\s)'unsafe-eval'(?:\s|;|$)/,
      "do not relax the CSP to general JavaScript eval");

    const result = await page.evaluate(async () => {
      const worker = new Worker("/chess/stockfish-19-single.js?v=19.0.1");
      const lines = [];
      const waiters = [];
      let fatal = null;
      const startedAt = performance.now();

      function notify(line) {
        lines.push(String(line));
        for (let index = waiters.length - 1; index >= 0; index -= 1) {
          const item = waiters[index];
          if (item.predicate(line)) {
            waiters.splice(index, 1);
            clearTimeout(item.timer);
            item.resolve(String(line));
          }
        }
      }
      function rejectAll(error) {
        fatal = error instanceof Error ? error.message : String(error || "Stockfish worker error");
        while (waiters.length) {
          const item = waiters.pop();
          clearTimeout(item.timer);
          item.reject(new Error(fatal));
        }
      }
      worker.addEventListener("message", event => notify(event.data));
      worker.addEventListener("error", event => {
        event.preventDefault();
        rejectAll("Stockfish worker error: " + (event.message || "no details"));
      });
      worker.addEventListener("messageerror", () => rejectAll("Stockfish worker message could not be decoded."));

      function waitFor(predicate, timeoutMs, label) {
        const existing = lines.find(predicate);
        if (existing) return Promise.resolve(existing);
        if (fatal) return Promise.reject(new Error(fatal));
        return new Promise((resolve, reject) => {
          const item = {
            predicate, resolve, reject,
            timer: setTimeout(() => {
              const at = waiters.indexOf(item);
              if (at >= 0) waiters.splice(at, 1);
              reject(new Error("Timed out waiting for " + label + ". Last engine lines: " + lines.slice(-8).join(" | ")));
            }, timeoutMs)
          };
          waiters.push(item);
        });
      }

      try {
        const handshakeStart = performance.now();
        const uciPromise = waitFor(line => line.trim() === "uciok", 120000, "uciok after full Stockfish WASM load");
        worker.postMessage("uci");
        await uciPromise;
        const uciMs = performance.now() - handshakeStart;

        const readyStart = performance.now();
        const readyPromise = waitFor(line => line.trim() === "readyok", 12000, "readyok");
        worker.postMessage("setoption name Hash value 32");
        worker.postMessage("setoption name MultiPV value 1");
        worker.postMessage("isready");
        await readyPromise;
        const readyMs = performance.now() - readyStart;

        const searchStart = performance.now();
        const bestMovePromise = waitFor(line => line.startsWith("bestmove "), 15000, "bestmove after strong search");
        worker.postMessage("position startpos");
        worker.postMessage("go movetime 4500");
        const bestmoveLine = await bestMovePromise;
        const infoLines = lines.filter(line => line.startsWith("info "));
        const depths = infoLines.map(line => {
          const match = line.match(/(?:^|\s)depth\s+(\d+)/);
          return match ? Number(match[1]) : 0;
        });
        return {
          ok: true,
          engine: "Stockfish 19.0.1 full single-threaded WASM",
          uciMs: Math.round(uciMs),
          readyMs: Math.round(readyMs),
          searchMs: Math.round(performance.now() - searchStart),
          bestmoveLine,
          deepestDepth: Math.max(0, ...depths),
          messagesSeen: lines.length,
          lastInfo: infoLines.slice(-2)
        };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
          fatal,
          elapsedMs: Math.round(performance.now() - startedAt),
          messages: lines.slice(-12)
        };
      } finally {
        worker.terminate();
      }
    });

    const pagePolicy = await page.evaluate(() => window.__askmoinaCspViolations || []);
    policyViolations.push(...pagePolicy);
    if (!result.ok) {
      throw new Error("Production Stockfish handshake/search failed: " + JSON.stringify({
        result,
        errors: errors.slice(-12),
        assetResponses,
        policyViolations
      }));
    }
    const moveMatch = result.bestmoveLine.match(/^bestmove\s+([a-h][1-8])([a-h][1-8])([qrbn])?/);
    assert.ok(moveMatch, "Stockfish should return a UCI move");
    const chess = new Chess();
    const move = chess.move({ from: moveMatch[1], to: moveMatch[2], promotion: moveMatch[3] });
    assert.ok(move, "Stockfish returned a legal move in the starting position");
    assert.ok(result.uciMs < 120000, "Full Stockfish initialization should finish within the bound");
    assert.ok(result.deepestDepth >= 8, "Full Stockfish should complete a meaningful search, not just return the first legal move");
    assert.equal(policyViolations.length, 0, "the production page should have no CSP violations during the engine test");
    const jsResponse = assetResponses.find(item => item.path.endsWith(".js"));
    const wasmResponse = assetResponses.find(item => item.path.endsWith(".wasm"));
    assert.ok(jsResponse && jsResponse.status === 200, "Stockfish JavaScript worker must load");
    assert.ok(wasmResponse && wasmResponse.status === 200, "Full Stockfish WebAssembly binary must load through the same-origin streaming route");
    assert.match(wasmResponse.contentType || "", /application\/wasm/, "full Stockfish WASM must be served with the correct MIME type");
    assert.match(jsResponse.csp || "", /wasm-unsafe-eval/,
      "Stockfish worker response CSP must permit WebAssembly compilation");
    console.log("LIVE STOCKFISH BROWSER PASS " + JSON.stringify({
      ...result,
      legalSan: move.san,
      legalUci: move.from + move.to + (move.promotion || ""),
      jsStatus: jsResponse.status,
      wasmStatus: wasmResponse.status,
      workerCspAllowsWasm: true,
      pageCspAllowsWasm: true,
      generalUnsafeEvalEnabled: false,
      pageUrl: new URL(page.url()).pathname
    }));
  } finally {
    if (context) await context.close().catch(() => undefined);
    await browser.close();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
