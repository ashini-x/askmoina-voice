/**
 * Deterministic lifecycle and audio gates for AskMoina local wake-up.
 *
 * This module intentionally does not implement keyword spotting or open a
 * microphone/socket. A platform-specific local detector and the existing
 * AskMoina client must dispatch events and enforce the derived gates.
 * Invariant: no microphone frame may be sent upstream outside ACTIVE_LISTENING.
 */

export type WakeLifecycleMode =
  | "DISARMED"
  | "STANDBY_LOCAL_WAKE"
  | "ACTIVATING"
  | "ACTIVE_LISTENING"
  | "RECOVERING"
  | "STOPPING";

export interface WakeLifecycleState {
  mode: WakeLifecycleMode;
  standbyEnabled: boolean;
  microphonePermissionGranted: boolean;
  localDetectorReady: boolean;
  participantNoticeConfirmed: boolean;
  sessionConnected: boolean;
  privateOutputReady: boolean;
  activeSessionRequested: boolean;
  error: string | null;
}

export type WakeLifecycleEvent =
  | {
      type: "ENABLE_STANDBY";
      microphonePermissionGranted: boolean;
      localDetectorReady: boolean;
      participantNoticeConfirmed: boolean;
      warmSessionConnected: boolean;
    }
  | { type: "CONFIRM_PARTICIPANT_NOTICE" }
  | { type: "WAKE_DETECTED" }
  | { type: "SESSION_READY"; privateOutputReady: boolean }
  | { type: "SESSION_LOST" }
  | { type: "END_CONVERSATION" }
  | { type: "ACTIVATION_FAILED"; reason: string }
  | { type: "DISABLE_STANDBY" };

export interface WakeAudioGates {
  /** The mic may be captured locally for the opted-in detector/session. */
  captureMicrophoneLocally: boolean;
  /** Only true while waiting locally for the configured wake phrase. */
  localWakeDetectorEnabled: boolean;
  /** The hard upstream gate: false in standby, activation, recovery and stop. */
  sendMicrophoneToGemini: boolean;
  /** Assistant output is never unmuted before session and private route are ready. */
  allowAssistantOutput: boolean;
  /** A connected Live session may be kept warm only while standby is opted in. */
  mayKeepWarmSession: boolean;
}

export const initialWakeLifecycleState: WakeLifecycleState = {
  mode: "DISARMED",
  standbyEnabled: false,
  microphonePermissionGranted: false,
  localDetectorReady: false,
  participantNoticeConfirmed: false,
  sessionConnected: false,
  privateOutputReady: false,
  activeSessionRequested: false,
  error: null,
};

const isLocalCaptureMode = (mode: WakeLifecycleMode): boolean =>
  mode === "STANDBY_LOCAL_WAKE" ||
  mode === "ACTIVATING" ||
  mode === "ACTIVE_LISTENING" ||
  mode === "RECOVERING";

function failClosed(state: WakeLifecycleState, error: string): WakeLifecycleState {
  return {
    ...state,
    mode: state.standbyEnabled ? "STANDBY_LOCAL_WAKE" : "DISARMED",
    sessionConnected: state.standbyEnabled ? state.sessionConnected : false,
    privateOutputReady: false,
    activeSessionRequested: false,
    error,
  };
}

