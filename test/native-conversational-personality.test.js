import { describe, expect, it } from "vitest";
import { NATIVE_CONVERSATIONAL_PERSONALITY_INSTRUCTION } from "../src/sessions/native-conversational-personality";
import { SYSTEM_INSTRUCTION } from "../src/sessions/assistant-instruction";
import { createRunTemplate, loadSuite, scoreRun, validateRepositorySuites } from "../scripts/reality-benchmark.mjs";

describe("M3 native conversational personality", () => {
  it("integrates a dedicated personality contract into the live system instruction", () => {
    expect(SYSTEM_INSTRUCTION).toContain("M3 — NATIVE CONVERSATIONAL PERSONALITY CONTRACT");
    expect(SYSTEM_INSTRUCTION).toContain("respond to the user's actual social intent");
    expect(SYSTEM_INSTRUCTION).toContain("Do not end every answer with a question");
    expect(SYSTEM_INSTRUCTION).toContain("Avoid canned empathy");
  });

  it("calibrates celebration, distress, casual banter, and direct task answers differently", () => {
    const instruction = NATIVE_CONVERSATIONAL_PERSONALITY_INSTRUCTION.join("\n");
    expect(instruction).toContain("celebrate good news");
    expect(instruction).toContain("serious distress");
    expect(instruction).toContain("play along lightly with harmless humor");
    expect(instruction).toContain("answer directly with minimal preamble");
  });

  it("preserves language, register, boundaries, and correction follow-through", () => {
    const instruction = NATIVE_CONVERSATIONAL_PERSONALITY_INSTRUCTION.join("\n");
    expect(instruction).toContain("formal written Assamese");
    expect(instruction).toContain("inventing intimacy");
    expect(instruction).toContain("Do not argue defensively");
    expect(instruction).toContain("Do not bluff comprehension");
    expect(instruction).toContain("universal Upper Assam language rules");
  });

  it("ships a 12-case held-out, score-only listening suite", () => {
    const suite = loadSuite("personality");
    expect(suite.cases).toHaveLength(12);
    expect(suite.pass_thresholds.max_critical_failures).toBe(0);
    expect(suite.recording_policy).toContain("without saving recordings");
    expect(suite.cases.some(c => c.domain === "vent-without-unsolicited-fix")).toBe(true);
    expect(suite.cases.some(c => c.domain === "interruption-and-language-switch")).toBe(true);
  });

  it("creates a score-only template and gates on critical failures", () => {
    const suite = loadSuite("personality");
    const run = createRunTemplate(suite, { evaluator_code: "LISTENER-A" });
    expect(JSON.stringify(run).toLowerCase()).not.toContain("transcript");
    expect(JSON.stringify(run).toLowerCase()).not.toContain("recording");
    for (const row of run.results) for (const dimension of suite.dimensions) row.ratings[dimension.id] = 2;
    expect(scoreRun(suite, run).passed).toBe(true);
    run.results[0].critical_failures.push("Forced playful reaction during serious distress");
    expect(scoreRun(suite, run).passed).toBe(false);
  });

  it("keeps prompt tests separate from real native-listener acceptance", () => {
    const validation = validateRepositorySuites();
    expect(validation.ok, validation.errors.join("\n")).toBe(true);
    expect(NATIVE_CONVERSATIONAL_PERSONALITY_INSTRUCTION.length).toBeGreaterThanOrEqual(10);
  });
});
