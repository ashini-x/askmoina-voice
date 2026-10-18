import type { Env } from "../config/env";
import { getGoogleAccessToken } from "../auth/google";
import { getAuthenticatedUserId } from "../auth/accounts";
import { isAdmin } from "../continuity";

const MAX_IMAGE_BYTES = 512 * 1024;
const MAX_BODY_BYTES = 720 * 1024;
const REQUEST_BUDGET_MS = 30_000;
const PROVIDER_TIMEOUT_MS = 24_000;
const MIN_CONFIDENCE = 0.82;
const MIN_SQUARE_CONFIDENCE = 0.75;
const MODEL = "gemini-3.8-flash";
const LOCATION = "global";
const HOST = "aiplatform.googleapis.com";

// Best-effort per-isolate guard. The browser also makes only a single explicit
// scan call; this is not presented as a globally distributed quota.
const recentScanByAccount = new Map<string, number>();
const MIN_SCAN_INTERVAL_MS = 900;

type BoardRecognition = {
  boardVisible: boolean;
  allFourCornersVisible: boolean;
  orientation: "white_at_bottom" | "black_at_bottom" | "unknown";
  boardCornersNormalized: Array<{ x: number; y: number }>;
  boardRows: string[];
  confidence: number;
  squareConfidences: number[];
  ambiguousSquares: string[];
  notes: string;
};

type RecognitionDependencies = {
  getAccessToken?: (env: Env) => Promise<string>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  resolveActor?: (request: Request, env: Env) => Promise<string | null>;
};

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    boardVisible: { type: "BOOLEAN" },
    allFourCornersVisible: { type: "BOOLEAN" },
    orientation: { type: "STRING", enum: ["white_at_bottom", "black_at_bottom", "unknown"] },
    boardCornersNormalized: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { x: { type: "NUMBER" }, y: { type: "NUMBER" } },
        required: ["x", "y"],
        propertyOrdering: ["x", "y"]
      }
    },
    boardRows: { type: "ARRAY", items: { type: "STRING" } },
    confidence: { type: "NUMBER" },
    squareConfidences: { type: "ARRAY", items: { type: "NUMBER" } },
    ambiguousSquares: { type: "ARRAY", items: { type: "STRING" } },
    notes: { type: "STRING" }
  },
  required: ["boardVisible", "allFourCornersVisible", "orientation", "boardCornersNormalized", "boardRows", "confidence", "squareConfidences", "ambiguousSquares", "notes"],
  propertyOrdering: ["boardVisible", "allFourCornersVisible", "orientation", "boardCornersNormalized", "boardRows", "confidence", "squareConfidences", "ambiguousSquares", "notes"]
} as const;

/**
 * Handles one explicitly requested chessboard scan. Images are not logged,
 * stored, added to chat history, or forwarded into ordinary Live voice turns.
 */
