import { Chess, validateFen } from "./chess.js";

const ENGINE_VERSION = "Stockfish 19.0.1 full single-threaded";
const DEFAULT_WORKER_URL = "/chess/stockfish-19-single.js?v=19.0.1";
const MIN_MOVETIME_MS = 100;
const MAX_MOVETIME_MS = 10000;
const MAX_FEN_LENGTH = 128;
const UCI_MOVE_PATTERN = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;

export function inspectChessPosition(fen) {
  if (typeof fen !== "string" || !fen.trim() || fen.length > MAX_FEN_LENGTH || /[\r\n]/.test(fen)) {
    return { ok: false, error: "A single complete FEN position is required." };
  }
  const normalized = fen.trim();
  const validation = validateFen(normalized);
  if (!validation || validation.ok !== true) {
    return {
      ok: false,
      error: validation && validation.error ? String(validation.error) : "The FEN position is invalid."
    };
  }
  try {
    const chess = new Chess(normalized);
    return {
      ok: true,
      fen: chess.fen(),
      sideToMove: chess.turn(),
      legalMoveCount: chess.moves().length,
      isCheck: chess.isCheck(),
      isCheckmate: chess.isCheckmate(),
      isStalemate: chess.isStalemate(),
      isDraw: chess.isDraw()
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "The FEN position could not be loaded."
    };
  }
}

export class StockfishChessEngine {
  constructor(options = {}) {
    this.workerUrl = options.workerUrl || DEFAULT_WORKER_URL;
    this.workerFactory = options.workerFactory || ((url) => new Worker(url));
    this.defaultMoveTimeMs = options.defaultMoveTimeMs ?? 4500;
    this.startupTimeoutMs = options.startupTimeoutMs || 15000;
    this.searchTimeoutMs = options.searchTimeoutMs ?? 18000;
    this.worker = null;
    this.readyPromise = null;
    this.readyResolve = null;
    this.readyReject = null;
    this.startupTimer = null;
    this.activeSearch = null;
    this.busy = false;
    this.disposed = false;
    this.enginePhase = "stopped";
    this.reportedEngineName = null;
  }

