import { Chess, validateFen } from "./chess.js";
import { boardRowsToFen, validateBoardRows } from "./recognition-client.js?v=0.4.138";

export const CHESS_GAME_STATE_VERSION = 2;
const STARTING_ROWS = [
  "rnbqkbnr",
  "pppppppp",
  "........",
  "........",
  "........",
  "........",
  "PPPPPPPP",
  "RNBQKBNR"
];
const UCI_PATTERN = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;
const VALID_ORIENTATIONS = new Set(["white_at_bottom", "black_at_bottom"]);

function fail(reason, message) {
  return { ok: false, reason: reason, message: message };
}

function nowIso(value) {
  if (typeof value === "string" && value.length) return value;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  return new Date().toISOString();
}

function gameId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return globalThis.crypto.randomUUID();
  return "chess-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
}

function piecePlacementFromRows(rows) {
  if (!Array.isArray(rows) || rows.length !== 8 || rows.some((row) => typeof row !== "string" || row.length !== 8)) return null;
  return rows.map((row) => {
    let result = "";
    let empty = 0;
    for (const square of row) {
      if (square === ".") {
        empty += 1;
      } else {
        if (empty) result += String(empty);
        empty = 0;
        result += square;
      }
    }
    if (empty) result += String(empty);
    return result;
  }).join("/");
}

function rowsFromGame(game) {
  return game.board().map((row) => row.map((piece) => piece ? (piece.color === "w" ? piece.type.toUpperCase() : piece.type) : ".").join(""));
}

function checkedObservation(observation) {
  if (!observation || typeof observation !== "object") {
    return fail("observation_required", "Scan a clear chessboard before updating the game.");
  }
  if (!VALID_ORIENTATIONS.has(observation.orientation)) {
    return fail("orientation_uncertain", "The board orientation is not clear enough. Show the complete board and scan again.");
  }
  if (observation.sideToMove !== "w" && observation.sideToMove !== "b") {
    return fail("side_to_move_required", "Confirm whether White or Black moves next.");
  }
  const boardCheck = validateBoardRows(observation.boardRows);
  if (!boardCheck.ok) return boardCheck;
  const position = boardRowsToFen(observation.boardRows, observation.sideToMove);
  if (!position.ok) return position;
  try {
    const game = new Chess(position.fen);
    return {
      ok: true,
      game: game,
      boardRows: observation.boardRows.slice(),
      orientation: observation.orientation,
      sideToMove: observation.sideToMove,
      placement: game.fen().split(" ")[0],
      observedAt: nowIso(observation.observedAt)
    };
  } catch (error) {
    return fail("invalid_position", error instanceof Error ? error.message : "The recognized chess position is not valid.");
  }
}

export function createNewChessGame(options = {}) {
  const playerColor = options.playerColor || "w";
  if (playerColor !== "w" && playerColor !== "b") throw new TypeError("playerColor must be w or b.");
  const game = new Chess();
  const timestamp = nowIso(options.now);
  return {
    schemaVersion: CHESS_GAME_STATE_VERSION,
    gameId: options.gameId || gameId(),
    gameMode: "new-game",
    playerColor: playerColor,
    baseFen: game.fen(),
    currentFen: game.fen(),
    moveHistory: [],
    lastBoardRows: STARTING_ROWS.slice(),
    lastOrientation: null,
    lastObservationAt: null,
    rightsKnown: true,
    historyStatus: "complete",
    createdAt: timestamp,
    updatedAt: timestamp,
    status: "ready"
  };
}

/**
 * Seed a mid-game position from a single explicit scan. Castling rights are
 * never inferred from piece placement: pass an explicit string such as "Kq"
 * only after the user confirms those rights, otherwise they stay unknown.
 */
