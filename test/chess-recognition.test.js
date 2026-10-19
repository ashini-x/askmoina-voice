import { afterEach, describe, expect, it, vi } from "vitest";
import { Chess, validateFen } from "../public/chess/chess.js";
import { createNewChessGame, isPlayersTurn, reconcileChessObservation } from "../public/chess/game-state-client.js";
import {
  assessChessboardRecognition,
  boardRowsToFen,
  recognizeChessboardFrame,
  verifyStableChessboardRecognition,
  retryStableChessboardRecognition,
  inferUserColorFromOrientation,
  validateBoardRows,
  computeCoverCrop
} from "../public/chess/recognition-client.js";
import { assessRecognition, buildChessRecognitionPrompt, handleChessRecognitionRequest } from "../src/chess/recognition.ts";

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

const MIDGAME_ROWS = [
  "r.bqkbnr",
  "pppp.ppp",
  "..n.....",
  "....p...",
  "....P...",
  ".....N..",
  "PPPP.PPP",
  "RNBQKB.R"
];

function strongRecognition(rows = STARTING_ROWS, overrides = {}) {
  return {
    boardVisible: true,
    allFourCornersVisible: true,
    orientation: "white_at_bottom",
    boardCornersNormalized: [
      { x: 100, y: 100 },
      { x: 900, y: 100 },
      { x: 900, y: 900 },
      { x: 100, y: 900 }
    ],
    boardRows: rows,
    confidence: 0.97,
    squareConfidences: Array(64).fill(0.94),
    ambiguousSquares: [],
    notes: "",
    ...overrides
  };
}

function requestBody(overrides = {}) {
  return {
    purpose: "chess_board_scan",
    imageMimeType: "image/jpeg",
    imageData: "/9j/AA==",
    sideToMove: "w",
    ...overrides
  };
}

function makeRequest(body = requestBody(), overrides = {}) {
  return new Request("https://askmoina.test/api/chess/recognize", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": "https://askmoina.test",
      ...overrides.headers
    },
    body: JSON.stringify(body)
  });
}

afterEach(() => vi.restoreAllMocks());

describe("continuous next-strong-move turn flow", () => {
  it("waits through the opponent's turn and becomes eligible when it is the player's turn", () => {
    const blackState = createNewChessGame({ playerColor: "b", now: "2026-10-18T00:00:00.000Z" });
    expect(isPlayersTurn(blackState)).toBe(false);

    const afterWhiteE4 = [...STARTING_ROWS];
    afterWhiteE4[6] = "PPPP.PPP";
    afterWhiteE4[4] = "....P...";
    const whiteMove = reconcileChessObservation(blackState, {
      boardRows: afterWhiteE4,
      orientation: "white_at_bottom",
      sideToMove: "b",
      observedAt: "2026-10-18T00:00:02.000Z"
    });
    expect(whiteMove).toMatchObject({ ok: true, status: "move-registered" });
    if (whiteMove.ok) expect(isPlayersTurn(whiteMove.state)).toBe(true);

    const whiteState = createNewChessGame({ playerColor: "w", now: "2026-10-18T00:00:00.000Z" });
    expect(isPlayersTurn(whiteState)).toBe(true);
    if (whiteMove.ok) expect(isPlayersTurn({ ...whiteMove.state, playerColor: "w" })).toBe(false);
  });
});

describe("camera preview crop geometry", () => {
  it("crops a landscape camera sensor to the portrait object-fit cover viewport", () => {
    const crop = computeCoverCrop(1920, 1080, 691, 1376);
    expect(crop.sx).toBeGreaterThan(600);
    expect(crop.sy).toBe(0);
    expect(crop.sw).toBeCloseTo(542.6, 0);
    expect(crop.sh).toBeCloseTo(1080, 0);
    expect(crop.sw / crop.sh).toBeCloseTo(691 / 1376, 2);
  });

  it("honours the visible side of object-position and preview zoom", () => {
    const right = computeCoverCrop(1920, 1080, 691, 1376, "right center");
    expect(right.sx).toBeCloseTo(1920 - right.sw, 0);
    const zoomed = computeCoverCrop(1920, 1080, 691, 1376, "50% 50%", 1.055, 1.055);
    expect(zoomed.sw).toBeLessThan(right.sw);
    expect(zoomed.sh).toBeLessThan(right.sh);
    expect(zoomed.sx).toBeGreaterThan(right.sx / 2);
  });

  it("rejects invalid source geometry rather than silently scanning a wrong crop", () => {
    expect(() => computeCoverCrop(0, 1080, 691, 1376)).toThrow(RangeError);
  });
});

