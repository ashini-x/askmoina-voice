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
const chessModule = resolve(chessPackage, "dist/esm/chess.js");

await copyRequired(engineJs, resolve(publicChessDir, "stockfish-19-lite-single.js"), 1000);
const wasmSize = await copyRequired(engineWasm, resolve(publicChessDir, "stockfish-19-lite-single.wasm"), 500_000);
if (wasmSize > 8_000_000) {
  throw new Error("The selected single-threaded lite Stockfish asset is unexpectedly large: " + wasmSize + " bytes.");
}
await copyRequired(chessModule, resolve(publicChessDir, "chess.js"), 10_000);
await copyRequired(resolve(stockfishPackage, "Copying.txt"), resolve(publicChessDir, "COPYING-Stockfish-GPL-3.0.txt"), 10_000);
await copyRequired(resolve(chessPackage, "LICENSE"), resolve(publicChessDir, "LICENSE-chess.js-BSD-2-Clause.txt"), 500);

const notices = [
  "Third-party chess components bundled with AskMoina Voice",
  "",
  "Stockfish.js 19.0.1 (lite, single-threaded WebAssembly engine)",
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
