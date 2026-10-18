import { Chess, validateFen } from "./chess.js";

const DEFAULT_ENDPOINT = "/api/chess/recognize";
const MAX_FRAME_BYTES = 512 * 1024;
const MIN_OVERALL_CONFIDENCE = 0.82;
const MIN_SQUARE_CONFIDENCE = 0.75;
const PIECES = new Set("pnbrqkPNBRQK");
const SQUARE_PATTERN = /^[a-h][1-8]$/;

/**
 * This client is intentionally opt-in: it never watches the camera or uploads
 * frames itself. The caller must invoke it only after explicit chess intent
 * and supply a single, already-captured JPEG frame.
 */
export async function recognizeChessboardFrame(imageBlob, options = {}) {
  const sideToMove = options.sideToMove;
  if (sideToMove != null && sideToMove !== "w" && sideToMove !== "b") {
    return { ok: false, reason: "invalid_side_to_move", message: "Choose White or Black, or leave the turn unknown until AskMoina asks." };
  }
  if (!(imageBlob instanceof Blob) || imageBlob.type !== "image/jpeg" || imageBlob.size < 4 || imageBlob.size > MAX_FRAME_BYTES) {
    return { ok: false, reason: "invalid_frame", message: "Capture one clear JPEG frame under 512 KiB and try again." };
  }

  let imageData;
  try {
    imageData = await blobToBase64(imageBlob);
  } catch {
    return { ok: false, reason: "frame_read_failed", message: "The camera frame could not be read. Please try again." };
  }

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const endpoint = options.endpoint || DEFAULT_ENDPOINT;
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        purpose: "chess_board_scan",
        imageMimeType: "image/jpeg",
        imageData,
        ...(sideToMove === "w" || sideToMove === "b" ? { sideToMove } : {})
      }),
      signal: options.signal || AbortSignal.timeout(18_000)
    });
  } catch (error) {
    const timedOut = Boolean(error && (error.name === "TimeoutError" || error.name === "AbortError"));
    return timedOut
      ? { ok: false, reason: "recognition_timeout", message: "Chessboard recognition timed out before finishing. Keep the full 8×8 grid centred and try again; digital boards on a screen, including Chess.com, are supported." }
      : { ok: false, reason: "recognition_unavailable", message: "Chessboard recognition could not reach the service. Try again when the connection is stable." };
  }

  let payload;
  try { payload = await response.json(); } catch {
    return { ok: false, reason: "invalid_service_response", message: "Chessboard recognition returned an unreadable response." };
  }
  if (!response.ok || !payload || payload.ok !== true || !payload.recognition) {
    return {
      ok: false,
      reason: String(payload && payload.reason || "recognition_failed"),
      message: String(payload && payload.message || "The board could not be read confidently. Reposition the camera so all four corners and every square are visible, then scan again.")
    };
  }

  const assessed = assessChessboardRecognition(payload.recognition);
  if (!assessed.ok) return assessed;

  const position = sideToMove === "w" || sideToMove === "b"
    ? boardRowsToFen(payload.recognition.boardRows, sideToMove)
    : null;
  if (position && !position.ok) return position;

  return {
    ok: true,
    recognition: {
      boardRows: payload.recognition.boardRows,
      orientation: payload.recognition.orientation,
      boardCornersNormalized: payload.recognition.boardCornersNormalized.map((point) => ({ x: Number(point.x), y: Number(point.y) })),
      confidence: payload.recognition.confidence,
      confidenceKind: "model-estimated; not calibrated",
      squareConfidences: payload.recognition.squareConfidences.slice(),
      ambiguousSquares: [],
      geometry: "all four board corners reported visible"
    },
    position,
    sideToMove: sideToMove === "w" || sideToMove === "b" ? sideToMove : null,
    history: {
      castlingRights: "unknown_from_image",
      enPassantSquare: "unknown_from_image",
      moveCounters: "unknown_from_image",
      warning: "A single image cannot establish castling or en-passant rights or the actual move counters. The FEN uses conservative placeholder fields; a new-game flow or move tracker must supply known rights before relying on history-dependent moves."
    }
  };
}

