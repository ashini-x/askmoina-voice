import { describe, expect, it } from "vitest";
import { SYSTEM_INSTRUCTION } from "../src/sessions/assistant-instruction";

describe("AskMoina live voice behavior guidance", () => {
  it("prioritizes spoken Assamese and mirrors natural Assamese-English code-switching", () => {
    expect(SYSTEM_INSTRUCTION).toContain("answer in spoken, everyday Assamese");
    expect(SYSTEM_INSTRUCTION).toContain("answer in the same kind of Assamese-English mix");
    expect(SYSTEM_INSTRUCTION).toContain("Keep natural English phrases in English");
    expect(SYSTEM_INSTRUCTION).toContain("not a schoolteacher, newsreader, audiobook narrator");
    expect(SYSTEM_INSTRUCTION).toContain("Mirror the user's level of code-switching");
  });

  it("includes examples of contemporary casual Assamese-English conversation", () => {
    expect(SYSTEM_INSTRUCTION).toContain("Aji mood tu bhal nai yaar.");
    expect(SYSTEM_INSTRUCTION).toContain("Kalir exam loi bohut tension hoi ase.");
    expect(SYSTEM_INSTRUCTION).toContain("I got the job!");
    expect(SYSTEM_INSTRUCTION).toContain("These examples show rhythm and code-switching only");
  });

  it("encourages spoken turn-taking rather than verbose scripted replies", () => {
    expect(SYSTEM_INSTRUCTION).toContain("Do not turn every answer into a lecture");
    expect(SYSTEM_INSTRUCTION).toContain("leave room for the user");
    expect(SYSTEM_INSTRUCTION).toContain("ask at most one question at a time");
    expect(SYSTEM_INSTRUCTION).toContain("Avoid fake hesitations");
  });

  it("directs the Live audio model to vocalize suitable reactions rather than say stage directions", () => {
    expect(SYSTEM_INSTRUCTION).toContain("generate audio directly, not a prepared text-to-speech transcript");
    expect(SYSTEM_INSTRUCTION).toContain("never say or print those labels");
    expect(SYSTEM_INSTRUCTION).toContain("make the brief vocal reaction itself audible");
    expect(SYSTEM_INSTRUCTION).toContain("prefer an actual small laugh/chuckle");
    expect(SYSTEM_INSTRUCTION).toContain("soft sigh/exhale when empathizing with frustration");
    expect(SYSTEM_INSTRUCTION).toContain("Do not laugh at the user's expense");
    expect(SYSTEM_INSTRUCTION).toContain("If a non-speech sound cannot be produced reliably");
  });

  it("keeps expression contextual rather than using a mechanical checklist", () => {
    expect(SYSTEM_INSTRUCTION).toContain("Use expression selectively, not as a checklist");
    expect(SYSTEM_INSTRUCTION).toContain("Do not insert sighs, gasps, whispers, coughs, or other sounds without a reason");
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

  it("keeps spoken responses concise and asks for clarification when needed", () => {
    expect(SYSTEM_INSTRUCTION).toContain("Ask one brief clarifying question");
    expect(SYSTEM_INSTRUCTION).toContain("Keep spoken responses concise and natural");
  });
});
