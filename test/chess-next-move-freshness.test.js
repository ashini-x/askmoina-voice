import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const chessUi = readFileSync(new URL("../public/chess/chess-ui.js", import.meta.url), "utf8");

describe("AskMoina next-move freshness", () => {
  it("refreshes and confirms the live board before a manual request reuses tracked FEN", () => {
    const suggestStart = chessUi.indexOf("async function suggestMove");
    const refreshIndex = chessUi.indexOf("const refreshed = await refreshTrackedPositionFromCamera()", suggestStart);
    const currentFenIndex = chessUi.indexOf("fen = gameState.currentFen", suggestStart);

    expect(suggestStart).toBeGreaterThanOrEqual(0);
    expect(refreshIndex).toBeGreaterThan(suggestStart);
    expect(currentFenIndex).toBeGreaterThan(refreshIndex);
  });

  it("refreshes live board state when the main chess button is tapped", () => {
    const launchStart = chessUi.indexOf('launch.addEventListener("click"');
    const pauseStart = chessUi.indexOf('pauseButton.addEventListener("click"', launchStart);
    const launchHandler = chessUi.slice(launchStart, pauseStart);

    expect(launchHandler).toContain("refreshTrackedPositionFromCamera()");
    expect(launchHandler).toContain("lastSuggestedFen === gameState.currentFen");
  });

  it("asks for turn confirmation instead of recommending from stale history after an ambiguous transition", () => {
    const helperStart = chessUi.indexOf("function reconcileObservationAgainstTrackedState");
    const helperEnd = chessUi.indexOf("async function refreshTrackedPositionFromCamera", helperStart);
    const helper = chessUi.slice(helperStart, helperEnd);

    expect(helper).toContain('reconciled.reason === "transition_not_one_or_two_legal_moves"');
    expect(chessUi).toContain('mode: "recover"');
    expect(chessUi).toContain('turnSelector.hidden = pendingMode !== "recover"');
  });
});
