# Chess Phase 4 — Voice-native Chess Co-Pilot

## Delivered scope

- Reuses the existing authenticated AskMoina Live Co-Pilot session and its bounded text-input protocol. No second voice provider, new socket, or separate chess chat is added.
- Shares the local tracked FEN, side to move, known recent legal move history, and whether the history is complete with Moina. The current position is treated as application state, not a model guess.
- When a legal single-ply move is reconciled by the camera tracker, sends a short context update so Moina can acknowledge the recorded move and current turn.
- When the user taps Suggest a move, Stockfish remains the source of the returned best move. Moina receives that exact move and can explain it verbally without inventing lines, scores, tactics, or guarantees.
- A restored local game can be supplied at the start of a fresh Live session. A pending suggestion can be carried into the next session for up to 15 minutes; later board changes clear that pending suggestion.
- Keeps the UI camera-first and minimal. The existing chess popup remains the only chess action UI.

## Correctness and privacy boundaries

- The FEN is structurally checked and the move description comes only from the tracked legal move record or Stockfish result.
- Mid-game seeds explicitly mark history incomplete; prior moves, en-passant eligibility, and historical rights are not inferred from a photograph.
- Chess state stays in the current browser's existing local storage. Chess voice-context messages are short and contain board state, not raw images. The camera image is still sent only to the existing chess-recognition endpoint.
- Normal audio streaming, session recovery, and non-chess Live behavior remain unchanged.
- This does not let AskMoina move physical pieces or claim real-world board-recognition accuracy.

## Validation still required

Automated tests cover the bounded context builder and existing game/engine/protocol contracts. Real-device acceptance is still required across physical boards, lighting, angles, and partially obscured positions before claiming recognition reliability.
