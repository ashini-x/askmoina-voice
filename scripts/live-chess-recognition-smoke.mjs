import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = (process.env.BASE_URL || process.env.PRODUCTION_URL || "https://askmoina-voice.thenewtongs.workers.dev").replace(/\/$/, "");
const cookie = process.env.ASKMOINA_SYNTHETIC_COOKIE;
if (!cookie || !/^moina_session=[A-Za-z0-9_-]{43}$/.test(cookie)) {
  throw new Error("Live chess synthetic requires the masked synthetic passkey session cookie.");
}

const expectedRows = [
  "rnbqkbnr",
  "pppppppp",
  "........",
  "........",
  "........",
  "........",
  "PPPPPPPP",
  "RNBQKBNR"
];

const silhouettes = {
  p: '<circle cx="50" cy="23" r="13"/><path d="M39 40 C41 48 38 56 32 63 C28 68 26 72 25 78 H75 C74 72 71 68 68 63 C62 56 59 48 61 40 Z"/><path d="M21 81 H79 V90 H21 Z"/>',
  r: '<path d="M22 12 H34 V24 H43 V12 H57 V24 H66 V12 H78 V37 H71 V72 H77 V81 H23 V72 H29 V37 H22 Z"/><path d="M18 84 H82 V91 H18 Z"/>',
  n: '<path d="M22 85 V73 C24 62 34 54 43 47 L35 34 L42 18 L57 11 L73 22 L82 39 L71 56 L68 75 L80 85 Z"/><path d="M42 18 L53 30 L67 31 L59 42 L48 42 L42 34 Z"/>',
  b: '<path d="M50 10 C63 10 70 23 64 36 L58 47 C57 52 62 59 67 65 L74 77 H26 L33 65 C38 59 43 52 42 47 L36 36 C30 23 37 10 50 10 Z"/><path d="M44 19 L56 34" fill="none" stroke-width="5"/>',
  q: '<path d="M18 31 L30 52 L38 29 L50 49 L62 29 L70 52 L82 31 L74 73 H26 Z"/><circle cx="18" cy="23" r="6"/><circle cx="38" cy="21" r="6"/><circle cx="50" cy="15" r="6"/><circle cx="62" cy="21" r="6"/><circle cx="82" cy="23" r="6"/><path d="M22 78 H78 V90 H22 Z"/>',
  k: '<path d="M44 6 H56 V18 H68 V30 H56 V45 L68 62 L73 76 H27 L32 62 L44 45 V30 H32 V18 H44 Z"/><path d="M22 80 H78 V90 H22 Z"/>'
};

function pieceSvg(piece) {
  const isWhite = piece === piece.toUpperCase();
  const type = piece.toLowerCase();
  const fill = isWhite ? "#f7f5ff" : "#1b2542";
  const stroke = isWhite ? "#252c4b" : "#11182d";
  return '<svg viewBox="0 0 100 100" role="img" aria-label="' +
    (isWhite ? "White " : "Black ") + type + '" xmlns="http://www.w3.org/2000/svg">' +
    '<g fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + (isWhite ? "2.8" : "1.4") +
    '" stroke-linejoin="round" stroke-linecap="round">' + silhouettes[type] + '</g></svg>';
}