export async function handleChessRecognitionRequest(
  request: Request,
  env: Env,
  dependencies: RecognitionDependencies = {}
): Promise<Response> {
  const json = (body: unknown, status = 200) => Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin"
    }
  });

  if (request.method !== "POST") return json({ ok: false, reason: "method_not_allowed", message: "Use POST to scan one chessboard frame." }, 405);
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ ok: false, reason: "cross_origin_denied", message: "Chessboard scans must be sent from AskMoina itself." }, 403);
  }
  if (!request.headers.get("Content-Type")?.toLowerCase().includes("application/json")) {
    return json({ ok: false, reason: "invalid_content_type", message: "Send a single JPEG frame in the supported chess scan format." }, 415);
  }
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return json({ ok: false, reason: "frame_too_large", message: "This camera frame is too large. Use a smaller JPEG frame under 512 KiB." }, 413);
  }

  const boundedBody = await readBoundedJson(request, MAX_BODY_BYTES);
  if (!boundedBody.ok) {
    return boundedBody.tooLarge
      ? json({ ok: false, reason: "request_too_large", message: "This camera frame is too large. Use a JPEG under 512 KiB." }, 413)
      : json({ ok: false, reason: "invalid_json", message: "The chess scan request was not valid JSON." }, 400);
  }
  const body: unknown = boundedBody.value;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ ok: false, reason: "invalid_request", message: "The chess scan request is invalid." }, 400);
  }
  const input = body as Record<string, unknown>;
  if (input.purpose !== "chess_board_scan") {
    return json({ ok: false, reason: "explicit_chess_intent_required", message: "A chess-specific scan must be requested explicitly." }, 400);
  }
  if (input.sideToMove != null && input.sideToMove !== "w" && input.sideToMove !== "b") {
    return json({ ok: false, reason: "invalid_side_to_move", message: "Side to move must be White, Black, or omitted when unknown." }, 400);
  }
  if (input.imageMimeType !== "image/jpeg" || typeof input.imageData !== "string" ||
      input.imageData.length < 8 || input.imageData.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 8 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(input.imageData) || input.imageData.length % 4 !== 0) {
    return json({ ok: false, reason: "invalid_frame", message: "Send one valid JPEG camera frame under 512 KiB." }, 400);
  }

  let imageBytes: string;
  try { imageBytes = atob(input.imageData); } catch {
    return json({ ok: false, reason: "invalid_frame", message: "The camera frame could not be decoded." }, 400);
  }
  if (imageBytes.length < 4 || imageBytes.length > MAX_IMAGE_BYTES ||
      imageBytes.charCodeAt(0) !== 0xff || imageBytes.charCodeAt(1) !== 0xd8 || imageBytes.charCodeAt(2) !== 0xff) {
    return json({ ok: false, reason: "invalid_frame", message: "The image must be a valid JPEG smaller than 512 KiB." }, 400);
  }

  let actor: string | null = null;
  if (dependencies.resolveActor) {
    actor = await dependencies.resolveActor(request, env).catch(() => null);
  } else {
    const accountId = await getAuthenticatedUserId(request, env).catch(() => null);
    const adminAccess = accountId ? false : await isAdmin(request, env).catch(() => false);
    actor = accountId || (adminAccess ? "admin" : null);
  }
  if (!actor) {
    return json({ ok: false, reason: "authentication_required", message: "Sign in to use chessboard recognition." }, 401);
  }
  const now = dependencies.now ? dependencies.now() : Date.now();
  const previous = recentScanByAccount.get(actor);
  if (previous !== undefined && now - previous < MIN_SCAN_INTERVAL_MS) {
    return json({ ok: false, reason: "scan_rate_limited", message: "Please wait a moment before scanning another board." }, 429);
  }
  recentScanByAccount.set(actor, now);
  if (recentScanByAccount.size > 2_000) {
    for (const [key, timestamp] of recentScanByAccount) {
      if (now - timestamp > 60_000) recentScanByAccount.delete(key);
    }
  }

  if (!env.GCP_PROJECT_ID?.trim() ||
      !(env.GCP_SERVICE_ACCOUNT_JSON?.trim() || (env.GCP_CLIENT_EMAIL?.trim() && env.GCP_PRIVATE_KEY?.trim()))) {
    return json({ ok: false, reason: "recognition_not_configured", message: "Chessboard recognition is temporarily unavailable." }, 503);
  }

  const startedAt = dependencies.now ? dependencies.now() : Date.now();
  try {
    const getAccessToken = dependencies.getAccessToken || getGoogleAccessToken;
    const fetchImpl = dependencies.fetchImpl || fetch;
    const accessToken = await getAccessToken(env);
    const remainingMs = REQUEST_BUDGET_MS - ((dependencies.now ? dependencies.now() : Date.now()) - startedAt);
    if (remainingMs <= 500) {
      return json({ ok: false, reason: "recognition_timeout", message: "Chessboard recognition timed out before finishing this frame. Keep the 8×8 grid centred and try again; digital boards on a screen, including Chess.com, are supported." }, 504);
    }

    const controller = new AbortController();
    const timeoutMs = Math.min(PROVIDER_TIMEOUT_MS, remainingMs);
    const timeout = setTimeout(() => controller.abort("chess_recognition_timeout"), timeoutMs);
    let response: Response;
    try {
      const url = `https://${HOST}/v1/projects/${encodeURIComponent(env.GCP_PROJECT_ID.trim())}/locations/${LOCATION}/publishers/google/models/${MODEL}:generateContent`;
      response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{
            role: "user",
            parts: [
              { text: buildChessRecognitionPrompt(input.sideToMove === "w" ? "White" : input.sideToMove === "b" ? "Black" : null) },
              { inlineData: { mimeType: "image/jpeg", data: input.imageData } }
            ]
          }],
          generationConfig: {
            temperature: 0,
            topP: 0.1,
            candidateCount: 1,
            maxOutputTokens: 900,
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA
          }
        })
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      // Deliberately do not send provider response details, prompts, or frame data to the browser.
      return json({ ok: false, reason: response.status === 429 ? "provider_busy" : "provider_error", message: response.status === 429
        ? "Chessboard recognition is temporarily busy. Please try again in a moment."
        : "Chessboard recognition is temporarily unavailable." }, response.status === 429 ? 429 : 502);
    }

    let providerData: unknown;
    try { providerData = await response.json(); } catch {
      return json({ ok: false, reason: "invalid_provider_response", message: "Chessboard recognition returned an unreadable result." }, 502);
    }
    const resultText = extractCandidateText(providerData);
    if (!resultText || resultText.length > 16_000) {
      return json({ ok: false, reason: "invalid_provider_response", message: "Chessboard recognition did not return a usable board reading." }, 502);
    }

    let parsed: unknown;
    try { parsed = JSON.parse(resultText); } catch {
      return json({ ok: false, reason: "invalid_provider_response", message: "Chessboard recognition did not return structured board data." }, 502);
    }
    const assessment = assessRecognition(parsed);
    if (!assessment.ok) {
      return json({ ok: false, reason: assessment.reason, message: assessment.message }, 422);
    }

    return json({
      ok: true,
      recognition: assessment.recognition,
      sideToMove: input.sideToMove === "w" || input.sideToMove === "b" ? input.sideToMove : null,
      history: {
        castlingRights: "unknown_from_image",
        enPassantSquare: "unknown_from_image",
        moveCounters: "unknown_from_image"
      },
      budgetMs: REQUEST_BUDGET_MS,
      provider: MODEL,
      confidenceKind: "model-estimated; not calibrated"
    });
  } catch (error) {
    const isAbort = error instanceof Error && (/abort|timeout/i.test(error.name + " " + error.message));
    return json({
      ok: false,
      reason: isAbort ? "recognition_timeout" : "recognition_unavailable",
      message: isAbort
        ? "Chessboard recognition timed out before finishing this frame. Keep the 8×8 grid centred and try again; digital boards on a screen, including Chess.com, are supported."
        : "Chessboard recognition is temporarily unavailable. Please try again."
    }, isAbort ? 504 : 503);
  }
}

