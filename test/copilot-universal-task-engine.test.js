import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workerSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");

describe("Milestone 33 universal task engine instruction contract", () => {
  it("treats a broad range of goals as first-class instead of repair-only", () => {
    expect(workerSource).toContain("M33 — UNIVERSAL TASK ENGINE:");
    expect(workerSource).toContain("organization, comparison, setup/configuration, assembly, repair, troubleshooting, learning, inspection, planning, and creative work");
    expect(workerSource).toContain("These examples are not a closed list");
  });

  it("uses task categories internally without forcing users to select a mode", () => {
    expect(workerSource).toContain("A category is an internal planning aid, never a user-facing mode or prerequisite.");
    expect(workerSource).toContain("Do not ask the user to choose a task type when their goal is already understandable.");
  });

  it("preserves one evidence-led loop while allowing explanation-only and unseen tasks", () => {
    expect(workerSource).toContain("observe → understand → act or explain → check → adapt");
    expect(workerSource).toContain("Transfer the approach to unseen objects and tasks");
    expect(workerSource).toContain("A text-heavy, abstract, conversational, or planning request may need a direct spoken answer rather than a drawing.");
  });

  it("does not pretend to perform physical or external actions", () => {
    expect(workerSource).toContain("Do not claim to move objects, change device settings, operate equipment, or perform external actions");
  });
});
