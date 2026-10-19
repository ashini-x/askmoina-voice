import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const client = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const copilot = readFileSync(new URL("../public/copilot.js", import.meta.url), "utf8");
const instruction = readFileSync(new URL("../src/sessions/assistant-instruction.ts", import.meta.url), "utf8");

describe("natural sweet live voice", () => {
  it("preserves native provider audio in the voice lab without pitch post-processing", () => {
    expect(client).toContain("source.connect(audioContext.destination)");
    expect(client).not.toContain("pitchShifterNode");
    expect(client).not.toContain("pitch-shift-worklet");
  });

  it("preserves native provider audio on the camera-first Copilot screen", () => {
    expect(copilot).toContain("source.connect(getPlaybackAnalyser())");
    expect(copilot).not.toContain("pitchShifterNode");
    expect(copilot).not.toContain("pitch-shift-worklet");
  });

  it("asks for naturally sweet, youthful warmth instead of forced pitch or robotic timbre", () => {
    expect(instruction).toContain("naturally sweet, softly bright, light, clear, and very youthful");
    expect(instruction).toContain("childlike lightness roughly around age 10 as a vocal impression");
    expect(instruction).toContain("Prioritize the native voice's natural texture");
    expect(instruction).toContain("metallic/robotic timbre");
  });
});
