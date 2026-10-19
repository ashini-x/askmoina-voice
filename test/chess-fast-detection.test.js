import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const chessUi = readFileSync(new URL("../public/chess/chess-ui.js", import.meta.url), "utf8");

describe("fast chess camera recognition", () => {
  it("uses local validation after a successful vision read instead of a second vision request", () => {
    const start = chessUi.indexOf("function validateRecognitionCandidate(recognition)");
    const end = chessUi.indexOf("function startBackgroundConfirmation", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const validation = chessUi.slice(start, end);

    expect(validation).toContain("validateBoardRows(recognition.boardRows)");
    expect(validation).not.toContain("recognizeOneFrame(");
    expect(validation).not.toContain("recognizeChessboardFrame(");
    expect(chessUi).not.toContain("retryStableChessboardRecognition(");
  });

  it("retries with one fresh frame only when an explicit scan's first recognition fails", () => {
    const start = chessUi.indexOf("async function recognizeOneFrame(options = {})");
    const end = chessUi.indexOf("function validateRecognitionCandidate", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const scanner = chessUi.slice(start, end);

    expect(scanner).toContain("if (result.ok || options.retryOnFailure !== true) return result;");
    expect(scanner).toContain("result = await readOnce();");
    expect(scanner).toContain("after two quick attempts");
    expect(chessUi).toContain("recognizeOneFrame({ retryOnFailure: manual })");
  });

  it("does not keep rescanning a known board while the first move prompt is awaiting a tap", () => {
    expect(chessUi).toContain("if (!manual && !gameState && pendingRecognition && !popup.hidden)");
  });

  it("keeps geometry and chess piece checks in the fast path", () => {
    const start = chessUi.indexOf("function validateRecognitionCandidate(recognition)");
    const end = chessUi.indexOf("function startBackgroundConfirmation", start);
    const validation = chessUi.slice(start, end);
    expect(validation).toContain("boardCornersNormalized.length !== 4");
    expect(validation).toContain('["white_at_bottom", "black_at_bottom"]');
    expect(validation).toContain("validateBoardRows(recognition.boardRows)");
  });
});
