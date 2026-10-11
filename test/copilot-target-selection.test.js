import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const worker = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const client = readFileSync(new URL("../public/copilot.js", import.meta.url), "utf8");
const bundledAssets = readFileSync(new URL("../src/copilot-assets.ts", import.meta.url), "utf8");

describe("Milestone 15 spoken-reference target selection", () => {
  it("offers tap-to-disambiguate only when the model needs help resolving a target", () => {
    expect(worker).toContain("TARGET SELECTION — RESOLVE OR ASK:");
    expect(worker).toContain("await_user_selection=true");
    expect(worker).toContain("await_user_selection: { type: \"BOOLEAN\"");
    expect(client).toContain("args.await_user_selection === true");
    expect(client).toContain("Tap the exact ");
    expect(client).toContain("function requestTargetSelection(guidance, message)");
  });

  it("requires a user anchor before placing any new target marker", () => {
    expect(client).toContain("function requestTargetSelection(guidance, message)");
    expect(client).toContain("if (!localTrackingActive || targetChanged)");
    expect(client).toContain("Tap the visible");
    expect(client).toContain("I will not guess its position.");
    expect(worker).toContain("Do not place a new target label over a default center position");
  });

  it("sends normalized point coordinates through an allowlisted Co-Pilot-only message", () => {
    expect(client).toContain("target_selection: selectedPoint");
    expect(worker).toContain('parsed.kind === "target_selection"');
    expect(worker).toContain("xPercent = Math.round(parsed.x * 100)");
    expect(worker).toContain("Treat the tap as user-provided location, not proof of object identity.");
  });

  it("does not claim that a tap proves object identity or permits consequential action", () => {
    expect(worker).toContain("The tap tells you where the user means, not what the object is");
    expect(worker).toContain("Do not direct a consequential or potentially hazardous action merely because the user tapped a point.");
  });

  it("keeps the production-embedded client asset synchronized with the public source", () => {
    expect(bundledAssets).toContain("awaitingTargetSelection");
    expect(bundledAssets).toContain("target_selection: selectedPoint");
    expect(bundledAssets).toContain("Too little detail · tap an edge");
    expect(bundledAssets).toContain("Tap the visible");
  });
});
