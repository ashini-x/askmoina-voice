import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../public/transcript-merge.js", import.meta.url), "utf8");
const sandbox = {};
runInNewContext(source, sandbox);
const merge = sandbox.AskMoinaTranscript.merge;

describe("live transcript fragment merging", () => {
  it("handles empty text and ignores repeated events", () => {
    expect(merge("", "Hello there")).toBe("Hello there");
    expect(merge("Hello there", "Hello there")).toBe("Hello there");
  });

  it("prefers a longer cumulative partial without duplicating its prefix", () => {
    expect(merge("I need help", "I need help with my laptop")).toBe("I need help with my laptop");
    expect(merge("I need help with my laptop", "I need help")).toBe("I need help with my laptop");
  });

  it("joins adjacent fragments using the shared trailing and leading words", () => {
    expect(merge("I need help with", "with my laptop")).toBe("I need help with my laptop");
    expect(merge("Can you explain", "explain this again?")).toBe("Can you explain this again?");
  });

  it("preserves punctuation updates and supports Assamese-script fragments", () => {
    expect(merge("That is helpful", "That is helpful!")).toBe("That is helpful!");
    expect(merge("মই সহায়", "সহায় লাগে")).toBe("মই সহায় লাগে");
  });

  it("appends separate fragments when they have no overlap", () => {
    expect(merge("My laptop will not start", "What should I check first?"))
      .toBe("My laptop will not start What should I check first?");
  });
});
