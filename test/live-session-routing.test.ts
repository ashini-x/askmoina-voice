import { describe, expect, it } from "vitest";
import { liveSessionObjectName, normalizeLiveSessionId } from "../src/sessions/live-session-routing";

describe("Live session routing", () => {
  it("accepts browser-generated UUIDs and normalizes case", () => {
    expect(normalizeLiveSessionId("7b77f64c-f15e-4cc9-bc02-3b7dbbc2f53f"))
      .toBe("7b77f64c-f15e-4cc9-bc02-3b7dbbc2f53f");
    expect(normalizeLiveSessionId("7B77F64C-F15E-4CC9-BC02-3B7DBBC2F53F"))
      .toBe("7b77f64c-f15e-4cc9-bc02-3b7dbbc2f53f");
  });

  it.each([null, undefined, "", "not-a-uuid", "7b77f64c-f15e-4cc9-3b7dbbc2f53f", "../../other"])(
    "rejects malformed session IDs: %s",
    (value) => expect(normalizeLiveSessionId(value)).toBeNull(),
  );

  it("routes retries for the same owner and session to the same object name", () => {
    const session = "7b77f64c-f15e-4cc9-bc02-3b7dbbc2f53f";
    expect(liveSessionObjectName("user:account-a", session))
      .toBe(liveSessionObjectName("user:account-a", session));
  });

  it("isolates identical browser session IDs across owners", () => {
    const session = "7b77f64c-f15e-4cc9-bc02-3b7dbbc2f53f";
    expect(liveSessionObjectName("user:account-a", session))
      .not.toBe(liveSessionObjectName("user:account-b", session));
  });

  it("rejects empty owners and invalid UUIDs", () => {
    expect(() => liveSessionObjectName(" ", "bad")).toThrow(TypeError);
  });
});
