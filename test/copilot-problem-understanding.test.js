import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workerSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");

describe("Milestone 18 problem-understanding instruction contract", () => {
  it("frames the goal, context, known facts, unknowns and consequence before acting", () => {
    expect(workerSource).toContain("PROBLEM UNDERSTANDING — BEFORE CHOOSING AN ACTION:");
    expect(workerSource).toContain("the outcome they want or symptom they report");
    expect(workerSource).toContain("what is directly known versus only suspected");
    expect(workerSource).toContain("the one missing fact that could change the next action");
    expect(workerSource).toContain("the consequence if the guess is wrong");
  });

  it("keeps the assessment internal and avoids overwhelming the user", () => {
    expect(workerSource).toContain("do not show a checklist or long reasoning recap");
    expect(workerSource).toContain("one concise, high-value question—not a series of questions");
  });

  it("does not mistake symptoms or visible objects for a confirmed cause", () => {
    expect(workerSource).toContain("Do not confuse a symptom with its cause");
    expect(workerSource).toContain("Do not assume a visible object is the problem");
  });

  it("allows a safe first check when missing details do not block progress", () => {
    expect(workerSource).toContain("begin with a low-risk observation or check");
    expect(workerSource).toContain("Ask about tools, skill, access, model, or constraints only when");
  });

  it("raises the bar for high-consequence or hard-to-reverse actions", () => {
    expect(workerSource).toContain("Assess the consequence of being wrong before suggesting action");
    expect(workerSource).toContain("pause or recommend qualified help when needed");
  });
});