export function buildChessRecognitionPrompt(sideToMove: "White" | "Black" | null = null): string {
  return [
    "You are a cautious chessboard visual-recognition component, not a chess-playing assistant.",
    "Analyze only the supplied single image. It is sent by AskMoina chess auto-detection or for a user-requested chessboard scan.",
    "Do not guess. If there is no physical or digital chessboard, any corner is cropped, any square is hidden/unclear, perspective prevents reliable square mapping, or any piece identity is uncertain, report low confidence and list affected squares.",
    "The board may be a physical board or a DIGITAL 2D chessboard shown on a monitor, laptop, tablet, or phone, including Chess.com or another chess website/app. A board displayed on a screen is valid: do not reject flat digital pieces, square highlights, move arrows, browser tabs, menus, or surrounding webpage UI.",
    "First locate the largest complete 8x8 chessboard region, then ignore everything outside its grid. Use the visible square boundaries and piece silhouettes to read all 64 squares. A screen photographed at an angle is still a valid chessboard if its four board corners and squares are visible.",
    "Do not assume the starting position or infer a move history. The board may be mid-game, rotated, tilted in perspective, or lit unevenly.",
    "Return boardRows as exactly eight strings of exactly eight characters, with rank 8 first and rank 1 last; within every row files a through h. Use uppercase P,N,B,R,Q,K for White pieces, lowercase p,n,b,r,q,k for Black pieces, and . for an empty square.",
    "Normalize the rows to standard chess coordinates regardless of board rotation. orientation must say which color's pieces are visually nearest the bottom edge of the chessboard image: white_at_bottom or black_at_bottom. This also applies when the board is displayed on a screen. Use unknown if uncertain.",
    "allFourCornersVisible is true only when the entire 8x8 board boundary and all four corners are visible. boardVisible is false for any non-chess scene.",
    "Return boardCornersNormalized as exactly four points in clockwise image order, starting from the image's top-left-most board corner: [{x,y}, ...]. Coordinates are normalized from 0 to 1000 across the full image; x increases left to right and y increases top to bottom. Mark allFourCornersVisible false if any corner is outside the frame or uncertain. These are approximate camera-space outer board corners, not chess-square labels.",
    "Return 64 squareConfidences in the same row-major order as boardRows. Each is your estimated certainty from 0 to 1 for the square's occupant. This is a heuristic self-assessment, not a calibrated probability.",
    "ambiguousSquares must list every uncertain algebraic square using standard notation such as e4. An incomplete/confusing/occluded board must not be passed off as complete.",
    sideToMove ? "The user separately confirmed that the side to move is " + sideToMove + ". Do not infer or change that side from the board image." : "The side to move is unknown. Do not infer it from the board image; return only the board reading.",
    "Do not return castling rights, en-passant rights, move counters, candidate moves, explanations, or recommendations. A photograph cannot establish those historical fields.",
    "Return JSON matching the supplied schema only. Keep notes brief, specific, and non-instructional."
  ].join("\n");
}