function buildFixtureHtml() {
  const rows = expectedRows;
  const cells = rows.map((row, rowIndex) => [...row].map((piece, columnIndex) => {
    const isLight = (rowIndex + columnIndex) % 2 === 0;
    const label = rowIndex === 0 && columnIndex === 0 ? '<span class="coordinate">8</span>' : "";
    return '<div class="square ' + (isLight ? "light" : "dark") + '">' +
      label + (piece === "." ? "" : pieceSvg(piece)) + '</div>';
  }).join("")).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>
    *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;background:#10121a;color:#e9eaf2;font-family:Arial,Helvetica,sans-serif}
    body{display:grid;place-items:center;padding:28px}
    #screen{width:940px;padding:0 0 28px;background:#171a25;border:8px solid #080a10;border-radius:8px;box-shadow:0 16px 50px #0008}
    .browser{height:54px;background:#090b11;display:flex;align-items:center;gap:12px;padding:0 22px;font-size:16px;color:#c4c9d9;border-bottom:1px solid #303443}
    .dot{width:10px;height:10px;border-radius:50%;background:#7e86a0}
    .url{margin-left:12px;padding:8px 22px;border-radius:8px;background:#1c2030;flex:1}
    .player{height:72px;display:flex;align-items:center;justify-content:space-between;padding:0 44px;font-size:18px;color:#dce0ed}
    .rating{color:#9ba5c1;font-size:14px}
    #board{width:760px;height:760px;margin:0 auto;display:grid;grid-template-columns:repeat(8,1fr);grid-template-rows:repeat(8,1fr);border:2px solid #252a43;overflow:hidden}
    .square{position:relative;display:grid;place-items:center;min-width:0;min-height:0}
    .light{background:#dedfeb}.dark{background:#4c608f}
    .square svg{width:88%;height:88%;filter:drop-shadow(0 2px 1px #0002)}
    .coordinate{position:absolute;top:4px;left:5px;font-size:12px;font-weight:bold;opacity:.68;color:#171b30}
    .status{height:35px;padding:10px 90px 0;font-size:13px;letter-spacing:.02em;color:#98a3c2}
  </style></head><body><main id="screen"><div class="browser"><span class="dot"></span><span class="dot"></span><span class="dot"></span><div class="url">chess.com  ·  Play Chess Online</div></div><div class="player"><div>Player <span class="rating">(1200)</span></div><div>Opponent <span class="rating">(1250)</span></div></div><div id="board" aria-label="8 by 8 digital chessboard">${cells}</div><div class="status">Live game · Standard chess · White at bottom</div></main></body></html>`;
}

async function verifyStockfishEngine(browser) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 900 }, deviceScaleFactor: 1 });
  try {
    // Use an authenticated same-origin app page and the exact engine client
    // module used by the UI. This tests MessageEvent handling as well as WASM.
    await page.context().addCookies([{
      name: "moina_session",
      value: cookie.slice("moina_session=".length),
      url: baseUrl
    }]);
    await page.goto(baseUrl + "/copilot", { waitUntil: "domcontentloaded" });
    const result = await page.evaluate(async () => {
      const [{ Chess }, { StockfishChessEngine }] = await Promise.all([
        import("/chess/chess.js"),
        import("/chess/engine-client.js")
      ]);
      const startedAt = performance.now();
      const engine = new StockfishChessEngine({
        defaultMoveTimeMs: 800,
        startupTimeoutMs: 15_000,
        searchTimeoutMs: 15_000
      });
      try {
        const analysis = await engine.analyzePosition(new Chess().fen(), { movetimeMs: 800 });
        if (analysis.status !== "move_found" || !analysis.bestMove || !analysis.bestMove.san) {
          throw new Error("Stockfish client did not return a legal starting-position move.");
        }
        return {
          uci: analysis.bestMove.uci,
          san: analysis.bestMove.san,
          elapsedMs: Math.round(performance.now() - startedAt),
          status: analysis.status,
          engine: analysis.engine
        };
      } finally {
        engine.dispose();
      }
    });
    assert.equal(result.status, "move_found", "The app engine client must complete startup and search");
    assert.match(result.uci, /^[a-h][1-8][a-h][1-8][qrbn]?$/);
    assert.ok(result.san, "The app engine client must return a legal move validated by chess.js");
    const policy = await page.evaluate(async () => (
      await fetch("/chess/stockfish-19-lite-single.js", { cache: "no-store" })
    ).headers.get("Content-Security-Policy"));
    assert.match(policy || "", /script-src[^;]*'wasm-unsafe-eval'/,
      "Stockfish worker response CSP must explicitly allow WASM compilation");
    assert.doesNotMatch(policy || "", /(^|[^-])'unsafe-eval'/,
      "The policy must not permit general JavaScript eval");
    console.log("LIVE STOCKFISH APP CLIENT PASS " + JSON.stringify(result));
  } finally {
    await page.close().catch(() => {});
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    await verifyStockfishEngine(browser);
    const page = await browser.newPage({ viewport: { width: 1024, height: 1040 }, deviceScaleFactor: 1 });
    await page.setContent(buildFixtureHtml(), { waitUntil: "domcontentloaded" });
    await page.locator("#screen").waitFor({ state: "visible" });
    const screenshot = await page.locator("#screen").screenshot({ type: "jpeg", quality: 82 });
    assert.ok(screenshot.byteLength > 4 && screenshot.byteLength <= 512 * 1024,
      "synthetic on-screen board screenshot must be a JPEG no larger than 512 KiB");

    const imageData = screenshot.toString("base64");
    let lastFailure = null;
    const attempts = 2;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 35_000);
      let response;
      let payload;
      try {
        response = await fetch(baseUrl + "/api/chess/recognize", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Origin": baseUrl,
            "Cookie": cookie
          },
          body: JSON.stringify({
            purpose: "chess_board_scan",
            imageMimeType: "image/jpeg",
            imageData
          }),
          signal: controller.signal
        });
        payload = await response.json();
      } catch (error) {
        lastFailure = {
          attempt,
          elapsedMs: Date.now() - started,
          reason: error && error.name === "AbortError" ? "synthetic_request_timeout" : "synthetic_network_error",
          message: error instanceof Error ? error.message : String(error)
        };
      } finally {
        clearTimeout(timer);
      }

      if (response && response.ok && payload && payload.ok === true && payload.recognition) {
        const recognition = payload.recognition;
        const rows = recognition.boardRows;
        const placement = Array.isArray(rows) ? rows.join("/") : "";
        if (placement !== expectedRows.join("/")) {
          throw new Error("Live digital-board scan returned a mismatched placement: " + JSON.stringify({
            attempt,
            elapsedMs: Date.now() - started,
            orientation: recognition.orientation,
            placement
          }));
        }
        assert.equal(recognition.boardVisible, true);
        assert.equal(recognition.allFourCornersVisible, true);
        assert.equal(recognition.orientation, "white_at_bottom");
        assert.equal(rows.length, 8);
        assert.ok(rows.every(row => typeof row === "string" && row.length === 8));
        assert.equal((rows.join("").match(/K/g) || []).length, 1);
        assert.equal((rows.join("").match(/k/g) || []).length, 1);
        console.log("LIVE CHESS RECOGNITION PASS " + JSON.stringify({
          attempt,
          elapsedMs: Date.now() - started,
          imageBytes: screenshot.byteLength,
          board: "digital 2D board inside a browser-style screen",
          orientation: recognition.orientation,
          exactBoardMatch: true,
          squareCount: 64,
          provider: payload.provider || "reported by production endpoint"
        }));
        return;
      }

      if (!lastFailure && response) {
        lastFailure = {
          attempt,
          elapsedMs: Date.now() - started,
          httpStatus: response.status,
          providerStatus: payload && payload.providerStatus || null,
          reason: payload && payload.reason || "recognition_failed",
          message: payload && payload.message || "No structured chessboard result was returned."
        };
      }
      const transient = lastFailure && (
        ["recognition_timeout", "provider_busy", "recognition_unavailable", "recognition_timed_out", "synthetic_request_timeout", "synthetic_network_error"].includes(lastFailure.reason) ||
        [429, 502, 503, 504].includes(lastFailure.httpStatus)
      );
      console.error("Live chess recognition attempt " + attempt + " failed: " + JSON.stringify(lastFailure));
      if (!transient || attempt === attempts) break;
      await new Promise(resolve => setTimeout(resolve, 1100));
      lastFailure = null;
    }

    throw new Error("Live production chess recognition synthetic failed: " + JSON.stringify(lastFailure));
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
