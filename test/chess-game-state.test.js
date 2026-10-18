import { describe, expect, it } from "vitest";
import { Chess } from "../public/chess/chess.js";
import {
  boardRowsForFen,
  createNewChessGame,
  reconcileChessObservation,
  restoreChessGameState,
  seedChessGameFromObservation
} from "../public/chess/game-state-client.js";

function observation(fen, orientation = "white_at_bottom", observedAt = "2026-10-18T12:00:00.000Z") {
  const game = new Chess(fen);
  return { boardRows: boardRowsForFen(game.fen()), sideToMove: game.turn(), orientation, observedAt };
}

function applyMove(fen, san) {
  const game = new Chess(fen);
  const move = game.move(san);
  return { game, move, observation: observation(game.fen()) };
}

describe("AskMoina chess phase 3 game state", () => {
  it("rejects pre-hardening saved state versions", () => {
    const oldState = { ...createNewChessGame({ gameId: "legacy-state-test" }), schemaVersion: 1 };
    expect(restoreChessGameState(oldState)).toMatchObject({ ok: false, reason: "invalid_saved_state" });
  });

  it("creates a complete tracked new game without inventing move history", () => {
    const state = createNewChessGame({ playerColor: "b", gameId: "test-game", now: "2026-10-18T12:00:00.000Z" });
    expect(state.gameMode).toBe("new-game");
    expect(state.playerColor).toBe("b");
    expect(state.moveHistory).toEqual([]);
    expect(state.rightsKnown).toBe(true);
    expect(new Chess(state.currentFen).moves()).toHaveLength(20);
  });

  it("treats repeated scans as idempotent and updates camera orientation safely", () => {
    const state = createNewChessGame({ gameId: "duplicate-test" });
    const scanned = observation(state.currentFen, "white_at_bottom");
    const first = reconcileChessObservation(state, scanned);
    expect(first).toMatchObject({ ok: true, status: "unchanged" });
    const rotated = reconcileChessObservation(first.state, observation(state.currentFen, "black_at_bottom"));
    expect(rotated).toMatchObject({ ok: true, status: "unchanged", orientationChanged: true });
    expect(rotated.state.moveHistory).toHaveLength(0);
  });

  it("records a unique legal move, its SAN and UCI, and no duplicate on the next identical frame", () => {
    const start = createNewChessGame({ gameId: "e4-test" });
    const next = applyMove(start.currentFen, "e4");
    const recorded = reconcileChessObservation(start, next.observation);
    expect(recorded).toMatchObject({ ok: true, status: "move-registered", move: { san: "e4", uci: "e2e4", color: "w" } });
    const duplicate = reconcileChessObservation(recorded.state, next.observation);
    expect(duplicate).toMatchObject({ ok: true, status: "unchanged" });
    expect(duplicate.state.moveHistory).toHaveLength(1);
    expect(restoreChessGameState(duplicate.state).ok).toBe(true);
  });

  it("refuses an observation whose turn does not match the board transition", () => {
    const start = createNewChessGame({ gameId: "turn-test" });
    const mismatch = reconcileChessObservation(start, { ...observation(start.currentFen), sideToMove: "b" });
    expect(mismatch).toMatchObject({ ok: false, reason: "side_to_move_mismatch" });
    expect(start.moveHistory).toHaveLength(0);
  });

  it("does not invent history when multiple moves were missed", () => {
    const start = createNewChessGame({ gameId: "missed-ply-test" });
    const afterE4 = applyMove(start.currentFen, "e4").game;
    const afterC5 = applyMove(afterE4.fen(), "c5");
    const result = reconcileChessObservation(start, afterC5.observation);
    expect(result).toMatchObject({ ok: false, reason: "transition_not_one_legal_move" });
    expect(start.moveHistory).toHaveLength(0);
  });

  it("seeds a mid-game position but marks history rights unknown by default", () => {
    const mid = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b - - 0 1";
    const seed = seedChessGameFromObservation(observation(mid), { gameId: "seed-test" });
    expect(seed.ok).toBe(true);
    expect(seed.state.gameMode).toBe("midgame-seed");
    expect(seed.state.rightsKnown).toBe(false);
    expect(seed.state.historyStatus).toBe("seeded-history-incomplete");
    expect(seed.state.moveHistory).toEqual([]);
  });

  it("tracks castling when those rights were explicitly confirmed at seed time", () => {
    const position = "4k3/8/8/8/8/8/8/4K2R w K - 0 1";
    const seeded = seedChessGameFromObservation(observation(position), {
      gameId: "castle-test",
      rightsKnown: true,
      castlingRights: "K"
    });
    expect(seeded.ok).toBe(true);
    const castle = applyMove(seeded.state.currentFen, "O-O");
    const recorded = reconcileChessObservation(seeded.state, castle.observation);
    expect(recorded).toMatchObject({ ok: true, status: "move-registered", move: { san: "O-O", uci: "e1g1" } });
  });

  it("tracks en passant when the prior double-pawn move is in the recorded game", () => {
    let state = createNewChessGame({ gameId: "en-passant-test" });
    for (const san of ["e4", "a6", "e5", "d5"]) {
      const next = applyMove(state.currentFen, san);
      const registered = reconcileChessObservation(state, next.observation);
      expect(registered.ok).toBe(true);
      state = registered.state;
    }
    const capture = applyMove(state.currentFen, "exd6");
    const registered = reconcileChessObservation(state, capture.observation);
    expect(registered).toMatchObject({ ok: true, status: "move-registered", move: { san: "exd6", flags: expect.stringContaining("e") } });
  });

  it("tracks promotion as a legal move rather than guessing the promoted piece", () => {
    const position = "7k/P7/8/8/8/8/8/7K w - - 0 1";
    const seeded = seedChessGameFromObservation(observation(position), { gameId: "promotion-test" });
    expect(seeded.ok).toBe(true);
    const promoted = applyMove(seeded.state.currentFen, "a8=Q");
    const recorded = reconcileChessObservation(seeded.state, promoted.observation);
    expect(recorded).toMatchObject({ ok: true, status: "move-registered", move: { san: "a8=Q+", uci: "a7a8q", promotion: "q" } });
  });

  it("rejects corrupt or mismatched persisted history", () => {
    const state = createNewChessGame({ gameId: "restore-test" });
    const moved = applyMove(state.currentFen, "e4");
    const recorded = reconcileChessObservation(state, moved.observation);
    expect(restoreChessGameState(recorded.state).ok).toBe(true);
    expect(restoreChessGameState({ ...recorded.state, currentFen: state.currentFen })).toMatchObject({ ok: false, reason: "invalid_saved_state" });
  });
});
