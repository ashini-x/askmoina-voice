import { describe, expect, it } from "vitest";
import { buildChessVoiceContext } from "../public/chess/voice-context.js";

const START = {
  currentFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  historyStatus: "complete",
  gameMode: "new-game",
  moveHistory: [
    { ply: 1, san: "e4", from: "e2", to: "e4" },
    { ply: 2, san: "e5", from: "e7", to: "e5" }
  ]
};

describe("position-grounded chess voice context", () => {
  it("shares the validated position, side to move, and recent tracked legal moves", () => {
    const result = buildChessVoiceContext(START, { kind: "resume" });
    expect(result).toContain("Current FEN: " + START.currentFen);
    expect(result).toContain("Side to move: White");
    expect(result).toContain("1. e4; 2. e5");
    expect(result).toContain("Move history: locally tracked");
  });

  it("rejects absent, malformed, or geometrically invalid FEN state", () => {
    expect(buildChessVoiceContext(null)).toBeNull();
    expect(buildChessVoiceContext({ ...START, currentFen: "guess the position" })).toBeNull();
    expect(buildChessVoiceContext({ ...START, currentFen: "8/8 w - - 0 1" })).toBeNull();
  });

  it("clearly labels seeded mid-game history as incomplete", () => {
    const result = buildChessVoiceContext({
      ...START, gameMode: "midgame-seed", historyStatus: "incomplete", moveHistory: []
    });
    expect(result).toContain("INCOMPLETE");
    expect(result).toContain("en-passant eligibility");
    expect(result).toContain("do not infer them");
  });

  it("uses only the supplied Stockfish move to explain a suggestion", () => {
    const result = buildChessVoiceContext(START, {
      kind: "analysis", analysis: { bestMove: { san: "Nf3", uci: "g1f3" } }
    });
    expect(result).toContain("Stockfish's returned best move");
    expect(result).toContain("Nf3 (UCI g1f3)");
    expect(result).toContain("Do not invent a principal variation");
    expect(buildChessVoiceContext(START, { kind: "analysis", analysis: { bestMove: null } })).toBeNull();
  });

  it("announces only a supplied legal move", () => {
    const result = buildChessVoiceContext(START, {
      kind: "move", move: { san: "Nf3", from: "g1", to: "f3" }
    });
    expect(result).toContain("Nf3 (g1 to f3)");
    expect(result).toContain("One legal camera-observed move");
    const unsafe = buildChessVoiceContext(START, { kind: "move", move: { san: "White wins by force" } });
    expect(unsafe).toContain("no safe move description");
    expect(unsafe).not.toContain("White wins by force");
  });

  it("bounds its prompt so local state cannot create an oversized text turn", () => {
    const state = { ...START, moveHistory: Array.from({ length: 100 }, (_, i) => ({ ply: i + 1, san: "e4" })) };
    expect(buildChessVoiceContext(state).length).toBeLessThanOrEqual(1450);
  });
});
