export type ClientReattachmentDecision = "wait" | "confirm_resumed" | "resume_provider" | "replace_session";

/** Snapshot of relay/provider ownership at the time a browser asks to reattach. */
export interface ClientReattachmentState {
  relayClosed: boolean;
  clientSetupReceived: boolean;
  providerSetupReady: boolean;
  providerSocketOpen: boolean;
  resumptionInProgress: boolean;
  replayInProgress: boolean;
  resumeHandleAvailable: boolean;
  securedSetupAvailable: boolean;
}

/**
 * A Live session is not "resumed" just because a browser WebSocket connected.
 * The provider must be open and setup-ready, and a resumption/replay operation
 * must be idle. Missing/expired handles result in one replacement-session path.
 */
export function decideClientReattachment(state: ClientReattachmentState): ClientReattachmentDecision {
  if (state.relayClosed || !state.clientSetupReceived) return "wait";
  if (state.resumptionInProgress || state.replayInProgress) return "wait";
  if (state.providerSetupReady && state.providerSocketOpen) return "confirm_resumed";
  if (!state.providerSocketOpen && state.resumeHandleAvailable && state.securedSetupAvailable) return "resume_provider";
  if (!state.providerSocketOpen) return "replace_session";
  // A live socket whose initial setup is delayed must finish setup, not spawn a duplicate.
  return "wait";
}

/** Reject duplicate resume requests while the current client or its setup handshake owns the slot. */
export function shouldAcceptBrowserReattachment(relayClosed: boolean, alreadyAttached: boolean): boolean {
  return !relayClosed && !alreadyAttached;
}

export function isRecoverableLiveDisconnectCode(code: unknown): boolean {
  return typeof code === "string" && [
    "provider_disconnected",
    "provider_error",
    "client_connection_error",
    "session_recovery_failed",
    "resume_handle_unavailable",
    "input_replay_window_lost",
  ].includes(code);
}

/** Detect explicit provider rejection of a resume handle without treating other errors as expiry. */
export function isExpiredSessionResumptionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  const detail = [record.code, record.status, record.message]
    .filter((value) => typeof value === "string")
    .join(" ");
  const mentionsResumeHandle = /resume|resumption|handle/i.test(detail);
  const invalidatesHandle = /expired|invalid|not found|unknown|unavailable|no longer valid|does not exist|cannot be resumed/i.test(detail);
  return mentionsResumeHandle && invalidatesHandle;
}