/** Apply one lifecycle event. Invalid/out-of-order events are ignored or fail closed. */
export function transitionWakeLifecycle(
  state: WakeLifecycleState,
  event: WakeLifecycleEvent,
): WakeLifecycleState {
  switch (event.type) {
    case "ENABLE_STANDBY": {
      if (!event.microphonePermissionGranted) {
        return {
          ...initialWakeLifecycleState,
          error: "microphone_permission_required",
        };
      }
      if (!event.localDetectorReady) {
        return {
          ...initialWakeLifecycleState,
          microphonePermissionGranted: true,
          error: "local_wake_detector_unavailable",
        };
      }
      if (!event.participantNoticeConfirmed) {
        return {
          ...initialWakeLifecycleState,
          microphonePermissionGranted: true,
          localDetectorReady: true,
          error: "participant_notice_required",
        };
      }
      return {
        mode: "STANDBY_LOCAL_WAKE",
        standbyEnabled: true,
        microphonePermissionGranted: true,
        localDetectorReady: true,
        participantNoticeConfirmed: true,
        sessionConnected: event.warmSessionConnected,
        privateOutputReady: false,
        activeSessionRequested: false,
        error: null,
      };
    }

    case "CONFIRM_PARTICIPANT_NOTICE":
      return { ...state, participantNoticeConfirmed: true, error: null };

    case "WAKE_DETECTED":
      if (state.mode !== "STANDBY_LOCAL_WAKE" || !state.standbyEnabled) return state;
      if (!state.microphonePermissionGranted || !state.localDetectorReady) {
        return failClosed(state, "local_wake_prerequisite_missing");
      }
      if (!state.participantNoticeConfirmed) {
        return failClosed(state, "participant_notice_required");
      }
      return {
        ...state,
        mode: state.sessionConnected ? "ACTIVATING" : "RECOVERING",
        privateOutputReady: false,
        activeSessionRequested: true,
        error: null,
      };

    case "SESSION_READY":
      if (!state.standbyEnabled || !state.activeSessionRequested) {
        return {
          ...state,
          sessionConnected: state.standbyEnabled ? true : false,
          privateOutputReady: false,
          mode: state.standbyEnabled ? "STANDBY_LOCAL_WAKE" : "DISARMED",
          error: null,
        };
      }
      if (!event.privateOutputReady) {
        return failClosed(
          { ...state, sessionConnected: true },
          "private_audio_route_unavailable",
        );
      }
      if (!state.participantNoticeConfirmed) {
        return failClosed(
          { ...state, sessionConnected: true },
          "participant_notice_required",
        );
      }
      return {
        ...state,
        mode: "ACTIVE_LISTENING",
        sessionConnected: true,
        privateOutputReady: true,
        activeSessionRequested: true,
        error: null,
      };

    case "SESSION_LOST":
      if (state.mode === "DISARMED" || state.mode === "STOPPING") return state;
      if (!state.standbyEnabled) {
        return { ...initialWakeLifecycleState, error: "live_session_disconnected" };
      }
      return {
        ...state,
        mode: state.activeSessionRequested ? "RECOVERING" : "STANDBY_LOCAL_WAKE",
        sessionConnected: false,
        privateOutputReady: false,
        error: "live_session_disconnected",
      };

    case "END_CONVERSATION":
      return {
        ...state,
        mode: state.standbyEnabled ? "STANDBY_LOCAL_WAKE" : "DISARMED",
        sessionConnected: state.standbyEnabled ? state.sessionConnected : false,
        privateOutputReady: false,
        activeSessionRequested: false,
        error: null,
      };

    case "ACTIVATION_FAILED":
      return failClosed(state, event.reason || "activation_failed");

    case "DISABLE_STANDBY":
      return {
        ...initialWakeLifecycleState,
        microphonePermissionGranted: state.microphonePermissionGranted,
        localDetectorReady: state.localDetectorReady,
      };
  }
}

/** Derive mandatory mic/output gates from lifecycle state; do not duplicate this logic at callers. */
export function getWakeAudioGates(state: WakeLifecycleState): WakeAudioGates {
  const captureMicrophoneLocally =
    state.standbyEnabled &&
    state.microphonePermissionGranted &&
    state.localDetectorReady &&
    isLocalCaptureMode(state.mode);

  const sendMicrophoneToGemini =
    state.mode === "ACTIVE_LISTENING" &&
    state.standbyEnabled &&
    state.sessionConnected &&
    state.participantNoticeConfirmed &&
    state.privateOutputReady;

  return {
    captureMicrophoneLocally,
    localWakeDetectorEnabled: state.mode === "STANDBY_LOCAL_WAKE" && captureMicrophoneLocally,
    sendMicrophoneToGemini,
    allowAssistantOutput: sendMicrophoneToGemini && state.privateOutputReady,
    mayKeepWarmSession:
      state.standbyEnabled &&
      state.sessionConnected &&
      (state.mode === "STANDBY_LOCAL_WAKE" ||
        state.mode === "ACTIVATING" ||
        state.mode === "ACTIVE_LISTENING"),
  };
}
