import { afterEach, describe, expect, it, vi } from "vitest";
import { Chess } from "../public/chess/chess.js";
import { inspectChessPosition, StockfishChessEngine } from "../public/chess/engine-client.js";

function createWorkerMessage(data) {
  // Browser MessageEvent.data is exposed via the prototype, not as an own property.
  const prototype = Object.create(null);
  Object.defineProperty(prototype, "data", { get: () => data });
  return Object.create(prototype);
}

function createFakeWorker(bestMove) {
  const worker = {
    commands: [],
    onmessage: null,
    onerror: null,
    terminated: false,
    postMessage(command) {
      this.commands.push(command);
      if (command === "uci") {
        queueMicrotask(() => this.onmessage && this.onmessage(createWorkerMessage("uciok")));
      } else if (command === "isready") {
        queueMicrotask(() => this.onmessage && this.onmessage(createWorkerMessage("readyok")));
      } else if (command.startsWith("go ")) {
        queueMicrotask(() => {
          this.onmessage && this.onmessage(createWorkerMessage("info depth 8 score cp 24 pv " + bestMove));
          this.onmessage && this.onmessage(createWorkerMessage("bestmove " + bestMove));
        });
      }
    },
    terminate() {
      this.terminated = true;
    }
  };
  return worker;
}

let engines = [];
afterEach(() => {
  for (const engine of engines) engine.dispose();
  engines = [];
});

describe("chess position validation", () => {
  it("accepts the starting position and exposes legal move metadata", () => {
    const game = new Chess();
    const inspected = inspectChessPosition(game.fen());
    expect(inspected.ok).toBe(true);
    expect(inspected.sideToMove).toBe("w");
    expect(inspected.legalMoveCount).toBe(20);
  });

  it("rejects missing kings, malformed FEN, newlines, and oversized input", () => {
    expect(inspectChessPosition("8/8/8/8/8/8/8/8 w - - 0 1").ok).toBe(false);
    expect(inspectChessPosition("not-a-fen").ok).toBe(false);
    expect(inspectChessPosition("8/8/8/8/8/8/8/8 w - - 0 1\nposition startpos").ok).toBe(false);
    expect(inspectChessPosition("x".repeat(129)).ok).toBe(false);
  });

  it("validates a mid-game FEN without needing previous move history", () => {
    const fen = "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 4 5";
    const inspected = inspectChessPosition(fen);
    expect(inspected.ok).toBe(true);
    expect(inspected.sideToMove).toBe("w");
    expect(inspected.legalMoveCount).toBeGreaterThan(0);
  });
});

