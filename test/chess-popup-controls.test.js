import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../public/copilot.html", import.meta.url), "utf8");
const chessUi = readFileSync(new URL("../public/chess/chess-ui.js", import.meta.url), "utf8");
const chessCss = readFileSync(new URL("../public/chess/chess-ui.css", import.meta.url), "utf8");

describe("chess assistant popup and main control", () => {
  it("labels the horse as the next-move entry point instead of a hidden toggle", () => {
    expect(html).toContain('id="chessAssistantButton"');
    expect(html).toContain('class="chess-launch-visible-label">Next move</span>');
    expect(html).toContain('aria-controls="chessDetectionPopup"');
    expect(chessUi).toContain('launch.setAttribute("aria-label", autoEnabled');
    expect(chessUi).not.toContain('launch.addEventListener("click", () => setAutoEnabled(!autoEnabled))');
  });

  it("opens the glass Next strong move panel and starts a scan on every icon tap", () => {
    const start = chessUi.indexOf('launch.addEventListener("click", () => {');
    const end = chessUi.indexOf('pauseButton.addEventListener("click"', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const handler = chessUi.slice(start, end);
    expect(handler).toContain("setAutoEnabled(true)");
    expect(handler).toContain('setStatus("Next strong move"');
    expect(handler).toContain("void detectChessboard(true)");
    expect(chessUi).toContain("function setPopupOpen(open)");
    expect(chessUi).toContain("persistUntilResult = false");
    expect(chessUi).toContain("let manualScanRequested = false");
    expect(chessUi).toContain("if (manual) manualScanRequested = true");
    expect(chessUi).toContain("Scanning the visible camera frame for the 8×8 board");
    expect(chessUi).toContain('popupTitle.textContent = "Next strong move"');
  });

  it("provides a separate, visible pause/resume control and near-side color guidance", () => {
    expect(html).toContain('id="chessPauseDetection"');
    expect(html).toContain("Pause automatic scan");
    expect(html).toContain("Your side is the side nearest the bottom edge");
    expect(chessUi).toContain('pauseButton.textContent = autoEnabled ? "Pause automatic scan" : "Resume automatic scan"');
    expect(chessUi).toContain('pauseButton.addEventListener("click", () => {');
    expect(chessCss).toContain(".chess-popup-footer-actions");
    expect(chessCss).toContain(".chess-popup-pause");
  });

  it("cache-busts the changed chess UI and popup stylesheet", () => {
    expect(html).toContain('/chess/chess-ui.js?v=0.4.144');
    expect(html).toContain('/chess/chess-ui.css?v=0.4.140');
  });
});