  async ensureReady() {
    if (this.disposed) throw new Error("Chess engine has been disposed.");
    if (this.enginePhase === "ready" && this.worker) return;
    if (this.readyPromise) return this.readyPromise;

    this.worker = this.workerFactory(this.workerUrl);
    this.enginePhase = "starting";
    this.readyPromise = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
      this.startupTimer = setTimeout(() => {
        this.failEngine(new Error("Stockfish did not become ready before the startup deadline."));
      }, this.startupTimeoutMs);
      this.worker.onmessage = (event) => this.handleEngineLine(event && typeof event === "object" && "data" in event ? event.data : event);
      this.worker.onerror = (event) => {
        const message = event && event.message ? event.message : "Stockfish worker failed.";
        this.failEngine(new Error(String(message)));
      };
      try {
        this.worker.postMessage("uci");
      } catch (error) {
        this.failEngine(error instanceof Error ? error : new Error("Could not start the Stockfish worker."));
      }
    }).catch((error) => {
      this.readyPromise = null;
      this.enginePhase = "stopped";
      throw error;
    });
    return this.readyPromise;
  }

  handleEngineLine(rawLine) {
    const line = String(rawLine == null ? "" : rawLine).trim();
    if (!line) return;

    if (line.startsWith("id name ")) {
      this.reportedEngineName = line.slice("id name ".length).trim();
      return;
    }

    if (line === "uciok" && this.enginePhase === "starting") {
      this.enginePhase = "waiting-ready";
      try {
        // Give the full NNUE engine a useful transposition table and request
        // one principal variation. This single-threaded binary honours Hash.
        this.worker.postMessage("setoption name Hash value 32");
        this.worker.postMessage("setoption name MultiPV value 1");
        this.worker.postMessage("isready");
      } catch (error) {
        this.failEngine(error instanceof Error ? error : new Error("Stockfish readiness check failed."));
      }
      return;
    }

    if (line === "readyok" && this.enginePhase === "waiting-ready") {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
      this.enginePhase = "ready";
      const resolve = this.readyResolve;
      this.readyResolve = null;
      this.readyReject = null;
      if (resolve) resolve();
      return;
    }

    if (line.startsWith("info ") && this.activeSearch) {
      this.activeSearch.lastInfo = this.parseInfoLine(line, this.activeSearch.game.turn());
      return;
    }

    if (line.startsWith("bestmove ") && this.activeSearch) {
      this.finishSearch(line);
    }
  }

  parseInfoLine(line, perspective) {
    const depthMatch = line.match(/(?:^|\\s)depth\\s+(\\d+)/);
    const seldepthMatch = line.match(/(?:^|\\s)seldepth\\s+(\\d+)/);
    const scoreMatch = line.match(/(?:^|\\s)score\\s+(cp|mate)\\s+(-?\\d+)/);
    const nodesMatch = line.match(/(?:^|\\s)nodes\\s+(\\d+)/);
    const npsMatch = line.match(/(?:^|\\s)nps\\s+(\\d+)/);
    const timeMatch = line.match(/(?:^|\\s)time\\s+(\\d+)/);
    const pvMatch = line.match(/(?:^|\\s)pv\\s+(.+)$/);
    return {
      depth: depthMatch ? Number(depthMatch[1]) : null,
      selectiveDepth: seldepthMatch ? Number(seldepthMatch[1]) : null,
      score: scoreMatch ? { unit: scoreMatch[1], value: Number(scoreMatch[2]), perspective: perspective } : null,
      nodes: nodesMatch ? Number(nodesMatch[1]) : null,
      nodesPerSecond: npsMatch ? Number(npsMatch[1]) : null,
      elapsedMs: timeMatch ? Number(timeMatch[1]) : null,
      principalVariation: pvMatch ? pvMatch[1].trim() : ""
    };
  }

  async analyzePosition(fen, options = {}) {
    const inspected = inspectChessPosition(fen);
    if (!inspected.ok) throw new TypeError("Invalid chess position: " + inspected.error);

    const game = new Chess(inspected.fen);
    if (game.isGameOver()) {
      return {
        status: game.isCheckmate() ? "checkmate" : (game.isStalemate() ? "stalemate" : "draw"),
        fen: game.fen(),
        sideToMove: game.turn(),
        bestMove: null,
        analysis: null,
        engine: ENGINE_VERSION
      };
    }
    if (this.busy) throw new Error("Stockfish is already analysing a position.");
    this.busy = true;

    try {
      await this.ensureReady();
      const moveTime = options.movetimeMs == null ? this.defaultMoveTimeMs : Number(options.movetimeMs);
      if (!Number.isInteger(moveTime) || moveTime < MIN_MOVETIME_MS || moveTime > MAX_MOVETIME_MS) {
        throw new RangeError("movetimeMs must be an integer between " + MIN_MOVETIME_MS + " and " + MAX_MOVETIME_MS + ".");
      }
      const depth = options.depth == null ? null : Number(options.depth);
      if (depth !== null && (!Number.isInteger(depth) || depth < 1 || depth > 30)) {
        throw new RangeError("depth must be an integer between 1 and 30.");
      }

      return await new Promise((resolve, reject) => {
        const search = {
          game: game,
          originalFen: game.fen(),
          sideToMove: game.turn(),
          resolve: resolve,
          reject: reject,
          lastInfo: null,
          timeout: null
        };
        this.activeSearch = search;
        search.timeout = setTimeout(() => {
          if (this.activeSearch !== search) return;
          try { this.worker.postMessage("stop"); } catch (_) {}
          this.activeSearch = null;
          this.busy = false;
          reject(new Error("Stockfish analysis timed out."));
        }, this.searchTimeoutMs);

        try {
          this.worker.postMessage("position fen " + game.fen());
          this.worker.postMessage(depth === null ? "go movetime " + moveTime : "go depth " + depth);
        } catch (error) {
          clearTimeout(search.timeout);
          this.activeSearch = null;
          this.busy = false;
          reject(error instanceof Error ? error : new Error("Could not send the chess position to Stockfish."));
        }
      });
    } catch (error) {
      this.busy = false;
      throw error;
    }
  }

  finishSearch(line) {
    const search = this.activeSearch;
    if (!search) return;
    clearTimeout(search.timeout);
    this.activeSearch = null;
    this.busy = false;

    const fields = line.split(/\s+/);
    const uci = fields[1] || "";
    if (uci === "(none)" || uci === "0000") {
      const game = search.game;
      search.resolve({
        status: game.isCheckmate() ? "checkmate" : (game.isStalemate() ? "stalemate" : "no_legal_move"),
        fen: game.fen(),
        sideToMove: game.turn(),
        bestMove: null,
        analysis: search.lastInfo,
        engine: ENGINE_VERSION
      });
      return;
    }

    const match = uci.match(UCI_MOVE_PATTERN);
    if (!match) {
      search.reject(new Error("Stockfish returned an invalid UCI move."));
      return;
    }

    let move;
    try {
      move = search.game.move({
        from: match[1],
        to: match[2],
        promotion: match[3]
      });
    } catch (_) {
      move = null;
    }
    if (!move) {
      search.reject(new Error("Stockfish returned a move that is illegal in the validated position."));
      return;
    }

    search.resolve({
      status: "move_found",
      fen: search.originalFen,
      sideToMove: search.sideToMove,
      mover: move.color,
      bestMove: {
        uci: uci,
        from: move.from,
        to: move.to,
        promotion: move.promotion || null,
        san: move.san
      },
      fenAfter: search.game.fen(),
      nextSideToMove: search.game.turn(),
      analysis: search.lastInfo,
      engine: ENGINE_VERSION
    });
  }

  failEngine(error) {
    clearTimeout(this.startupTimer);
    this.startupTimer = null;

    const readyReject = this.readyReject;
    this.readyResolve = null;
    this.readyReject = null;
    if (readyReject) readyReject(error);

    const search = this.activeSearch;
    this.activeSearch = null;
    this.busy = false;
    if (search) {
      clearTimeout(search.timeout);
      search.reject(error);
    }

    try { if (this.worker) this.worker.terminate(); } catch (_) {}
    this.worker = null;
    this.enginePhase = "stopped";
  }

  dispose() {
    this.disposed = true;
    this.failEngine(new Error("Chess engine has been disposed."));
    this.readyPromise = null;
  }
}

export const CHESS_ENGINE_VERSION = ENGINE_VERSION;
