import { describe, expect, it } from "vitest";
import { buildPersonalizedSystemInstruction } from "../src/sessions/memory-context";

describe("selected memory context", () => {
  it("gives Gemini an explicit, readable prompt for user-selected facts", () => {
    const prompt = buildPersonalizedSystemInstruction(
      "You are AskMoina.",
      "my name is Raaz, so call me Raaz when you interact with me",
    );
    expect(prompt).toContain("my name is Raaz");
    expect(prompt).toContain("If a preferred name is present, use it naturally.");
    expect(prompt).toContain("Do not claim these selected notes are unavailable");
    expect(prompt).toContain("BEGIN USER-SAVED MEMORIES");
    expect(prompt).toContain("END USER-SAVED MEMORIES");
    expect(prompt).toContain("\n\nPERSONAL CONTEXT");
    expect(prompt).not.toContain("\\n\\nPERSONAL CONTEXT");
  });

  it("leaves the base instruction unchanged when memory is absent", () => {
    expect(buildPersonalizedSystemInstruction("base", "")).toBe("base");
    expect(buildPersonalizedSystemInstruction("base", null)).toBe("base");
  });

  it("bounds context and strips unsafe control characters", () => {
    const prompt = buildPersonalizedSystemInstruction("base", "Raaz\u0000" + "x".repeat(4000));
    expect(prompt).not.toContain("\u0000");
    expect(prompt).toContain("x".repeat(100));
    expect(prompt.length).toBeLessThan(3600);
  });
});
