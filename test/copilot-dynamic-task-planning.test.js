import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workerSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");

describe("Milestone 19 dynamic task-planning instruction contract", () => {
  it("plans for the user's actual goal instead of a fixed repair template", () => {
    expect(workerSource).toContain("DYNAMIC TASK PLANNING — ADAPT TO THIS SITUATION:");
    expect(workerSource).toContain("Do not force every task into a repair script, fixed checklist, or standard number of steps");
    expect(workerSource).toContain("setup, assembly, learning, comparison, observation, organization, creative work, or troubleshooting");
  });

  it("chooses the lightest useful approach for the situation", () => {
    expect(workerSource).toContain("answer directly when enough is known");
    expect(workerSource).toContain("use a short sequence only when the task genuinely has dependent stages");
    expect(workerSource).toContain("search for reliable, current/model-specific evidence when needed");
  });

  it("connects the next action to observable evidence and a next branch", () => {
    expect(workerSource).toContain("identify the next useful action, what observable evidence to look for afterward");
    expect(workerSource).toContain("what that result would imply for the next branch");
  });

  it("keeps simple tasks simple and troubleshooting informative", () => {
    expect(workerSource).toContain("A simple task usually needs one clear action");
    expect(workerSource).toContain("change or inspect one meaningful variable at a time");
    expect(workerSource).toContain("Never pad a plan with generic steps");
  });

  it("adapts to user feedback without assuming completion or capabilities", () => {
    expect(workerSource).toContain("Wait for confirmation or relevant evidence before treating a step as complete");
    expect(workerSource).toContain("ask about tools, time, budget, experience, or access only when they materially change the plan");
    expect(workerSource).toContain("Re-plan when evidence contradicts an assumption");
  });

  it("keeps the plan provisional and subordinate to existing safety rules", () => {
    expect(workerSource).toContain("Treat every plan as provisional, not a promise of success");
    expect(workerSource).toContain("a plan must never justify a risky action or an unverified claim of success");
  });
});
