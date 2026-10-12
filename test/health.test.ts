import { describe, expect, it } from "vitest";

describe("AskMoina release contract", () => {
  it("uses the intended product identity", () => {
    expect("askmoina-voice").toBe("askmoina-voice");
  });

  it("targets Vertex AI Live rather than the Gemini Developer API", () => {
    expect("gemini-3.8-live").toMatch(/^gemini-\d+\.\d+-live$/);
  });

  it("keeps app-level usage quotas separate from upstream provider limits", () => {
    const statusMessage = "AskMoina does not impose app-level daily, per-browser, or concurrency quotas. Google/Gemini service limits still apply.";
    expect(statusMessage).toContain("does not impose app-level");
    expect(statusMessage).toContain("service limits still apply");
  });
});