export function assessRecognition(raw: unknown):
  | { ok: true; recognition: BoardRecognition }
  | { ok: false; reason: string; message: string } {
  const fail = (reason: string, message: string) => ({ ok: false as const, reason, message });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fail("invalid_provider_response", "Chessboard recognition did not return structured board data.");
  }
  const value = raw as Record<string, unknown>;
  if (value.boardVisible !== true) {
    return fail("no_board", "I cannot confidently identify a chessboard. Center the board and scan again.");
  }
  if (value.allFourCornersVisible !== true) {
    return fail("partial_board", "The full board is not visible. Show all four corners and all 64 squares.");
  }
  if (value.orientation !== "white_at_bottom" && value.orientation !== "black_at_bottom") {
    return fail("orientation_uncertain", "Board orientation is uncertain. Show the full board more directly.");
  }
  if (!Number.isFinite(value.confidence) || Number(value.confidence) < MIN_CONFIDENCE || Number(value.confidence) > 1) {
    return fail("uncertain_recognition", "Piece or square identity is uncertain. Improve lighting and scan again.");
  }
  if (!Array.isArray(value.boardCornersNormalized) || value.boardCornersNormalized.length !== 4 ||
      value.boardCornersNormalized.some((point) => !point || typeof point !== "object" ||
        !Number.isFinite((point as Record<string, unknown>).x) ||
        !Number.isFinite((point as Record<string, unknown>).y) ||
        Number((point as Record<string, unknown>).x) < 0 || Number((point as Record<string, unknown>).x) > 1000 ||
        Number((point as Record<string, unknown>).y) < 0 || Number((point as Record<string, unknown>).y) > 1000)) {
    return fail("invalid_board_geometry", "The board boundary could not be located reliably.");
  }
  const cornerPoints = value.boardCornersNormalized as Array<{ x: number; y: number }>;
  if (!isConvexBoardPolygon(cornerPoints)) {
    return fail("invalid_board_geometry", "The board corners do not form a reliable quadrilateral.");
  }
  if (!Array.isArray(value.ambiguousSquares) || value.ambiguousSquares.length !== 0) {
    return fail("ambiguous_squares", "Some squares are ambiguous. Remove obstructions and scan again.");
  }
  if (!Array.isArray(value.squareConfidences) || value.squareConfidences.length !== 64 ||
      value.squareConfidences.some((score) => !Number.isFinite(score) || Number(score) < MIN_SQUARE_CONFIDENCE || Number(score) > 1)) {
    return fail("uncertain_squares", "At least one square is not clear enough to trust. Scan again.");
  }
  if (!Array.isArray(value.boardRows) || value.boardRows.length !== 8 ||
      value.boardRows.some((row) => typeof row !== "string" || row.length !== 8 || !/^[.pnbrqkPNBRQK]{8}$/.test(row))) {
    return fail("invalid_board_shape", "The board reading did not contain 64 valid square symbols.");
  }
  const pieces = value.boardRows.join("");
  if ((pieces.match(/K/g) || []).length !== 1 || (pieces.match(/k/g) || []).length !== 1) {
    return fail("invalid_king_count", "The reading did not contain exactly one king per color.");
  }
  if ((pieces.match(/P/g) || []).length > 8 || (pieces.match(/p/g) || []).length > 8 ||
      (pieces.match(/[PNBRQK]/g) || []).length > 16 || (pieces.match(/[pnbrqk]/g) || []).length > 16) {
    return fail("impossible_piece_count", "The piece count is inconsistent with a legal chess position.");
  }
  if (/[Pp]/.test(value.boardRows[0]) || /[Pp]/.test(value.boardRows[7])) {
    return fail("invalid_pawn_rank", "A pawn was read on the first or eighth rank.");
  }
  const whiteKing = locateKing(value.boardRows as string[], "K");
  const blackKing = locateKing(value.boardRows as string[], "k");
  if (whiteKing && blackKing && Math.abs(whiteKing.file - blackKing.file) <= 1 &&
      Math.abs(whiteKing.rank - blackKing.rank) <= 1) {
    return fail("adjacent_kings", "The kings appear to occupy adjacent squares.");
  }
  for (const square of value.ambiguousSquares) {
    if (typeof square !== "string" || !/^[a-h][1-8]$/.test(square)) {
      return fail("invalid_ambiguity_metadata", "The square uncertainty metadata is invalid.");
    }
  }
  const recognition: BoardRecognition = {
    boardVisible: true,
    allFourCornersVisible: true,
    orientation: value.orientation,
    boardCornersNormalized: cornerPoints.map((point) => ({ x: Number(point.x), y: Number(point.y) })),
    boardRows: value.boardRows as string[],
    confidence: Number(value.confidence),
    squareConfidences: value.squareConfidences as number[],
    ambiguousSquares: value.ambiguousSquares as string[],
    notes: typeof value.notes === "string" ? value.notes.slice(0, 500) : ""
  };
  return { ok: true, recognition };
}

