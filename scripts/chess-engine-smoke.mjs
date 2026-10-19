import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { Chess } from "chess.js";

const require = createRequire(import.meta.url);
const findEngine = require("stockfish").findEngine;
const enginePath = findEngine("single");
const timeoutMs = 30000;
const child = spawn(process.execPath, [enginePath], {
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true
});

let finished = false;
let stdoutBuffer = "";
let stderrTail = "";
let sawUci = false;
let sawReady = false;

const timeout = setTimeout(() => {
  finish(new Error(
    "Stockfish UCI smoke test timed out after " + timeoutMs + " ms." +
    (stderrTail ? " Engine stderr: " + stderrTail.slice(-1000) : "")
  ));
}, timeoutMs);

function finish(error, value) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  try { child.kill(); } catch (_) {}
  if (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } else {
    console.log("Stockfish Full UCI smoke test PASS: start position -> " + value.uci + " (" + value.san + ").");
  }
}

function send(line) {
  if (!child.stdin.destroyed && child.stdin.writable) child.stdin.write(line + "\n");
}

function handleLine(rawLine) {
  const line = String(rawLine || "").trim();
  if (!line) return;

  if (line === "uciok" && !sawUci) {
    sawUci = true;
    send("isready");
    return;
  }

  if (line === "readyok" && !sawReady) {
    sawReady = true;
    send("position startpos");
    send("go depth 12");
    return;
  }

  if (line.startsWith("bestmove ")) {
    const uci = line.split(/\s+/)[1] || "";
    const match = uci.match(/^([a-h][1-8])([a-h][1-8])([qrbn])?$/);
    if (!match) {
      finish(new Error("Stockfish returned no usable move for the initial position: " + line));
      return;
    }
    const game = new Chess();
    let legalMove = null;
    try {
      legalMove = game.move({ from: match[1], to: match[2], promotion: match[3] });
    } catch (_) {}
    if (!legalMove) {
      finish(new Error("Stockfish returned an illegal move for the initial position: " + uci));
      return;
    }
    finish(null, { uci: uci, san: legalMove.san });
  }
}

child.stdout.setEncoding("utf8");
child.stdout.on("data", chunk => {
  stdoutBuffer += chunk;
  const lines = stdoutBuffer.split(/\r?\n/);
  stdoutBuffer = lines.pop() || "";
  for (const line of lines) handleLine(line);
});
child.stderr.setEncoding("utf8");
child.stderr.on("data", chunk => {
  stderrTail = (stderrTail + chunk).slice(-3000);
});
child.on("error", error => finish(error));
child.on("close", (code, signal) => {
  if (!finished) {
    finish(new Error("Stockfish exited before completing its UCI smoke test (code " + code + ", signal " + signal + ")."));
  }
});

send("uci");