export function assessChessboardRecognition(recognition) {
  if (!recognition || typeof recognition !== "object") {
    return failure("invalid_recognition", "No structured chessboard reading was returned.");
  }
  if (recognition.boardVisible !== true) {
    return failure("no_board", "I cannot confidently identify a chessboard. Center the board in the camera view and scan again.");
  }
  if (recognition.allFourCornersVisible !== true) {
    return failure("partial_board", "The full board is not visible. Move the camera back until all four corners and all 64 squares are in view.");
  }
  if (recognition.orientation !== "white_at_bottom" && recognition.orientation !== "black_at_bottom") {
    return failure("orientation_uncertain", "I cannot determine the board orientation confidently. Show the entire board more directly.");
  }
  if (!Number.isFinite(recognition.confidence) || recognition.confidence < MIN_OVERALL_CONFIDENCE || recognition.confidence > 1) {
    return failure("uncertain_recognition", "Some pieces or squares are uncertain. Improve the lighting, remove obstructions, and scan again.");
  }
  if (!Array.isArray(recognition.boardCornersNormalized) || recognition.boardCornersNormalized.length !== 4 ||
      recognition.boardCornersNormalized.some((point) => !point || typeof point !== "object" ||
        !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
        point.x < 0 || point.x > 1000 || point.y < 0 || point.y > 1000) ||
      !isConvexBoardPolygon(recognition.boardCornersNormalized)) {
    return failure("invalid_board_geometry", "I cannot locate all four board corners reliably. Show the full board and scan again.");
  }
  if (!Array.isArray(recognition.ambiguousSquares) || recognition.ambiguousSquares.length !== 0) {
    return failure("ambiguous_squares", "I could not distinguish every square reliably. Keep hands and objects away from the board and scan again.");
  }
  if (!Array.isArray(recognition.squareConfidences) || recognition.squareConfidences.length !== 64 ||
      recognition.squareConfidences.some((score) => !Number.isFinite(score) || score < MIN_SQUARE_CONFIDENCE || score > 1)) {
    return failure("uncertain_squares", "At least one square is not clear enough to trust. Reposition the camera and scan again.");
  }
  const board = validateBoardRows(recognition.boardRows);
  if (!board.ok) return board;
  return { ok: true };
}

/**
 * Converts rank-8-to-rank-1 rows, with files a-to-h in each row, to a
 * conservative FEN. Side-to-move is user/session supplied, never guessed from
 * piece placement. A photographed position cannot reveal historical rights.
 */
/** Infer the user's playing color from the pieces on the near edge of the board. */
export function inferUserColorFromOrientation(orientation) {
  if (orientation === "white_at_bottom") return "w";
  if (orientation === "black_at_bottom") return "b";
  return null;
}

/** Require two independent camera reads to agree before using a photographed position. */
export function verifyStableChessboardRecognition(firstResult, secondResult) {
  const fail = (reason, message) => ({ ok: false, reason, message });
  if (!firstResult || firstResult.ok !== true || !firstResult.recognition) {
    return fail("first_scan_unavailable", "The first board reading is unavailable. Scan the board again.");
  }
  if (!secondResult || secondResult.ok !== true || !secondResult.recognition) {
    const detail = secondResult && typeof secondResult.message === "string" ? " " + secondResult.message : "";
    return fail("confirmation_scan_unavailable", "I couldn't confirm the board with a second reading." + detail);
  }
  const first = firstResult.recognition;
  const second = secondResult.recognition;
  const firstRows = validateBoardRows(first.boardRows);
  const secondRows = validateBoardRows(second.boardRows);
  if (!firstRows.ok || !secondRows.ok) {
    return fail("invalid_confirmation_reading", "One of the board readings was incomplete. Keep all 64 squares visible and scan again.");
  }
  const firstPlacement = first.boardRows.join("/");
  const secondPlacement = second.boardRows.join("/");
  if (firstPlacement !== secondPlacement || first.orientation !== second.orientation) {
    return fail("unstable_board_reading", "The two board readings did not agree. I won't recommend a move from this scan. Keep the board still and try again.");
  }
  return { ok: true, recognition: second };
}

