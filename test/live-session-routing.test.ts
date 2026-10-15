import { describe, expect, it } from "vitest";
import { liveSessionObjectName, normalizeLiveSessionId, shouldDetachLiveSessionOnClientClose, LIVE_CLIENT_RECONNECT_CLOSE_CODE, LIVE_CLIENT_REPLACEMENT_CLOSE_CODE } from "../src/sessions/live-session-routing";

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

  it("keeps the upstream session alive for deliberate retry hand-offs", () => {
    expect(shouldDetachLiveSessionOnClientClose(LIVE_CLIENT_RECONNECT_CLOSE_CODE, "Reconnect handoff")).toBe(true);
    expect(shouldDetachLiveSessionOnClientClose(1006, "")).toBe(true);
  });

  it("ends sessions for explicit user stop and does not treat other clean closes as retries", () => {
    expect(shouldDetachLiveSessionOnClientClose(1000, "Client disconnected")).toBe(false);
    expect(shouldDetachLiveSessionOnClientClose(1001, "going away")).toBe(false);
  });

  it("rejects empty owners and invalid UUIDs", () => {
    expect(() => liveSessionObjectName(" ", "bad")).toThrow(TypeError);
  });
});


describe("Live session replacement vs handoff close codes", () => {
  it("preserves the provider only for explicit handoff, not a network-loss replacement", () => {
    expect(LIVE_CLIENT_REPLACEMENT_CLOSE_CODE).toBe(4002);
    expect(shouldDetachLiveSessionOnClientClose(LIVE_CLIENT_REPLACEMENT_CLOSE_CODE, "Fresh session required after network loss")).toBe(false);
    expect(shouldDetachLiveSessionOnClientClose(LIVE_CLIENT_RECONNECT_CLOSE_CODE, "Reconnect handoff")).toBe(true);
  });
});
