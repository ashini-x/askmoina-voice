import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workerSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");

describe("Milestone 21 observe, verify, recover instruction contract", () => {
  it("establishes a starting state and a testable expected result before acting", () => {
    expect(workerSource).toContain("OBSERVE, VERIFY, RECOVER — EVIDENCE CHECKPOINTS:");
    expect(workerSource).toContain("establish the relevant starting state");
    expect(workerSource).toContain("one observable expected result");
  });

  it("distinguishes camera-supported changes from user-reported outcomes", () => {
    expect(workerSource).toContain("camera-supported change, the user's explicit report");
    expect(workerSource).toContain("Never describe a user-reported outcome as independently verified by the camera");
  });

  it("does not overclaim a before-and-after comparison when the view is unreliable", () => {
    expect(workerSource).toContain("only when they show the same target and relevant view with enough clarity");
    expect(workerSource).toContain("changed screen framing alone does not prove a physical change");
  });

  it("branches on absent, ambiguous, or contradictory evidence instead of assuming success", () => {
    expect(workerSource).toContain("If the expected result is absent, ambiguous, or contradictory");
    expect(workerSource).toContain("Never silently treat an unknown result as success");
    expect(workerSource).toContain("choose one safe diagnostic check that distinguishes plausible explanations");
  });

  it("preserves failed checks and avoids repeating them without new evidence", () => {
    expect(workerSource).toContain("preserve that result in the working conversation context");
    expect(workerSource).toContain("Do not repeat the same check unchanged unless new evidence or a changed condition makes it reasonable");
  });

  it("distinguishes visual verification from user-confirmed completion", () => {
    expect(workerSource).toContain("A visible symptom improving does not by itself prove the root cause is fixed");
    expect(workerSource).toContain("distinguish user-confirmed completion from visual verification");
    expect(workerSource).toContain("For consequential actions, require stronger evidence");
  });
});