describe("board rows and FEN", () => {
  it("defaults the user's color to the color on the near edge", () => {
    expect(inferUserColorFromOrientation("white_at_bottom")).toBe("w");
    expect(inferUserColorFromOrientation("black_at_bottom")).toBe("b");
    expect(inferUserColorFromOrientation("unknown")).toBeNull();
  });
  it("converts all 64 starting squares in standard FEN order and validates with chess.js", () => {
    const result = boardRowsToFen(STARTING_ROWS, "w");
    expect(result.ok).toBe(true);
    expect(result.fen).toBe("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1");
    expect(validateFen(result.fen).ok).toBe(true);
    expect(new Chess(result.fen).moves()).toHaveLength(20);
    expect(result.historyFieldsIncomplete).toBe(true);
  });

  it("supports a ground-truthed arbitrary mid-game layout without a move list", () => {
    const result = boardRowsToFen(MIDGAME_ROWS, "b");
    expect(result.ok).toBe(true);
    expect(result.fen).toBe("r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b - - 0 1");
    expect(new Chess(result.fen).moves().length).toBeGreaterThan(0);
  });

  it("rejects invalid shape, unknown pieces, missing kings, excessive pieces and edge-rank pawns", () => {
    expect(validateBoardRows(["........"])).toMatchObject({ ok: false, reason: "invalid_board_shape" });
    const invalidSymbol = [...STARTING_ROWS]; invalidSymbol[3] = "....X...";
    expect(validateBoardRows(invalidSymbol)).toMatchObject({ ok: false, reason: "invalid_piece_symbol" });
    const missingKing = [...STARTING_ROWS]; missingKing[7] = "RNBQ.BNR";
    expect(boardRowsToFen(missingKing, "w")).toMatchObject({ ok: false, reason: "invalid_king_count" });
    const pawnsOnBackRank = [...STARTING_ROWS]; pawnsOnBackRank[0] = "pnbqkbnr";
    expect(boardRowsToFen(pawnsOnBackRank, "w")).toMatchObject({ ok: false, reason: "invalid_pawn_rank" });
    const tooMany = [...STARTING_ROWS]; tooMany[2] = "PPPPPPPP";
    expect(validateBoardRows(tooMany)).toMatchObject({ ok: false, reason: "impossible_piece_count" });
  });

  it("accepts a clear single-pass reading at the more tolerant confidence floor", () => {
    const reading = strongRecognition(STARTING_ROWS, {
      confidence: 0.74,
      squareConfidences: Array(64).fill(0.60)
    });
    expect(assessChessboardRecognition(reading)).toMatchObject({ ok: true });
  });

  it("rejects an absent or ambiguous board, partial visibility, unknown orientation, and low confidence", () => {
    expect(assessChessboardRecognition(strongRecognition(STARTING_ROWS, { boardVisible: false }))).toMatchObject({ ok: false, reason: "no_board" });
    expect(assessChessboardRecognition(strongRecognition(STARTING_ROWS, { allFourCornersVisible: false }))).toMatchObject({ ok: false, reason: "partial_board" });
    expect(assessChessboardRecognition(strongRecognition(STARTING_ROWS, { orientation: "unknown" }))).toMatchObject({ ok: false, reason: "orientation_uncertain" });
    expect(assessChessboardRecognition(strongRecognition(STARTING_ROWS, { confidence: 1.1 }))).toMatchObject({ ok: false, reason: "uncertain_recognition" });
    expect(assessChessboardRecognition(strongRecognition(STARTING_ROWS, { confidence: 0.3 }))).toMatchObject({ ok: false, reason: "uncertain_recognition" });
    expect(assessChessboardRecognition(strongRecognition(STARTING_ROWS, { ambiguousSquares: ["e4"] }))).toMatchObject({ ok: false, reason: "ambiguous_squares" });
    expect(assessChessboardRecognition(strongRecognition(STARTING_ROWS, { squareConfidences: Array(63).fill(0.9) }))).toMatchObject({ ok: false, reason: "uncertain_squares" });
    const lowSquare = Array(64).fill(0.9); lowSquare[19] = 0.4;
    expect(assessChessboardRecognition(strongRecognition(STARTING_ROWS, { squareConfidences: lowSquare }))).toMatchObject({ ok: false, reason: "uncertain_squares" });
  });

  it("requires an explicit side to move and never guesses it from piece placement", () => {
    expect(boardRowsToFen(STARTING_ROWS, undefined)).toMatchObject({ ok: false, reason: "side_to_move_required" });
    expect(boardRowsToFen(STARTING_ROWS, "w").sideToMove).toBe("w");
    expect(boardRowsToFen(STARTING_ROWS, "b").sideToMove).toBe("b");
  });

  it("rejects a position where the previous mover's king is already in check", () => {
    const impossible = [
      "....k...",
      "....Q...",
      "........",
      "........",
      "........",
      "........",
      "........",
      "....K..."
    ];
    expect(boardRowsToFen(impossible, "w")).toMatchObject({
      ok: false,
      reason: "impossible_check_state"
    });
  });

  it("requires two independent chessboard reads to agree before analysis", () => {
    const first = { ok: true, recognition: strongRecognition() };
    const same = { ok: true, recognition: strongRecognition() };
    expect(verifyStableChessboardRecognition(first, same)).toMatchObject({ ok: true });

    const movedPiece = [...STARTING_ROWS];
    movedPiece[6] = "PPPP.PPP";
    const changed = { ok: true, recognition: strongRecognition(movedPiece) };
    expect(verifyStableChessboardRecognition(first, changed)).toMatchObject({
      ok: false,
      reason: "unstable_board_reading"
    });

    const rotated = { ok: true, recognition: strongRecognition(STARTING_ROWS, { orientation: "black_at_bottom" }) };
    expect(verifyStableChessboardRecognition(first, rotated)).toMatchObject({
      ok: false,
      reason: "unstable_board_reading"
    });
  });

  it("retries a failed second read and confirms on the next independent frame", async () => {
    const first = strongRecognition();
    const readConfirmation = vi.fn()
      .mockResolvedValueOnce({ ok: false, reason: "provider_error", message: "Vision request failed." })
      .mockResolvedValueOnce({ ok: true, recognition: strongRecognition() });
    const result = await retryStableChessboardRecognition(first, readConfirmation, {
      maxAttempts: 2,
      retryDelayMs: 0
    });
    expect(result).toMatchObject({ ok: true });
    expect(result.recognition.boardRows).toEqual(STARTING_ROWS);
    expect(readConfirmation).toHaveBeenCalledTimes(2);
  });

  it("retries a mismatched confirmation but never accepts an unstable position", async () => {
    const movedRows = [...STARTING_ROWS];
    movedRows[6] = "PPPP.PPP";
    const readConfirmation = vi.fn()
      .mockResolvedValueOnce({ ok: true, recognition: strongRecognition(movedRows) })
      .mockResolvedValueOnce({ ok: true, recognition: strongRecognition() });
    const result = await retryStableChessboardRecognition(strongRecognition(), readConfirmation, {
      maxAttempts: 2,
      retryDelayMs: 0
    });
    expect(result).toMatchObject({ ok: true });
    expect(readConfirmation).toHaveBeenCalledTimes(2);
  });

  it("still rejects if no confirmation read agrees with the candidate board", async () => {
    const readConfirmation = vi.fn()
      .mockResolvedValue({ ok: false, reason: "provider_error", message: "Vision unavailable." });
    const result = await retryStableChessboardRecognition(strongRecognition(), readConfirmation, {
      maxAttempts: 2,
      retryDelayMs: 0
    });
    expect(result).toMatchObject({ ok: false, reason: "confirmation_scan_unavailable" });
    expect(readConfirmation).toHaveBeenCalledTimes(2);
  });

  it("does not trust a second scan that failed or could not reach recognition", () => {
    const first = { ok: true, recognition: strongRecognition() };
    expect(verifyStableChessboardRecognition(first, {
      ok: false, reason: "recognition_unavailable", message: "Try again."
    })).toMatchObject({ ok: false, reason: "confirmation_scan_unavailable" });
  });

  it("rejects adjacent kings instead of handing an impossible position to the engine", () => {
    const rows = [
      "........",
      "........",
      "........",
      "........",
      "....Kk..",
      "........",
      "........",
      "........"
    ];
    expect(validateBoardRows(rows)).toMatchObject({ ok: false, reason: "adjacent_kings" });
  });
});