export function seedChessGameFromObservation(observation, options = {}) {
  const checked = checkedObservation(observation);
  if (!checked.ok) return checked;
  const playerColor = options.playerColor || "w";
  if (playerColor !== "w" && playerColor !== "b") {
    return fail("invalid_player_color", "Choose whether you are playing White or Black.");
  }

  const rightsKnown = options.rightsKnown === true;
  let rights = "-";
  if (rightsKnown) {
    const supplied = options.castlingRights == null ? "" : String(options.castlingRights);
    if (/[^KQkq]/.test(supplied) || new Set(supplied).size !== supplied.length) {
      return fail("invalid_castling_rights", "The confirmed castling rights are not valid.");
    }
    rights = "KQkq".split("").filter((right) => supplied.includes(right)).join("") || "-";
    const rows = checked.boardRows;
    const rightSquares = [
      ["K", rows[7][4] === "K" && rows[7][7] === "R"],
      ["Q", rows[7][4] === "K" && rows[7][0] === "R"],
      ["k", rows[0][4] === "k" && rows[0][7] === "r"],
      ["q", rows[0][4] === "k" && rows[0][0] === "r"]
    ];
    if (rightSquares.some((entry) => rights.includes(entry[0]) && !entry[1])) {
      return fail("invalid_castling_rights", "The selected castling right does not match the king and rook squares. Confirm the position or leave rights unknown.");
    }
  }

  const fen = checked.placement + " " + checked.sideToMove + " " + rights + " - 0 1";
  const validation = validateFen(fen);
  if (!validation || validation.ok !== true) {
    return fail("invalid_position", validation && validation.error ? String(validation.error) : "This position cannot be loaded.");
  }

  try {
    const game = new Chess(fen);
    const timestamp = checked.observedAt;
    return {
      ok: true,
      state: {
        schemaVersion: CHESS_GAME_STATE_VERSION,
        gameId: options.gameId || gameId(),
        gameMode: "midgame-seed",
        playerColor: playerColor,
        baseFen: game.fen(),
        currentFen: game.fen(),
        moveHistory: [],
        lastBoardRows: checked.boardRows,
        lastOrientation: checked.orientation,
        lastObservationAt: timestamp,
        rightsKnown: rightsKnown,
        historyStatus: "seeded-history-incomplete",
        createdAt: timestamp,
        updatedAt: timestamp,
        status: "ready"
      },
      position: inspectPosition(game)
    };
  } catch (error) {
    return fail("invalid_position", error instanceof Error ? error.message : "This position cannot be loaded.");
  }
}

/**
 * Reconcile one manually requested camera observation. Only a single legal
 * ply is registered. Duplicate frames are idempotent; missing/ambiguous
 * transitions never fabricate moves.
 */
export function reconcileChessObservation(inputState, observation) {
  const restored = restoreChessGameState(inputState);
  if (!restored.ok) return fail("game_state_unavailable", "The saved chess game is missing or inconsistent. Start a new game or seed the current board again.");
  const state = restored.state;
  const checked = checkedObservation(observation);
  if (!checked.ok) return checked;
  const currentGame = new Chess(state.currentFen);
  const currentPlacement = currentGame.fen().split(" ")[0];
  const timestamp = checked.observedAt;

  if (checked.placement === currentPlacement) {
    if (checked.sideToMove !== currentGame.turn()) {
      return fail("side_to_move_mismatch", "The pieces match the previous scan, but the confirmed side to move changed. Check the turn selection and scan again.");
    }
    const sameOrientation = state.lastOrientation === checked.orientation;
    const nextState = {
      ...state,
      lastBoardRows: checked.boardRows,
      lastOrientation: checked.orientation,
      lastObservationAt: timestamp,
      updatedAt: timestamp,
      status: "ready"
    };
    return {
      ok: true,
      status: "unchanged",
      state: nextState,
      move: null,
      orientationChanged: Boolean(state.lastOrientation && !sameOrientation),
      position: inspectPosition(currentGame)
    };
  }

  const candidates = [];
  for (const legalMove of currentGame.moves({ verbose: true })) {
    const candidateGame = new Chess(currentGame.fen());
    let applied;
    try {
      applied = candidateGame.move({
        from: legalMove.from,
        to: legalMove.to,
        promotion: legalMove.promotion
      });
    } catch {
      continue;
    }
    if (candidateGame.turn() !== checked.sideToMove) continue;
    if (candidateGame.fen().split(" ")[0] !== checked.placement) continue;
    candidates.push({ game: candidateGame, move: applied });
  }

  if (candidates.length !== 1) {
    if (candidates.length > 1) {
      return fail("ambiguous_transition", "More than one legal move fits this scan. I have not changed the game history. Improve the view or clarify the move.");
    }
    const suffix = state.gameMode === "midgame-seed" ? (state.rightsKnown ? " This game began from a photographed mid-game position; earlier moves and en-passant eligibility remain unknown, although castling rights were confirmed." : " This game began from a photographed mid-game position, so historical moves, castling rights and en-passant eligibility are unknown.") : "";
    return fail(
      "transition_not_one_legal_move",
      "I could not match this image to exactly one legal move from the last confirmed position. I have not changed the game history. Scan each move, or use “current position” to safely reseed." + suffix
    );
  }

  const accepted = candidates[0];
  const move = accepted.move;
  const uci = move.from + move.to + (move.promotion || "");
  const moveRecord = {
    ply: state.moveHistory.length + 1,
    uci: uci,
    san: move.san,
    color: move.color,
    from: move.from,
    to: move.to,
    promotion: move.promotion || null,
    flags: move.flags,
    fenAfter: accepted.game.fen(),
    observedAt: timestamp
  };
  const nextState = {
    ...state,
    currentFen: accepted.game.fen(),
    moveHistory: state.moveHistory.concat([moveRecord]),
    lastBoardRows: checked.boardRows,
    lastOrientation: checked.orientation,
    lastObservationAt: timestamp,
    updatedAt: timestamp,
    status: accepted.game.isGameOver() ? "game-over" : "ready"
  };
  return {
    ok: true,
    status: "move-registered",
    state: nextState,
    move: moveRecord,
    orientationChanged: Boolean(state.lastOrientation && state.lastOrientation !== checked.orientation),
    position: inspectPosition(accepted.game)
  };
}

