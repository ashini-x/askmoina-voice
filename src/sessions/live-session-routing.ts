const LIVE_SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Accept only opaque UUID session keys generated for one browser call/retry chain. */
export function normalizeLiveSessionId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return LIVE_SESSION_ID_PATTERN.test(normalized) ? normalized : null;
}

/** Stable Durable Object name scoped to one authenticated owner and one live session. */
export function liveSessionObjectName(owner: string, sessionId: string): string {
  const normalizedSessionId = normalizeLiveSessionId(sessionId);
  if (!owner.trim() || !normalizedSessionId) {
    throw new TypeError("A scoped owner and valid Live session UUID are required");
  }
  return "live-v1:" + owner.trim().slice(0, 300) + ":" + normalizedSessionId;
}

/** Close code reserved by the browser when a retry is handing off the client socket. */
export const LIVE_CLIENT_RECONNECT_CLOSE_CODE = 4001;

/** Preserve the upstream conversation on reconnect hand-offs and unexplained network drops. */
export function shouldDetachLiveSessionOnClientClose(code: number, reason: string): boolean {
  return code === LIVE_CLIENT_RECONNECT_CLOSE_CODE || (code === 1006 && !reason.trim());
}


/** Close code for a new provider session after a confirmed browser network loss. */
export const LIVE_CLIENT_REPLACEMENT_CLOSE_CODE = 4002;