describe("provider result assessment", () => {
  it("accepts a complete clear position at the fast single-pass confidence floor", () => {
    expect(assessRecognition(strongRecognition(STARTING_ROWS, {
      confidence: 0.74,
      squareConfidences: Array(64).fill(0.60)
    })).ok).toBe(true);
    expect(assessRecognition(strongRecognition()).ok).toBe(true);
  });

  it("rejects non-chess, cropped, uncertain and invalid model outputs", () => {
    expect(assessRecognition({ ...strongRecognition(), boardVisible: false })).toMatchObject({ ok: false, reason: "no_board" });
    expect(assessRecognition({ ...strongRecognition(), allFourCornersVisible: false })).toMatchObject({ ok: false, reason: "partial_board" });
    expect(assessRecognition({ ...strongRecognition(), orientation: "unknown" })).toMatchObject({ ok: false, reason: "orientation_uncertain" });
    expect(assessRecognition({ ...strongRecognition(), confidence: 1.1 })).toMatchObject({ ok: false, reason: "uncertain_recognition" });
    const adjacentKings = ["........", "........", "........", "........", "....Kk..", "........", "........", "........"];
    expect(assessRecognition(strongRecognition(adjacentKings))).toMatchObject({ ok: false, reason: "adjacent_kings" });
    expect(assessRecognition({ ...strongRecognition(), squareConfidences: Array(64).fill(0.2) })).toMatchObject({ ok: false, reason: "uncertain_squares" });
    expect(assessRecognition({ ...strongRecognition(), boardRows: ["garbled"] })).toMatchObject({ ok: false, reason: "invalid_board_shape" });
  });

  it("instructs the model not to invent pieces or infer side-to-move/history", () => {
    const prompt = buildChessRecognitionPrompt("Black");
    expect(prompt).toContain("Do not guess");
    expect(prompt).toContain("physical or digital chessboard");
    expect(prompt).not.toContain("there is no physical chessboard");
    expect(prompt).toContain("Do not assume the starting position");
    expect(prompt).toContain("Do not infer or change that side");
    expect(buildChessRecognitionPrompt(null)).toContain("The side to move is unknown");
    expect(prompt).toContain("all four corners");
    expect(prompt).toContain("Chess.com");
    expect(prompt).toContain("monitor, laptop, tablet, or phone");
    expect(prompt).toContain("ignore everything outside its grid");
    expect(prompt).toContain("visually nearest the bottom edge of the chessboard image");
  });
});

