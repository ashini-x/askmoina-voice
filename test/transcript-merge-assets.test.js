import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("shared browser transcript helper", () => {
  const helper = readFileSync(new URL("../public/transcript-merge.js", import.meta.url), "utf8");
  const home = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const copilot = readFileSync(new URL("../public/copilot.html", import.meta.url), "utf8");
  const homeScript = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const copilotScript = readFileSync(new URL("../public/copilot.js", import.meta.url), "utf8");

  it("loads before both clients and merges transcript fragments in both views", () => {
    expect(home.indexOf('/transcript-merge.js')).toBeLessThan(home.indexOf('/app.js'));
    expect(copilot.indexOf('/transcript-merge.js')).toBeLessThan(copilot.indexOf('/copilot.js'));
    expect(helper).toContain("root.AskMoinaTranscript = Object.freeze({ merge })");
    expect(homeScript).toContain("window.AskMoinaTranscript && window.AskMoinaTranscript.merge");
    expect(copilotScript).toContain("window.AskMoinaTranscript && window.AskMoinaTranscript.merge");
  });
});
