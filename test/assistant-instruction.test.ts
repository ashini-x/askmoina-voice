import { describe, expect, it } from "vitest";
import { SYSTEM_INSTRUCTION } from "../src/sessions/assistant-instruction";

describe("AskMoina voice behavior guidance", () => {
  it("prioritizes conversational Assamese and natural code-switching", () => {
    expect(SYSTEM_INSTRUCTION).toContain("respond in natural, conversational Assamese");
    expect(SYSTEM_INSTRUCTION).toContain("do not default to English");
    expect(SYSTEM_INSTRUCTION).toContain("code-switch naturally");
  });

  it("avoids fabricated dialect and local facts", () => {
    expect(SYSTEM_INSTRUCTION).toContain("Do not fake an Upper Assam dialect");
    expect(SYSTEM_INSTRUCTION).toContain("Never invent local facts");
    expect(SYSTEM_INSTRUCTION).toContain("relevant official source");
  });

  it("sets clear boundaries for memory and identity", () => {
    expect(SYSTEM_INSTRUCTION).toContain("without pretending to be human");
    expect(SYSTEM_INSTRUCTION).toContain("user-selected memory context");
    expect(SYSTEM_INSTRUCTION).toContain("Do not claim to remember something");
  });

  it("keeps the voice response concise and asks for clarification when needed", () => {
    expect(SYSTEM_INSTRUCTION).toContain("Ask one brief clarifying question");
    expect(SYSTEM_INSTRUCTION).toContain("Keep spoken responses concise and natural");
  });
});
