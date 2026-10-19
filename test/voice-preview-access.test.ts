import { describe, expect, it } from "vitest";
import { canAccessVoicePreview } from "../src/sessions/voice-preview-access";

describe("native voice audition access", () => {
  it("keeps previews admin-only when the temporary feature flag is off", () => {
    expect(canAccessVoicePreview(false, true, false)).toBe(false);
    expect(canAccessVoicePreview(false, false, false)).toBe(false);
  });

  it("allows an authenticated user only while the audition flag is enabled", () => {
    expect(canAccessVoicePreview(false, true, true)).toBe(true);
    expect(canAccessVoicePreview(false, false, true)).toBe(false);
  });

  it("always preserves admin preview access, independent of the temporary flag", () => {
    expect(canAccessVoicePreview(true, false, false)).toBe(true);
    expect(canAccessVoicePreview(true, true, false)).toBe(true);
  });
});