function inspectPosition(game) {
  return {
    fen: game.fen(),
    sideToMove: game.turn(),
    legalMoveCount: game.moves().length,
    isCheck: game.isCheck(),
    isCheckmate: game.isCheckmate(),
    isStalemate: game.isStalemate(),
    isDraw: game.isDraw()
  };
}

/** Validate persisted state by replaying the bounded move list from its base FEN. */
export function restoreChessGameState(value) {
  if (!value || typeof value !== "object" || value.schemaVersion !== CHESS_GAME_STATE_VERSION ||
      typeof value.baseFen !== "string" || typeof value.currentFen !== "string" ||
      !Array.isArray(value.moveHistory) || value.moveHistory.length > 600 ||
      (value.playerColor !== "w" && value.playerColor !== "b")) {
    return fail("invalid_saved_state", "Saved chess game data is incomplete.");
  }

  const baseValidation = validateFen(value.baseFen);
  if (!baseValidation || baseValidation.ok !== true) return fail("invalid_saved_state", "The saved starting position is invalid.");
  let replay;
  try {
    replay = new Chess(value.baseFen);
    for (const entry of value.moveHistory) {
      if (!entry || typeof entry.uci !== "string" || !UCI_PATTERN.test(entry.uci)) {
        return fail("invalid_saved_state", "The saved move history contains an invalid move.");
      }
      const match = entry.uci.match(UCI_PATTERN);
      const applied = replay.move({ from: match[1], to: match[2], promotion: match[3] });
      if (entry.san && applied.san !== entry.san) {
        return fail("invalid_saved_state", "The saved move history does not match the current chess rules.");
      }
    }
    const expected = new Chess(value.currentFen);
    if (replay.fen() !== expected.fen()) {
      return fail("invalid_saved_state", "The saved moves do not produce the saved current position.");
    }
    const placement = expected.fen().split(" ")[0];
    const rowsPlacement = piecePlacementFromRows(value.lastBoardRows);
    if (rowsPlacement !== placement) {
      return fail("invalid_saved_state", "The saved board reading does not match the saved game position.");
    }
  } catch {
    return fail("invalid_saved_state", "The saved chess position or move history could not be restored.");
  }

  return {
    ok: true,
    state: {
      ...value,
      moveHistory: value.moveHistory.map((entry) => ({ ...entry })),
      lastBoardRows: value.lastBoardRows.slice()
    }
  };
}

export function boardRowsForFen(fen) {
  const validation = validateFen(fen);
  if (!validation || validation.ok !== true) return null;
  try {
    return rowsFromGame(new Chess(fen));
  } catch {
    return null;
  }
}
