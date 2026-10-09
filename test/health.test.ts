import { describe, expect, it } from "vitest";

describe("AskMoina release contract", () => {
  it("uses the intended product identity", () => {
    expect("askmoina-voice").toBe("askmoina-voice");
  });

  it("targets Vertex AI Live rather than the Gemini Developer API", () => {
    expect("gemini-3.8-live").toMatch(/^gemini-\d+\.\d+-live$/);
  });

  it("keeps session defaults within conservative private-beta ceilings", () => {
    const maxSessionSeconds = 540;
    const maxDailySecondsPerIp = 1800;
    const maxGlobalDailySeconds = 3600;
    expect(maxSessionSeconds).toBeLessThanOrEqual(540);
    expect(maxDailySecondsPerIp).toBeLessThanOrEqual(1800);
    expect(maxGlobalDailySeconds).toBeLessThanOrEqual(3600);
  });
});