async function readBoundedJson(request: Request, maximumBytes: number):
  Promise<{ ok: true; value: unknown } | { ok: false; tooLarge: boolean }> {
  if (!request.body) return { ok: false, tooLarge: false };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel("chess_scan_body_limit").catch(() => undefined);
        return { ok: false, tooLarge: true };
      }
      chunks.push(next.value);
    }
  } catch {
    return { ok: false, tooLarge: false };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false, tooLarge: false };
  }
}

function isConvexBoardPolygon(points: Array<{ x: number; y: number }>): boolean {
  if (points.length !== 4) return false;
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
  // At least 1% of the full normalized image area.
  return Math.abs(twiceArea) / 2 >= 10_000;
}

function locateKing(rows: string[], target: "K" | "k"): { file: number; rank: number } | null {
  for (let row = 0; row < rows.length; row += 1) {
    const file = rows[row].indexOf(target);
    if (file >= 0) return { file, rank: 7 - row };
  }
  return null;
}

function extractCandidateText(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const candidates = (raw as Record<string, unknown>).candidates;
  if (!Array.isArray(candidates) || !candidates.length || !candidates[0] || typeof candidates[0] !== "object") return null;
  const content = (candidates[0] as Record<string, unknown>).content;
  if (!content || typeof content !== "object" || Array.isArray(content)) return null;
  const parts = (content as Record<string, unknown>).parts;
  if (!Array.isArray(parts)) return null;
  const textPart = parts.find((part) => part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string");
  return textPart ? String((textPart as Record<string, unknown>).text) : null;
}
