import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workerSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");

describe("Milestone 20 adaptive step-by-step guidance instruction contract", () => {
  it("gives one manageable next action rather than dumping every future step", () => {
    expect(workerSource).toContain("ADAPTIVE STEP-BY-STEP GUIDANCE — ONE USEFUL MOVE AT A TIME:");
    expect(workerSource).toContain("one concrete, manageable next action per turn");
    expect(workerSource).toContain("Do not read out every future step before the user is ready");
  });

  it("waits for confirmation or current evidence before progressing", () => {
    expect(workerSource).toContain("pause for the user's response, confirmation, or relevant new camera evidence");
    expect(workerSource).toContain("Never treat silence, elapsed time, a button tap alone");
    expect(workerSource).toContain("Advance the task state only when the user confirms the action or relevant evidence supports the outcome");
  });

  it("explains what to observe without overclaiming visual verification", () => {
    expect(workerSource).toContain("tell the user what they should notice or report after the action");
    expect(workerSource).toContain("only claim a visible change when the frames support it");
    expect(workerSource).toContain("confirm results the camera cannot establish");
  });

  it("recovers intelligently when a step fails instead of repeating or advancing blindly", () => {
    expect(workerSource).toContain("do not simply repeat the same instruction or advance to the next planned step");
    expect(workerSource).toContain("select one safe diagnostic check or a simpler alternative");
    expect(workerSource).toContain("Change one meaningful variable at a time when troubleshooting");
  });

  it("simplifies when the user is confused or lacks a needed tool or target clarity", () => {
    expect(workerSource).toContain("If the user is confused, moves the camera away, cannot locate the target");
    expect(workerSource).toContain("simplify the instruction or ask one focused question");
    expect(workerSource).toContain("request a user tap when the exact target cannot be identified confidently");
  });

  it("preserves continuity but adapts after new evidence or a changed goal", () => {
    expect(workerSource).toContain("Keep the last confirmed step and current goal in context");
    expect(workerSource).toContain("correct the sequence when an earlier assumption proves wrong");
    expect(workerSource).toContain("do not let a prewritten sequence prevent adaptation after every result");
  });

  it("keeps walkthroughs concise and maintains safety boundaries", () => {
    expect(workerSource).toContain("at most a compact overview first");
    expect(workerSource).toContain("Stop or recommend qualified help when the safe path is uncertain");
  });
});
