import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("shared browser transcript helper", () => {
  const helper = readFileSync(new URL("../public/transcript-merge.js", import.meta.url), "utf8");
  const home = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const copilot = readFileSync(new URL("../public/copilot.html", import.meta.url), "utf8");
  const copilotScript = readFileSync(new URL("../public/copilot.js", import.meta.url), "utf8");

  it("loads the shared transcript helper before the Co-Pilot client; the legacy static home is retired", () => {
    expect(home).toContain('id="toggleVoice"');
    expect(home).toContain('id="stopVoice"');
    expect(home).toContain('Say “Moina”.');
    expect(home).not.toContain('id="mathFundCard"');
    expect(home).not.toContain('id="videoPreview"');
    expect(home).not.toContain('/app.js');
    expect(copilot.indexOf('/transcript-merge.js')).toBeGreaterThanOrEqual(0);
    expect(copilot.indexOf('/transcript-merge.js')).toBeLessThan(copilot.indexOf('/copilot.js'));
    expect(helper).toContain("root.AskMoinaTranscript = Object.freeze({ merge })");
    expect(copilotScript).toContain("window.AskMoinaTranscript && window.AskMoinaTranscript.merge");
  });
});
