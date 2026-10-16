# AskMoina Voice Chess — Phase 2 Recognition Checkpoint

## Repository state

- Repository: https://github.com/ashini-x/askmoina-voice
- Phase 1 base: `feat/chess-stockfish-phase-1-engine`, PR #184 (open when Phase 2 started).
- Phase 2 branch: `feat/chess-stockfish-phase-2-recognition`.
- Scope: one explicit, single-frame chess scan. This does not activate a watcher and does not change the regular live camera, microphone, WebSocket, session-resumption, or reconnect flows.

## Recognition architecture

- The browser caller supplies one already captured, JPEG-compressed camera frame only after explicit chess intent. This module does not poll or observe the camera.
- An authenticated same-origin Worker endpoint `POST /api/chess/recognize` forwards one bounded image to the existing Vertex AI `gemini-3.8-flash` GenerateContent endpoint. No new provider/API is introduced.
- Provider calls are single-shot (no retries), use JSON response schema, temperature 0, a maximum output token setting of 900, and a bounded request timeout. The endpoint rejects cross-origin requests when an Origin header is present, non-POST requests, wrong purpose, missing side-to-move confirmation, non-JPEG/oversized input, and malformed provider responses.
- Server- and browser-side checks require 8 rows x 8 squares, standard piece symbols, exactly one king per side, plausible total/pawn counts, no back-rank pawns, visible board corners, recognized orientation, no ambiguous squares, a model-estimated confidence at or above the configured floor, and 64 per-square scores.
- The browser compresses no images itself: Phase 4's camera adapter must provide one clear JPEG no larger than 512 KiB. The result is converted to FEN using the existing generated chess.js module, then validated with both `validateFen` and `new Chess(fen)` before it can be passed to Stockfish.
- The provider-reported confidence is explicitly treated as an uncalibrated model estimate, not a guaranteed probability. The confidence floor is a conservative rejection heuristic, not an accuracy guarantee.
- User-confirmed side-to-move is required; it is never inferred from pieces alone. Board images cannot reliably reveal castling rights, en-passant eligibility, or half/full-move counters. The FEN returned by Phase 2 sets castling/en-passant to `-` and counters to `0 1` as syntactic placeholders, and marks history fields as incomplete. Phase 3 must populate rights from a known new game or track moves; do not treat these placeholders as known game history.

## Security, privacy and resource bounds

- Requires an authenticated AskMoina session, and uses existing server-held Vertex credentials.
- Request body/image capped; one image and one provider request per scan; output token cap and request timeout bound.
- Image data and board rows are not logged or persisted by the recognition handler.
- A three-second per-actor rate guard is best-effort within one Worker isolate; it is not a globally distributed quota. A production-scale quota would need a shared limiter.
- The actual visual model runs remotely through the already-configured Vertex service, so scans incur the account's normal Vertex usage. Do not trigger it during ordinary assistant turns or without explicit chess intent.

## Verification status

Automated tests cover initial and representative mid-game square layouts, FEN compression, chess.js validation, piece counts, kings, back-rank pawns, board orientation/visibility gates, low-confidence and ambiguous readings, explicit side-to-move, image bounds/MIME/header checks, origin handling, bounded single-call request shape, and provider failures.

**Not yet verified:** this repository change has not been tested against a ground-truthed set of real physical 3D board photographs on a mobile camera. Model self-confidence does not prove recognition accuracy. Do not claim physical-camera accuracy, deploy to production, or use the output for automatic game tracking until Phase 3/5 validation includes diverse real physical-board frames and failure cases.

## Phase 3 — next

Implement explicit chess game state and move continuity, using validated board readings as observations and never as a complete history. Track new-game state, player color, side to move, castling and en-passant rights when known; compare successive positions to infer legal opponent moves. For ambiguous/missed/captured/promoted/castled transitions, request another frame or clarification instead of fabricating history. Seed arbitrary mid-game positions without demanding the move list, but explicitly flag unknown historical rights. Test reconnects, duplicated frames, orientation changes, temporary occlusion, and every special move. Keep chess separate from the standard AskMoina session and do not modify live voice/session-resumption paths except for a specifically proven defect.