describe("Stockfish UCI browser client", () => {
  it("reads inherited MessageEvent.data during the UCI startup handshake", async () => {
    const event = createWorkerMessage("uciok");
    expect(Object.prototype.hasOwnProperty.call(event, "data")).toBe(false);
    expect("data" in event).toBe(true);

    const worker = createFakeWorker("e2e4");
    const engine = new StockfishChessEngine({ workerFactory: () => worker, startupTimeoutMs: 100 });
    engines.push(engine);
    const result = await engine.analyzePosition(new Chess().fen());
    expect(result.bestMove.uci).toBe("e2e4");
    expect(worker.commands).toContain("isready");
  });

  it("starts the worker, requests a bounded analysis, and returns a legal move in SAN and UCI", async () => {
    const worker = createFakeWorker("e2e4");
    const factory = vi.fn(() => worker);
    const engine = new StockfishChessEngine({ workerFactory: factory, defaultMoveTimeMs: 900 });
    engines.push(engine);

    const result = await engine.analyzePosition(new Chess().fen());
    expect(factory).toHaveBeenCalledWith("/chess/stockfish-19-single.js?v=19.0.1");
    expect(worker.commands).toContain("uci");
    expect(worker.commands).toContain("isready");
    expect(worker.commands).toContain("setoption name Hash value 32");
    expect(worker.commands).toContain("setoption name MultiPV value 1");
    expect(worker.commands).toContain("position fen " + new Chess().fen());
    expect(worker.commands).toContain("go movetime 900");
    expect(result.status).toBe("move_found");
    expect(result.bestMove.uci).toBe("e2e4");
    expect(result.bestMove.san).toBe("e4");
    expect(result.analysis.depth).toBe(8);
    expect(result.analysis.score).toEqual({ unit: "cp", value: 24, perspective: "w" });
  });

  it("allows enough first-use time for the full Stockfish WASM download", () => {
    const engine = new StockfishChessEngine({ workerFactory: () => createFakeWorker("e2e4") });
    engines.push(engine);
    expect(engine.startupTimeoutMs).toBe(180000);
  });

  it("uses the full Stockfish build with a deeper 4.5-second default search", async () => {
    const fen = new Chess().fen();
    const worker = createFakeWorker("e2e4");
    const engine = new StockfishChessEngine({ workerFactory: () => worker });
    engines.push(engine);

    const result = await engine.analyzePosition(fen);
    expect(worker.commands).toContain("position fen " + fen);
    expect(worker.commands).toContain("go movetime 4500");
    expect(result.engine).toBe("Stockfish 19.0.1 full single-threaded");
    expect(result.bestMove).toMatchObject({ uci: "e2e4", san: "e4" });
  });

  it("never returns a UCI move that is illegal in the supplied board position", async () => {
    const worker = createFakeWorker("e2e5");
    const engine = new StockfishChessEngine({ workerFactory: () => worker });
    engines.push(engine);

    await expect(engine.analyzePosition(new Chess().fen())).rejects.toThrow(/illegal in the validated position/);
  });

  it("rejects invalid FEN before creating an engine worker", async () => {
    const factory = vi.fn(() => createFakeWorker("e2e4"));
    const engine = new StockfishChessEngine({ workerFactory: factory });
    engines.push(engine);
    await expect(engine.analyzePosition("not-a-fen")).rejects.toThrow(/Invalid chess position/);
    expect(factory).not.toHaveBeenCalled();
  });

  it("checks the Stockfish move against the legal moves in a mid-game position", async () => {
    const fen = "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 4 5";
    const worker = createFakeWorker("f3g5");
    const engine = new StockfishChessEngine({ workerFactory: () => worker });
    engines.push(engine);

    const result = await engine.analyzePosition(fen, { movetimeMs: 1200 });
    expect(result.status).toBe("move_found");
    expect(result.bestMove.uci).toBe("f3g5");
    expect(result.bestMove.san).toBe("Ng5");
    expect(result.fen).toBe(fen);
  });

  it("returns terminal checkmate and stalemate results without starting Stockfish", async () => {
    const factory = vi.fn(() => createFakeWorker("e2e4"));
    const engine = new StockfishChessEngine({ workerFactory: factory });
    engines.push(engine);

    const mate = await engine.analyzePosition("7k/6Q1/5K2/8/8/8/8/8 b - - 0 1");
    expect(mate.status).toBe("checkmate");
    expect(mate.bestMove).toBeNull();

    const stalemate = await engine.analyzePosition("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
    expect(stalemate.status).toBe("stalemate");
    expect(stalemate.bestMove).toBeNull();
    expect(factory).not.toHaveBeenCalled();
  });

  it("rejects when Stockfish never completes the UCI startup handshake", async () => {
    const worker = {
      onmessage: null,
      onerror: null,
      terminated: false,
      postMessage() {},
      terminate() { this.terminated = true; }
    };
    const engine = new StockfishChessEngine({
      workerFactory: () => worker,
      startupTimeoutMs: 5
    });
    engines.push(engine);

    await expect(engine.analyzePosition(new Chess().fen())).rejects.toThrow(/startup deadline/);
    expect(worker.terminated).toBe(true);
  });

  it("rejects when the engine does not finish a search before the deadline", async () => {
    const worker = {
      onmessage: null,
      onerror: null,
      terminated: false,
      postMessage(command) {
        if (command === "uci") queueMicrotask(() => this.onmessage && this.onmessage(createWorkerMessage("uciok")));
        if (command === "isready") queueMicrotask(() => this.onmessage && this.onmessage(createWorkerMessage("readyok")));
        // Deliberately no bestmove reply to a go command.
      },
      terminate() { this.terminated = true; }
    };
    const engine = new StockfishChessEngine({
      workerFactory: () => worker,
      searchTimeoutMs: 5
    });
    engines.push(engine);

    await expect(engine.analyzePosition(new Chess().fen())).rejects.toThrow(/analysis timed out/);
    expect(engine.busy).toBe(false);
  });

  it("terminates the worker when disposed", async () => {
    const worker = createFakeWorker("e2e4");
    const engine = new StockfishChessEngine({ workerFactory: () => worker });
    engines.push(engine);

    await engine.ensureReady();
    engine.dispose();
    expect(worker.terminated).toBe(true);
    await expect(engine.ensureReady()).rejects.toThrow(/disposed/);
  });

  it("does not allow concurrent searches to overwrite one another", async () => {
    const worker = createFakeWorker("e2e4");
    const engine = new StockfishChessEngine({ workerFactory: () => worker });
    engines.push(engine);
    const first = engine.analyzePosition(new Chess().fen());
    await expect(engine.analyzePosition(new Chess().fen())).rejects.toThrow(/already analysing/);
    await first;
  });
});
