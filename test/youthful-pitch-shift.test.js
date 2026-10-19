import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const worklet = readFileSync(new URL("../public/pitch-shift-worklet.js", import.meta.url), "utf8");
const client = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

function makeProcessor(semitones = 6) {
  let RegisteredProcessor = null;
  class AudioWorkletProcessorMock {
    constructor() {
      this.port = { onmessage: null };
    }
  }
  runInNewContext(worklet, {
    AudioWorkletProcessor: AudioWorkletProcessorMock,
    sampleRate: 48000,
    registerProcessor(name, processorClass) {
      if (name === "askmoina-youthful-pitch-shifter") RegisteredProcessor = processorClass;
    }
  });
  if (!RegisteredProcessor) throw new Error("Pitch-shifter worklet did not register.");
  return new RegisteredProcessor({ processorOptions: { pitchSemitones: semitones } });
}

describe("AskMoina high-register playback", () => {
  it("registers a six-semitone processor and shifts a 440 Hz test tone upward", () => {
    const processor = makeProcessor(6);
    const sampleRate = 48000;
    const blockSize = 128;
    const collected = [];
    let sampleIndex = 0;

    for (let block = 0; block < 900; block += 1) {
      const input = new Float32Array(blockSize);
      const output = new Float32Array(blockSize);
      for (let i = 0; i < blockSize; i += 1) {
        input[i] = 0.4 * Math.sin(2 * Math.PI * 440 * sampleIndex / sampleRate);
        sampleIndex += 1;
      }
      processor.process([[input]], [[output]]);
      if (block >= 550) collected.push(...output);
    }

    let positiveCrossings = 0;
    for (let i = 1; i < collected.length; i += 1) {
      if (collected[i - 1] <= 0 && collected[i] > 0) positiveCrossings += 1;
    }
    const measuredHz = positiveCrossings / (collected.length / sampleRate);
    expect(measuredHz).toBeGreaterThan(560);
    expect(measuredHz).toBeLessThan(690);
  });

  it("clears buffered assistant audio when playback is interrupted", () => {
    const processor = makeProcessor(6);
    const input = new Float32Array(128).fill(0.5);
    const output = new Float32Array(128);
    processor.process([[input]], [[output]]);
    processor.port.onmessage({ data: { type: "reset" } });
    expect(processor.writeIndex).toBe(0);
    expect(processor.phase).toBe(0);
    expect(processor.ring.every((sample) => sample === 0)).toBe(true);
  });

  it("applies the pitch shift only to outgoing audio and retains a no-worklet fallback", () => {
    expect(client).toContain('audioContext.audioWorklet.addModule("/pitch-shift-worklet.js")');
    expect(client).toContain('processorOptions: { pitchSemitones: 6 }');
    expect(client).toContain("source.connect(pitchShifterNode || audioContext.destination)");
    expect(client).toContain("if (pitchShifterNode) {");
  });
});
