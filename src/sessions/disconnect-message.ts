export interface UserDisconnectNotice {
  state: "ended";
  code: "session_timeout" | "provider_disconnected" | "provider_error" | "client_connection_error";
  message: string;
}

/**
 * Returns a safe, user-facing explanation only for server-side disconnects
 * where the application has enough context to offer a useful reason.
 */
export function getUserFacingDisconnectNotice(
  reason: string,
  maxDurationSeconds: number,
  closeCode?: number,
): UserDisconnectNotice | null {
  if (reason === "Session time limit reached") {
    const minutes = Math.max(1, Math.ceil(maxDurationSeconds / 60));
    return {
      state: "ended",
      code: "session_timeout",
      message: `This conversation reached its time limit (about ${minutes} minute${minutes === 1 ? "" : "s"}). Tap Start talking to begin another conversation.`,
    };
  }

  if (reason === "Voice provider disconnected") {
    const message = closeCode === 1006
      ? "The voice connection dropped without a clean close, usually because the network or voice service interrupted it. This is not a question-count limit. Tap Start talking to reconnect."
      : "The voice service closed its connection unexpectedly. This is not a question-count limit; the service or network connection may have interrupted the session. Tap Start talking to reconnect.";
    return { state: "ended", code: "provider_disconnected", message };
  }

  if (reason === "Voice provider socket error") {
    return {
      state: "ended",
      code: "provider_error",
      message: "The voice service encountered a connection error. Tap Start talking to start a new conversation.",
    };
  }

  if (reason === "Client socket error") {
    return {
      state: "ended",
      code: "client_connection_error",
      message: "The browser connection encountered an error. Check your internet connection and try again.",
    };
  }

  return null;
}

/** WebSocket close codes 1005, 1006 and 1015 (and 1004) are reserved. */
export function safeWebSocketCloseCode(code: number): number {
  const standardCode = code >= 1000 && code <= 1014 && ![1004, 1005, 1006].includes(code);
  const applicationCode = code >= 3000 && code <= 4999;
  return standardCode || applicationCode ? code : 1011;
}