export function boardRowsToFen(rows, sideToMove) {
  if (sideToMove !== "w" && sideToMove !== "b") {
    return failure("side_to_move_required", "Confirm whether White or Black moves next.");
  }
  const board = validateBoardRows(rows);
  if (!board.ok) return board;

  const placement = rows.map((row) => {
    let fenRow = "";
    let empty = 0;
    for (const square of row) {
      if (square === ".") {
        empty += 1;
      } else {
        if (empty) fenRow += String(empty);
        empty = 0;
        fenRow += square;
      }
    }
    if (empty) fenRow += String(empty);
    return fenRow;
  }).join("/");

  // These are deliberately conservative placeholder fields, not claims about
  // the game's true move history. Phase 3 must restore rights from known history.
  const fen = placement + " " + sideToMove + " - - 0 1";
  const validation = validateFen(fen);
  if (!validation || validation.ok !== true) {
    return failure("invalid_fen", validation && validation.error ? String(validation.error) : "The recognized board could not be encoded as valid FEN.");
  }
  try {
    const chess = new Chess(fen);
    // The side that just moved cannot leave its own king in check. Check this
    // separately because a structurally valid FEN can still be an impossible
    // photograph reading and otherwise produce legal moves for the wrong board.
    const oppositeSide = sideToMove === "w" ? "b" : "w";
    const previousMoverPosition = new Chess(placement + " " + oppositeSide + " - - 0 1");
    if (previousMoverPosition.isCheck()) {
      return failure("impossible_check_state", "The scanned position appears to leave the side that just moved in check. I won't recommend a move from this reading. Scan the board again.");
    }
    return {
      ok: true,
      fen: chess.fen(),
      sideToMove: chess.turn(),
      legalMoveCount: chess.moves().length,
      isCheck: chess.isCheck(),
      isCheckmate: chess.isCheckmate(),
      isStalemate: chess.isStalemate(),
      isDraw: chess.isDraw(),
      historyFieldsIncomplete: true
    };
  } catch (error) {
    return failure("invalid_fen", error instanceof Error ? error.message : "The recognized position could not be loaded by chess.js.");
  }
}

export function validateBoardRows(rows) {
  if (!Array.isArray(rows) || rows.length !== 8 || rows.some((row) => typeof row !== "string" || row.length !== 8)) {
    return failure("invalid_board_shape", "The reading did not contain exactly 8 rows of 8 squares.");
  }

  const counts = { w: { pieces: 0, kings: 0, pawns: 0 }, b: { pieces: 0, kings: 0, pawns: 0 } };
  for (let rowIndex = 0; rowIndex < 8; rowIndex += 1) {
    const row = rows[rowIndex];
    for (let fileIndex = 0; fileIndex < 8; fileIndex += 1) {
      const piece = row[fileIndex];
      if (piece !== "." && !PIECES.has(piece)) {
        return failure("invalid_piece_symbol", "The board contains an unrecognized piece symbol.");
      }
      if (piece === ".") continue;
      const color = piece === piece.toUpperCase() ? "w" : "b";
      const type = piece.toLowerCase();
      counts[color].pieces += 1;
      if (type === "k") counts[color].kings += 1;
      if (type === "p") {
        counts[color].pawns += 1;
        if (rowIndex === 0 || rowIndex === 7) {
          return failure("invalid_pawn_rank", "A pawn was read on the first or eighth rank; the recognition may be wrong.");
        }
      }
    }
  }
  if (counts.w.kings !== 1 || counts.b.kings !== 1) {
    return failure("invalid_king_count", "The board does not contain exactly one king of each color. Do not analyze this position yet.");
  }
  if (counts.w.pieces > 16 || counts.b.pieces > 16 || counts.w.pawns > 8 || counts.b.pawns > 8) {
    return failure("impossible_piece_count", "The piece count is inconsistent with a legal chess position. Scan again.");
  }

  const whiteKing = locatePiece(rows, "K");
  const blackKing = locatePiece(rows, "k");
  if (whiteKing && blackKing && Math.abs(whiteKing.file - blackKing.file) <= 1 && Math.abs(whiteKing.rank - blackKing.rank) <= 1) {
    return failure("adjacent_kings", "The kings appear to occupy adjacent squares. The reading is not a legal chess position.");
  }

  const fenPlacement = rows.map((row) => {
    let current = "";
    let empty = 0;
    for (const piece of row) {
      if (piece === ".") empty += 1;
      else { if (empty) current += String(empty); empty = 0; current += piece; }
    }
    if (empty) current += String(empty);
    return current;
  }).join("/");
  if (!fenPlacement) return failure("invalid_board_shape", "The board is empty.");
  return { ok: true };
}

function isConvexBoardPolygon(points) {
  if (!Array.isArray(points) || points.length !== 4) return false;
  let sign = 0;
  let twiceArea = 0;
  for (let index = 0; index < 4; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % 4];
    const after = points[(index + 2) % 4];
    const cross = (next.x - current.x) * (after.y - next.y) -
      (next.y - current.y) * (after.x - next.x);
    if (Math.abs(cross) < 1) return false;
    const currentSign = Math.sign(cross);
    if (sign && currentSign !== sign) return false;
    sign = currentSign;
    twiceArea += current.x * next.y - next.x * current.y;
  }
  return Math.abs(twiceArea) / 2 >= 10_000;
}

function locatePiece(rows, target) {
  for (let row = 0; row < 8; row += 1) {
    const file = rows[row].indexOf(target);
    if (file >= 0) return { file, rank: 7 - row };
  }
  return null;
}

function failure(reason, message) {
  return { ok: false, reason, message };
}

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return btoa(binary);
}
