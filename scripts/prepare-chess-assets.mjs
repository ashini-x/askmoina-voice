import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicChessDir = resolve(root, "public/chess");
const stockfishPackage = resolve(root, "node_modules/stockfish");
const chessPackage = resolve(root, "node_modules/chess.js");

async function readPackage(packageRoot, expectedName, expectedVersion) {
  const packageJson = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
  if (packageJson.name !== expectedName || packageJson.version !== expectedVersion) {
    throw new Error(
      "Unexpected " + expectedName + " package. Expected " + expectedVersion +
      ", received " + String(packageJson.version) + ". Keep chess dependencies pinned and review upgrades deliberately."
    );
  }
}

async function copyRequired(source, destination, minimumBytes = 1) {
  try {
    const sourceStat = await stat(source);
    if (!sourceStat.isFile() || sourceStat.size < minimumBytes) {
      throw new Error("Unexpected or empty file: " + source);
    }
    await copyFile(source, destination);
    console.log("Prepared chess asset: " + destination.slice(root.length + 1) + " (" + sourceStat.size + " bytes)");
    return sourceStat.size;
  } catch (error) {
    throw new Error(
      "Could not prepare a required chess asset from " + source +
      ". Ensure the pinned npm packages are installed. " +
      (error instanceof Error ? error.message : String(error))
    );
  }
}

await readPackage(stockfishPackage, "stockfish", "19.0.1");
await readPackage(chessPackage, "chess.js", "1.4.0");
await mkdir(publicChessDir, { recursive: true });

const engineJs = resolve(stockfishPackage, "bin/stockfish-19-lite-single.js");
const engineWasm = resolve(stockfishPackage, "bin/stockfish-19-lite-single.wasm");
const fullEngineJs = resolve(stockfishPackage, "bin/stockfish-19-single.js");
const fullEngineWasm = resolve(stockfishPackage, "bin/stockfish-19-single.wasm");
const chessModule = resolve(chessPackage, "dist/esm/chess.js");

await copyRequired(engineJs, resolve(publicChessDir, "stockfish-19-lite-single.js"), 1000);
const wasmSize = await copyRequired(engineWasm, resolve(publicChessDir, "stockfish-19-lite-single.wasm"), 500_000);

// Deploy the full engine's JavaScript loader as a normal static asset, but never
// copy the full neural-network WASM into Workers Static Assets: individual
// static files are limited to 25 MiB. The Worker streams the pinned WASM
// binary from the versioned official GitHub release asset through /chess/stockfish-19-single.wasm.
const fullJsSize = await copyRequired(fullEngineJs, resolve(publicChessDir, "stockfish-19-single.js"), 1000);
if (fullJsSize > 25 * 1024 * 1024) {
  throw new Error("The full Stockfish JS loader exceeds Cloudflare's 25 MiB static-asset limit.");
}
const fullWasmStat = await stat(fullEngineWasm);
if (!fullWasmStat.isFile() || fullWasmStat.size < 10_000_000) {
  throw new Error("The full Stockfish WASM asset is missing or unexpectedly small.");
}
console.log("Full Stockfish WASM prepared for same-origin streaming relay (" + fullWasmStat.size + " bytes; not copied into static assets).");
if (wasmSize > 8_000_000) {
  throw new Error("The selected single-threaded lite Stockfish asset is unexpectedly large: " + wasmSize + " bytes.");
}
await copyRequired(chessModule, resolve(publicChessDir, "chess.js"), 10_000);
await copyRequired(resolve(stockfishPackage, "Copying.txt"), resolve(publicChessDir, "COPYING-Stockfish-GPL-3.0.txt"), 10_000);
await copyRequired(resolve(chessPackage, "LICENSE"), resolve(publicChessDir, "LICENSE-chess.js-BSD-2-Clause.txt"), 500);

const notices = [
  "Third-party chess components bundled with AskMoina Voice",
  "",
  "Stockfish.js 19.0.1 (full, single-threaded WebAssembly engine; primary chess-analysis engine).",
  "The full WASM file is streamed from the pinned Stockfish.js v19.0.1 GitHub release asset via /chess/stockfish-19-single.wasm because Cloudflare static assets have a 25 MiB per-file limit.",
  "A lite single-threaded build remains bundled as a small compatibility asset but is not the engine selected by AskMoina Chess.",
  "License: GNU General Public License version 3.0; see COPYING-Stockfish-GPL-3.0.txt.",
  "Source: https://github.com/nmrugg/stockfish.js",
  "",
  "chess.js 1.4.0 (FEN, move-generation and legal-move validation)",
  "License: BSD 2-Clause; see LICENSE-chess.js-BSD-2-Clause.txt.",
  "Source: https://github.com/jhlywa/chess.js",
  "",
  "Generated from the exact versions pinned in package.json by scripts/prepare-chess-assets.mjs."
].join("\n") + "\n";
await writeFile(resolve(publicChessDir, "THIRD-PARTY-NOTICES.md"), notices, "utf8");
console.log("Chess asset preparation complete.");
