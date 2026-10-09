export interface UserDisconnectNotice {
  state: "ended";
  code:
    | "session_timeout"
    | "provider_disconnected"
    | "provider_error"
    | "client_connection_error"
    | "invalid_audio_frame"
    | "audio_rate_limit"
    | "invalid_client_frame"
    | "invalid_protocol"
    | "provider_protocol_error";
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
    const message = closeCode === 1008
      ? "The upstream voice service closed this session with policy code 1008. This is not a question-count cap. Tap Start talking to start a new conversation; if it repeats, the recorded connection diagnostics will help identify why."
      : closeCode === 1006
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

  if (reason === "Invalid PCM audio frame") {
    return {
      state: "ended",
      code: "invalid_audio_frame",
      message: "AskMoina could not read an incoming microphone audio packet. This is an audio-format issue, not a question limit. Check your selected microphone or refresh the page, then try again.",
    };
  }

  if (reason === "Audio input rate limit exceeded") {
    return {
      state: "ended",
      code: "audio_rate_limit",
      message: "Audio packets arrived faster than AskMoina can accept them. This is not a question-count limit. Please refresh and start again; if it repeats, we can use the recorded connection diagnostics to tune audio handling.",
    };
  }

  if (reason === "Invalid or oversized client frame") {
    return {
      state: "ended",
      code: "invalid_client_frame",
      message: "The browser sent an unsupported voice packet. Refresh AskMoina and start a new conversation. This is not a question-count limit.",
    };
  }

  if (
    reason === "First message must be a small setup object" ||
    reason === "Invalid setup message" ||
    reason === "Only realtime audio input is allowed" ||
    reason === "Invalid client message"
  ) {
    return {
      state: "ended",
      code: "invalid_protocol",
      message: "The voice connection received a message in an unexpected format. Refresh AskMoina and start a new conversation. This is not a question-count limit.",
    };
  }

  if (reason === "Provider frame decode failed" || reason === "Invalid provider frame") {
    return {
      state: "ended",
      code: "provider_protocol_error",
      message: "The voice service sent a response AskMoina could not read. Please start a new conversation; if it repeats, the connection diagnostics will help identify why.",
    };
  }

  if (reason === "Client send failed") {
    return {
      state: "ended",
      code: "client_connection_error",
      message: "AskMoina could not send a response to this browser connection. Check your connection and start a new conversation.",
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
