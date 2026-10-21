import { describe, expect, it } from "vitest";
import {
  getWakeAudioGates,
  initialWakeLifecycleState,
  transitionWakeLifecycle,
  type WakeLifecycleEvent,
  type WakeLifecycleState,
} from "./social-wakeup";

const standby = (overrides: Partial<WakeLifecycleState> = {}): WakeLifecycleState =>
  ({
    ...initialWakeLifecycleState,
    mode: "STANDBY_LOCAL_WAKE",
    standbyEnabled: true,
    microphonePermissionGranted: true,
    localDetectorReady: true,
    participantNoticeConfirmed: true,
    sessionConnected: true,
    ...overrides,
  });

type EnableStandbyEvent = Extract<WakeLifecycleEvent, { type: "ENABLE_STANDBY" }>;

const enableStandby = (warmSessionConnected = true): EnableStandbyEvent => ({
  type: "ENABLE_STANDBY",
  microphonePermissionGranted: true,
  localDetectorReady: true,
  participantNoticeConfirmed: true,
  warmSessionConnected,
});

describe("AskMoina local wake / warm-session lifecycle", () => {
  it("starts fully disarmed with every microphone/output gate closed", () => {
    expect(getWakeAudioGates(initialWakeLifecycleState)).toEqual({
      captureMicrophoneLocally: false,
      localWakeDetectorEnabled: false,
      sendMicrophoneToGemini: false,
      allowAssistantOutput: false,
      mayKeepWarmSession: false,
    });
  });

  it("fails closed when microphone permission, local detector, or participant notice is missing", () => {
    const noPermission = transitionWakeLifecycle(initialWakeLifecycleState, {
      ...enableStandby(),
      microphonePermissionGranted: false,
    });
    expect(noPermission.mode).toBe("DISARMED");
    expect(noPermission.error).toBe("microphone_permission_required");

    const noDetector = transitionWakeLifecycle(initialWakeLifecycleState, {
      ...enableStandby(),
      localDetectorReady: false,
    });
    expect(noDetector.mode).toBe("DISARMED");
    expect(noDetector.error).toBe("local_wake_detector_unavailable");

    const noNotice = transitionWakeLifecycle(initialWakeLifecycleState, {
      ...enableStandby(),
      participantNoticeConfirmed: false,
    });
    expect(noNotice.mode).toBe("DISARMED");
    expect(noNotice.error).toBe("participant_notice_required");
  });

  it("keeps wake detection local and blocks upstream audio while in standby", () => {
    const state = transitionWakeLifecycle(initialWakeLifecycleState, enableStandby(true));
    expect(state.mode).toBe("STANDBY_LOCAL_WAKE");
    expect(getWakeAudioGates(state)).toEqual({
      captureMicrophoneLocally: true,
      localWakeDetectorEnabled: true,
      sendMicrophoneToGemini: false,
      allowAssistantOutput: false,
      mayKeepWarmSession: true,
    });
  });

  it("gates upstream audio and output until wake activation is confirmed", () => {
    const activating = transitionWakeLifecycle(standby(), { type: "WAKE_DETECTED" });
    expect(activating.mode).toBe("ACTIVATING");
    expect(getWakeAudioGates(activating)).toMatchObject({
      captureMicrophoneLocally: true,
      localWakeDetectorEnabled: false,
      sendMicrophoneToGemini: false,
      allowAssistantOutput: false,
    });

    const active = transitionWakeLifecycle(activating, {
      type: "SESSION_READY",
      privateOutputReady: true,
    });
    expect(active.mode).toBe("ACTIVE_LISTENING");
    expect(getWakeAudioGates(active)).toMatchObject({
      sendMicrophoneToGemini: true,
      allowAssistantOutput: true,
    });
  });

  it("reconnects before opening the upstream audio gate when wake occurs without a warm socket", () => {
    const coldStandby = standby({ sessionConnected: false });
    const recovering = transitionWakeLifecycle(coldStandby, { type: "WAKE_DETECTED" });
    expect(recovering.mode).toBe("RECOVERING");
    expect(getWakeAudioGates(recovering).sendMicrophoneToGemini).toBe(false);

    const active = transitionWakeLifecycle(recovering, {
      type: "SESSION_READY",
      privateOutputReady: true,
    });
    expect(active.mode).toBe("ACTIVE_LISTENING");
    expect(getWakeAudioGates(active).sendMicrophoneToGemini).toBe(true);
  });

  it("returns to local standby after session loss and never sends while recovering", () => {
    const active = transitionWakeLifecycle(
      transitionWakeLifecycle(standby(), { type: "WAKE_DETECTED" }),
      { type: "SESSION_READY", privateOutputReady: true },
    );
    const recovering = transitionWakeLifecycle(active, { type: "SESSION_LOST" });
    expect(recovering.mode).toBe("RECOVERING");
    expect(getWakeAudioGates(recovering).sendMicrophoneToGemini).toBe(false);
    expect(getWakeAudioGates(recovering).allowAssistantOutput).toBe(false);

    const resumed = transitionWakeLifecycle(recovering, {
      type: "SESSION_READY",
      privateOutputReady: true,
    });
    expect(resumed.mode).toBe("ACTIVE_LISTENING");
  });

  it("refuses to unmute when a private audio route is unavailable", () => {
    const activating = transitionWakeLifecycle(standby(), { type: "WAKE_DETECTED" });
    const failed = transitionWakeLifecycle(activating, {
      type: "SESSION_READY",
      privateOutputReady: false,
    });
    expect(failed.mode).toBe("STANDBY_LOCAL_WAKE");
    expect(failed.error).toBe("private_audio_route_unavailable");
    expect(getWakeAudioGates(failed).sendMicrophoneToGemini).toBe(false);
    expect(getWakeAudioGates(failed).allowAssistantOutput).toBe(false);
  });

  it("cancels active conversation to standby without disabling the local wake detector", () => {
    const active = transitionWakeLifecycle(
      transitionWakeLifecycle(standby(), { type: "WAKE_DETECTED" }),
      { type: "SESSION_READY", privateOutputReady: true },
    );
    const next = transitionWakeLifecycle(active, { type: "END_CONVERSATION" });
    expect(next.mode).toBe("STANDBY_LOCAL_WAKE");
    expect(next.activeSessionRequested).toBe(false);
    expect(getWakeAudioGates(next).localWakeDetectorEnabled).toBe(true);
    expect(getWakeAudioGates(next).sendMicrophoneToGemini).toBe(false);
  });

  it("disables all capture and playback when standby is disabled", () => {
    const enabled = transitionWakeLifecycle(initialWakeLifecycleState, enableStandby());
    const disabled = transitionWakeLifecycle(enabled, { type: "DISABLE_STANDBY" });
    expect(disabled.mode).toBe("DISARMED");
    expect(getWakeAudioGates(disabled)).toEqual({
      captureMicrophoneLocally: false,
      localWakeDetectorEnabled: false,
      sendMicrophoneToGemini: false,
      allowAssistantOutput: false,
      mayKeepWarmSession: false,
    });
  });

  it("ignores wake events from the wrong state", () => {
    expect(transitionWakeLifecycle(initialWakeLifecycleState, { type: "WAKE_DETECTED" }))
      .toEqual(initialWakeLifecycleState);
    expect(transitionWakeLifecycle(standby(), { type: "WAKE_DETECTED" }).mode)
      .toBe("ACTIVATING");
  });

  it("fails closed after activation errors", () => {
    const activating = transitionWakeLifecycle(standby(), { type: "WAKE_DETECTED" });
    const failed = transitionWakeLifecycle(activating, {
      type: "ACTIVATION_FAILED",
      reason: "connection_timeout",
    });
    expect(failed.mode).toBe("STANDBY_LOCAL_WAKE");
    expect(failed.error).toBe("connection_timeout");
    expect(getWakeAudioGates(failed).sendMicrophoneToGemini).toBe(false);
  });
});
