# Chess Phase 3 — Explicit game state and move continuity

## Delivered scope

Phase 3 adds a camera-first chess workflow to the Co-Pilot. When a live camera stream is active, the browser submits one compressed still frame for chess recognition on a bounded backoff (roughly every 6–14 seconds while no board is found). Checks pause while the page is hidden, the camera is inactive, or a decision popup is open; the knight control pauses/resumes detection. The provider receives frames for chess recognition only, not ordinary Live voice turns.

- No setup screen is needed. A confident board detection opens a small contextual popup with two choices: suggest a move or track the game. Side-to-move is asked only when it cannot be inferred safely from a tracked game or the standard starting layout. Board-only detection never guesses turn, castling rights, en-passant rights, or move counters.
- Each scan captures one JPEG frame from the current camera preview and asks the existing authenticated, same-origin POST /api/chess/recognize endpoint to return a validated board position.
- Users may start from the standard initial position or seed an arbitrary mid-game position. Player color and side to move are explicitly chosen.
- State is kept on the current browser device in localStorage, restored through a replay of the bounded move list, and checked against the recorded current FEN on reload.
- After tracking begins, a following scan is accepted as a move only when its piece placement and turn inferred from the known game state match exactly one legal single-ply transition under chess.js. Repeated frames are idempotent. Missed/ambiguous/unexplained transitions are rejected rather than fabricated.
- Stockfish runs in the existing same-origin browser Worker and returns an optional next-move recommendation after a valid position is confirmed.
- Castling/en-passant legality is retained from a tracked new game. For a seeded mid-game position, castling rights are used only when the user explicitly confirms them. Even then, prior moves and en-passant eligibility remain unknown; the state uses conservative FEN rights and never invents a move history.
- Camera orientation may change without resetting a game because recognition returns rows normalized to standard chess coordinates. A change of camera orientation does not itself count as a move.

## Validation

test/chess-game-state.test.js exercises duplicate scans, orientation changes, legal move recording, side-to-move mismatch, missed plies, seeded positions, castling with explicitly confirmed rights, en passant when its prior move is known, promotion, and recovery from persisted state.

Existing recognition confidence remains a model-estimated heuristic, not a calibrated real-world accuracy guarantee. Automatic detection uses occasional frames only while the camera preview is active; users can pause it with the chess-knight control. The feature does not store the JPEG image; only the recognized board and chess state are saved locally. Local browser storage is not cross-device account synchronization.

## Out of scope / remaining acceptance

- Real-phone acceptance across varied physical boards, lighting, camera rotation, partial occlusion and promotion/castling setups is still required.
- Voice narration of moves, conversational chess intent routing, engine-played moves, and cloud-synced game history are not claimed as part of Phase 3.
