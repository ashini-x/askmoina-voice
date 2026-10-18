# Chess Phase 3 — Explicit game state and move continuity

## Delivered scope

Phase 3 adds a local, explicit chess workflow to the camera-first Co-Pilot:

- Chess is opened by a user-initiated control. It does not poll the camera, inspect frames in the background, upload ordinary frames, or alter the regular voice/WebSocket flow.
- Each scan captures one JPEG frame from the current camera preview and asks the existing authenticated, same-origin POST /api/chess/recognize endpoint to return a validated board position.
- Users may start from the standard initial position or seed an arbitrary mid-game position. Player color and side to move are explicitly chosen.
- State is kept on the current browser device in localStorage, restored through a replay of the bounded move list, and checked against the recorded current FEN on reload.
- A following scan is accepted as a move only when its piece placement and confirmed side-to-move match exactly one legal single-ply transition under chess.js. Repeated frames are idempotent. Missed/ambiguous/unexplained transitions are rejected rather than fabricated.
- Stockfish runs in the existing same-origin browser Worker and returns an optional next-move recommendation after a valid position is confirmed.
- Castling/en-passant legality is retained from a tracked new game. For a seeded mid-game position, castling rights are used only when the user explicitly confirms them. Otherwise the state marks historical rights incomplete and uses conservative FEN rights; no past move history is invented.
- Camera orientation may change without resetting a game because recognition returns rows normalized to standard chess coordinates. A change of camera orientation does not itself count as a move.

## Validation

test/chess-game-state.test.js exercises duplicate scans, orientation changes, legal move recording, side-to-move mismatch, missed plies, seeded positions, castling with explicitly confirmed rights, en passant when its prior move is known, promotion, and recovery from persisted state.

Existing recognition confidence remains a model-estimated heuristic, not a calibrated real-world accuracy guarantee. The feature requires a deliberate scan and does not store the JPEG image; only the recognized board and chess state are saved locally. Local browser storage is not cross-device account synchronization.

## Out of scope / remaining acceptance

- Real-phone acceptance across varied physical boards, lighting, camera rotation, partial occlusion and promotion/castling setups is still required.
- Voice narration of moves, conversational chess intent routing, engine-played moves, and cloud-synced game history are not claimed as part of Phase 3.