describe("bounded authenticated chess scan endpoint", () => {
  const env = {
    GCP_PROJECT_ID: "test-project",
    GCP_SERVICE_ACCOUNT_JSON: "{configured}",
  };

  it("rejects non-POST, missing explicit intent, and cross-origin requests before provider access", async () => {
    const getAccessToken = vi.fn(async () => "test-token");
    const fetchImpl = vi.fn();
    const get = (body, init = {}) => new Request("https://askmoina.test/api/chess/recognize", {
      method: init.method || "POST",
      headers: { "Content-Type": "application/json", "Origin": init.origin || "https://askmoina.test" },
      body: init.method === "GET" ? undefined : JSON.stringify(body)
    });
    const wrongMethod = await handleChessRecognitionRequest(get(requestBody(), { method: "GET" }), env, { getAccessToken, fetchImpl });
    expect(wrongMethod.status).toBe(405);
    const missingPurpose = await handleChessRecognitionRequest(get(requestBody({ purpose: "ordinary_chat" })), env, { getAccessToken, fetchImpl });
    expect(missingPurpose.status).toBe(400);
    const crossOrigin = await handleChessRecognitionRequest(get(requestBody(), { origin: "https://attacker.test" }), env, { getAccessToken, fetchImpl });
    expect(crossOrigin.status).toBe(403);
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("supports automatic board-only recognition when the turn is unknown", async () => {
    const getAccessToken = vi.fn(async () => "test-token");
    const fetchImpl = vi.fn(async (_url, init) => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(strongRecognition()) }] } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const response = await handleChessRecognitionRequest(makeRequest(requestBody({ sideToMove: null })), env, { getAccessToken, fetchImpl, resolveActor: async () => "test-user" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, sideToMove: null });
    expect(fetchImpl.mock.calls[0][1].body).toContain("The side to move is unknown");
  });

  it("rejects fake/non-JPEG and oversized inputs before provider access", async () => {
    const getAccessToken = vi.fn(async () => "test-token");
    const fetchImpl = vi.fn();
    const fakeJpeg = await handleChessRecognitionRequest(makeRequest(requestBody({ imageData: "aGVsbG8=" })), env, { getAccessToken, fetchImpl });
    expect(fakeJpeg.status).toBe(400);
    const badMime = await handleChessRecognitionRequest(makeRequest(requestBody({ imageMimeType: "image/png" })), env, { getAccessToken, fetchImpl });
    expect(badMime.status).toBe(400);
    const huge = await handleChessRecognitionRequest(makeRequest(requestBody({ imageData: "A".repeat(800_000) })), env, { getAccessToken, fetchImpl });
    expect(huge.status).toBe(413);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("calls Vertex once and returns a screened structured board without storing/logging the image", async () => {
    const getAccessToken = vi.fn(async () => "test-token");
    const providerResult = { candidates: [{ content: { parts: [{ text: JSON.stringify(strongRecognition()) }] } }] };
    const fetchImpl = vi.fn(async (_url, init) => {
      expect(init.headers.Authorization).toBe("Bearer test-token");
      const requestJson = JSON.parse(init.body);
      expect(requestJson.generationConfig.maxOutputTokens).toBe(900);
      expect(requestJson.generationConfig).not.toHaveProperty("temperature");
      expect(requestJson.generationConfig).not.toHaveProperty("topP");
      expect(requestJson.generationConfig).not.toHaveProperty("candidateCount");
      expect(requestJson.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "LOW" });
      expect(requestJson.generationConfig.responseMimeType).toBe("application/json");
      return new Response(JSON.stringify(providerResult), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const response = await handleChessRecognitionRequest(makeRequest(), env, {
      getAccessToken, fetchImpl, resolveActor: async () => "chess-test-user-a", now: (() => { let now = 100_000; return () => now; })()
    });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(json.recognition.boardRows).toEqual(STARTING_ROWS);
    expect(json.sideToMove).toBe("w");
    expect(json.history.castlingRights).toBe("unknown_from_image");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns the upstream provider status without exposing its response body", async () => {
    const getAccessToken = vi.fn(async () => "test-token");
    const fetchImpl = vi.fn(async () => new Response("private provider detail that must not escape", { status: 400 }));
    const response = await handleChessRecognitionRequest(makeRequest(), env, {
      getAccessToken,
      fetchImpl,
      resolveActor: async () => "chess-provider-status-test",
      now: (() => { let now = 500_000; return () => now; })()
    });
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toMatchObject({ ok: false, reason: "provider_error", providerStatus: 400 });
    expect(body.message).toBe("Chessboard recognition is temporarily unavailable.");
    expect(JSON.stringify(body)).not.toContain("private provider detail");
  });

  it("returns 422 for a cropped or uncertain board rather than forwarding it", async () => {
    const getAccessToken = vi.fn(async () => "test-token");
    const providerResult = { candidates: [{ content: { parts: [{ text: JSON.stringify(strongRecognition(STARTING_ROWS, { allFourCornersVisible: false })) }] } }] };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(providerResult), { status: 200 }));
    const response = await handleChessRecognitionRequest(makeRequest(), env, {
      getAccessToken, fetchImpl, resolveActor: async () => "chess-test-user-b", now: (() => { let now = 200_000; return () => now; })()
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ ok: false, reason: "partial_board" });
  });
});

describe("browser scan client", () => {
  it("recognizes a board before asking the user whose turn it is", async () => {
    const fetchImpl = vi.fn(async (_url, init) => new Response(JSON.stringify({
      ok: true, recognition: strongRecognition(), sideToMove: null
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const blob = new Blob([Uint8Array.from([255, 216, 255, 0])], { type: "image/jpeg" });
    const result = await recognizeChessboardFrame(blob, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).not.toHaveProperty("sideToMove");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sideToMove).toBeNull();
      expect(result.position).toBeNull();
      expect(result.recognition.boardRows).toEqual(STARTING_ROWS);
    }
  });

  it("gives a timeout-specific message instead of blaming camera framing", async () => {
    const fetchImpl = vi.fn(async () => { throw Object.assign(new Error("request timed out"), { name: "TimeoutError" }); });
    const blob = new Blob([Uint8Array.from([255, 216, 255, 0])], { type: "image/jpeg" });
    const result = await recognizeChessboardFrame(blob, { fetchImpl });
    expect(result).toMatchObject({ ok: false, reason: "recognition_timeout" });
    expect(result.message).toContain("Chess.com");
    expect(result.message).toContain("timed out");
  });

  it("lets the browser wait longer than the Worker recognition budget", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(new AbortController().signal);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      ok: false,
      reason: "recognition_timeout",
      message: "Chessboard recognition timed out."
    }), { status: 504, headers: { "Content-Type": "application/json" } }));
    const blob = new Blob([Uint8Array.from([255, 216, 255, 0])], { type: "image/jpeg" });
    const result = await recognizeChessboardFrame(blob, { fetchImpl });
    expect(timeoutSpy).toHaveBeenCalledWith(32_000);
    expect(result).toMatchObject({ ok: false, reason: "recognition_timeout" });
  });

  it("validates returned board data and produces FEN only after confidence checks", async () => {
    const fetchImpl = vi.fn(async (_url, init) => new Response(JSON.stringify({
      ok: true, recognition: strongRecognition(), sideToMove: "w"
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const blob = new Blob([Uint8Array.from([255, 216, 255, 0])], { type: "image/jpeg" });
    const result = await recognizeChessboardFrame(blob, { sideToMove: "w", fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).purpose).toBe("chess_board_scan");
    expect(result.ok).toBe(true);
    expect(result.position.fen).toContain(" w - - 0 1");
    expect(result.position.legalMoveCount).toBe(20);
  });

  it("does not make an FEN from uncertain model recognition", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      ok: true, recognition: strongRecognition(STARTING_ROWS, { confidence: 0.5 }), sideToMove: "w"
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const blob = new Blob([Uint8Array.from([255, 216, 255, 0])], { type: "image/jpeg" });
    const result = await recognizeChessboardFrame(blob, { sideToMove: "w", fetchImpl });
    expect(result).toMatchObject({ ok: false, reason: "uncertain_recognition" });
  });
});
