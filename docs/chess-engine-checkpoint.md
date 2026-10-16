# AskMoina Voice Chess Engine — Implementation Checkpoint

## Verified base and current checkpoint

- Repository: https://github.com/ashini-x/askmoina-voice
- Default branch at inspection: \`main\`
- Base commit inspected: \`337ce2ad969d3a6a12d2e9b97a81b8ee47070cfc\`
- Chess implementation branch: \`feat/chess-stockfish-phase-1-engine\`
- Current implementation commit before this checkpoint update: \`c1ed2b086bbfccd80c93608b9b118bae09a174f7\`
- Inspection date: 2026-10-16.
- Production runtime: Cloudflare Worker with browser assets, a Worker WebSocket relay, Vertex AI Gemini Live, D1, and Durable Objects.
- The main Co-Pilot browser code is \`public/copilot.js\` and \`public/copilot.html\`. \`src/copilot-assets.ts\` embeds these assets; \`test/copilot-assets.test.js\` requires the embedded copies to match the public files exactly.
- Chess Phase 1 has NOT been merged into \`main\` or deployed to production. Pull request: https://github.com/ashini-x/askmoina-voice/pull/184

## Phase 1 — Stockfish engine foundation: implementation and CI validated

Implemented in the isolated branch:
- Exact pinned development dependencies \`stockfish@19.0.1\` and \`chess.js@1.4.0\`.
- Browser Web Worker UCI client in \`public/chess/engine-client.js\`.
- \`inspectChessPosition(fen)\` with FEN validation and legal-move metadata.
- Bounded Stockfish search, UCI startup/readiness handling, timeout paths, concurrent-search guard, disposal, and legality-checking of the returned UCI move.
- A precheck/pretest/predeploy asset preparation script that copies only the pinned lite-single Stockfish JavaScript + WASM assets and chess.js ESM module from npm packages. License text and third-party notices are generated alongside the assets; generated third-party files remain ignored by Git.
- Actual Node UCI smoke test in \`scripts/chess-engine-smoke.mjs\`.
- Unit tests in \`test/chess-engine.test.js\` for starting/mid-game FENs, malformed input, worker handshake/search, legal move validation, concurrency, terminal positions, startup timeout, search timeout, and disposal.
- CI gates in \`.github/workflows/release-validation.yml\` and \`.github/workflows/deploy-candidate-a-live-voice.yml\`. The stockfish smoke test runs before release validation can proceed.

Last validation run:
- GitHub Actions Release validation run #853: PASS for commit \`c1ed2b086bbfccd80c93608b9b118bae09a174f7\`.
- Run: https://github.com/ashini-x/askmoina-voice/actions/runs/38939867243
- TypeScript check: PASS.
- Vitest: 62 test files, 468 tests passed.
- Actual Stockfish UCI smoke: PASS; starting position returned \`e2e4\` (SAN \`e4\`), and chess.js confirmed it legal.
- Wrangler deploy dry-run: PASS.
- This is CI/pre-deploy bundle validation only; it is not a production deployment or a live mobile-browser test.

## Non-negotiable implementation principles

1. Keep chess optional and isolated from the regular live voice flow.
2. Run Stockfish in a same-origin browser Web Worker, not on the Worker request path and not on the camera/audio main thread.
3. Start with the lite single-threaded Stockfish WASM build to avoid cross-origin isolation/COOP/COEP requirements.
4. Validate every proposed FEN and every engine move with chess.js before presenting a recommendation.
5. Treat visual position recognition as a separate, fallible stage. Never infer a complete board from a low-confidence or partly obscured frame.
6. Piece placement alone does not reveal side-to-move, castling rights, or an en-passant right. For a mid-game photograph, obtain side-to-move from the user or reliable session context; represent history-dependent rights conservatively and clearly handle uncertainty.
7. Do not change production voice/camera code until board-recognition accuracy and latency have dedicated tests.

## Phase 2 — Camera-to-board recognition: next

Required work:
- Evaluate a local, same-origin, client-side recognition model and perspective correction for **physical 3D chessboards captured through a phone camera**.
- A possible browser-side candidate is \`@scoriiu/fenshot\` (MIT; approximately 1.3 MB ONNX classifier), but its current documentation explicitly limits scope to 2D screenshots/diagrams and says perspective 3D piece sets are out of scope. It must NOT be accepted as the physical-board solution without empirical testing.
- A CameraChess/LeYOLO-based physical-board model is another research lead, but the public adaptation we inspected states that the upstream CameraChessWeb project is AGPL-3.0 and the hosted model license must be confirmed before redistributing its weights. Do not copy unverified weights into AskMoina.
- Choose a licence-compatible model; preprocess/crop frames locally; detect all four board corners; perspective-normalize; classify piece positions; emit confidence; validate king counts and chess legality; fail safely on ambiguity.
- Keep recognition local if feasible; no new paid inference API by default. Reuse camera frames only on explicit chess intent/scan. Make model download lazy and bounded for mobile data.
- Add representative fixed-frame fixtures, including true physical boards under different angle/light/sets, empty/non-chess scenes, partial occlusion and low-confidence boards. Require ground-truth FENs. Do not report success based only on digital screenshots.

Acceptance tests for Phase 2:
- The initial starting board is detected with all 32 pieces and correct orientation.
- A set of ground-truthed arbitrary mid-game physical-board photos are read correctly, with no wrong high-confidence positions.
- Empty scenes and ambiguous/partly blocked boards are rejected or marked uncertain.
- Detection confidence and board geometry are surfaced to the chess controller.
- Mobile latency and memory usage are measured; inference does not block microphone playback or frame capture.

## Phase 3 — Position continuity

- Maintain an explicit chess-session state independent of Gemini's transcript and the Live WebSocket session.
- For a starting game, retain move/rights state and compare successive recognized boards to infer the opponent's move, including capture, castling, promotion and missed frames.
- For a mid-game join, seed from the current board and user-specified side-to-move. Do not ask for move history. Explicitly treat history-dependent castling/en-passant rights as uncertain unless known.
- Resolve ambiguous transitions by taking another clear frame or asking a focused confirmation; never silently promote an impossible board into engine input.
- Test rapid moves, motion blur, hand occlusion, camera movement, piece lift-before-placement, and reconnect/session recovery.

## Phase 4 — Voice and UI integration

- Activate chess only on clear chess intent or explicit request. Ordinary AskMoina usage remains unchanged.
- Understand statements such as “I am White,” “I am Black,” “best move?”, “why this move?”, and contextual follow-ups.
- Give user colour and side-to-move separate meanings; never treat the user's colour as the turn indicator.
- Show a concise best-move card with source square, destination square, optional promotion, SAN/UCI, principal variation/evaluation when appropriate, and a visible uncertainty notice when the board was not fully reliable.
- Update the Copilot UI only in its source files and synchronize the corresponding literals in \`src/copilot-assets.ts\`. If the WebAssembly CSP requires a change, scope it narrowly to the Copilot response (use \`wasm-unsafe-eval\`, never broad \`unsafe-eval\`).
- Provide a user-accessible stop/reset path and remove the chess worker/session when leaving chess mode.

## Phase 5 — Regression, deployment and live verification

- Test on target Android mobile browsers, especially cold load, low-memory and poor-network cases.
- Run all existing tests, chess fixtures, legal-move checks, frame/session recovery checks, and a production-like browser test.
- Verify static model/WASM MIME types, CSP, same-origin asset loading, license notices and generated bundle sizes.
- Deploy only after branch validation and the existing production release gate are healthy. No chess branch code has been deployed to production at this checkpoint.

## Existing production deployment caution (separate from chess)

At base commit \`337ce2ad969d3a6a12d2e9b97a81b8ee47070cfc\`, the latest inspected production workflow promoted the release and passed health/critical-route checks, but its post-deploy synthetic bundle failed three checks: grounded web search, speech-first voice turn, and voice memory. Browser network recovery, long-running Live continuity and persistent history passed. This separate issue should be resolved before calling the overall production deployment pipeline fully green.
