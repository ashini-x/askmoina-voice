import { describe, expect, it } from "vitest";
import {
  decideClientReattachment,
  isRecoverableLiveDisconnectCode,
  shouldAcceptBrowserReattachment,
} from "../src/sessions/recovery-policy";

const healthy = {
  relayClosed: false,
  clientSetupReceived: true,
  providerSetupReady: true,
  providerSocketOpen: true,
  resumptionInProgress: false,
  replayInProgress: false,
  resumeHandleAvailable: true,
  securedSetupAvailable: true,
};

describe("deterministic Live reattachment", () => {
  it("confirms only after client setup, provider setup, and replay are complete", () => {
    expect(decideClientReattachment(healthy)).toBe("confirm_resumed");
    expect(decideClientReattachment({ ...healthy, clientSetupReceived: false })).toBe("wait");
    expect(decideClientReattachment({ ...healthy, replayInProgress: true })).toBe("wait");
    expect(decideClientReattachment({ ...healthy, resumptionInProgress: true })).toBe("wait");
  });

  it("resumes only when a closed upstream has a paired handle and secured setup", () => {
    expect(decideClientReattachment({ ...healthy, providerSetupReady: false, providerSocketOpen: false })).toBe("resume_provider");
  });

  it("selects replacement when the upstream is closed and its handle is absent/expired", () => {
    expect(decideClientReattachment({ ...healthy, providerSetupReady: false, providerSocketOpen: false, resumeHandleAvailable: false })).toBe("replace_session");
    expect(decideClientReattachment({ ...healthy, providerSetupReady: false, providerSocketOpen: false, securedSetupAvailable: false })).toBe("replace_session");
  });

  it("waits for delayed setup on an open provider rather than creating a duplicate", () => {
    expect(decideClientReattachment({ ...healthy, providerSetupReady: false, providerSocketOpen: true })).toBe("wait");
  });

  it("does not announce resume for a detached relay", () => {
    expect(decideClientReattachment({ ...healthy, relayClosed: true })).toBe("wait");
  });

  it("permits only one client attachment while setup is pending", () => {
    expect(shouldAcceptBrowserReattachment(false, false)).toBe(true);
    expect(shouldAcceptBrowserReattachment(false, true)).toBe(false);
    expect(shouldAcceptBrowserReattachment(true, false)).toBe(false);
  });
});

describe("bounded replacement recovery", () => {
  it.each([
    "provider_disconnected",
    "provider_error",
    "client_connection_error",
    "session_recovery_failed",
    "resume_handle_unavailable",
    "input_replay_window_lost",
  ])("marks %s as eligible for one fresh session", (code) => {
    expect(isRecoverableLiveDisconnectCode(code)).toBe(true);
  });

  it.each(["session_timeout", "audio_rate_limit", "invalid_protocol", "", null, 1011])(
    "does not silently retry fatal or malformed code %s",
    (code) => expect(isRecoverableLiveDisconnectCode(code)).toBe(false),
  );
});
