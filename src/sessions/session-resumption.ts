export interface SessionResumptionCheckpoint {
  handle: string;
  lastConsumedClientMessageIndex: number;
}

export interface ReplayMessage {
  index: number;
  encoded: string;
}

/**
 * A provider checkpoint is valid only when both its resumable handle and consumed
 * message cursor are present. Never combine a fresh cursor with an older handle.
 */
export function parseSessionResumptionCheckpoint(update: unknown): SessionResumptionCheckpoint | null {
  if (!update || typeof update !== "object") return null;
  const fields = update as Record<string, unknown>;
  const handle = fields.newHandle;
  if (fields.resumable !== true || typeof handle !== "string" || handle.trim().length === 0 || handle.length > 4_096) {
    return null;
  }

  const consumedValue = fields.lastConsumedClientMessageIndex;
  const consumedIndex = typeof consumedValue === "number"
    ? consumedValue
    : typeof consumedValue === "string" && consumedValue.trim()
      ? Number(consumedValue)
      : Number.NaN;
  if (!Number.isSafeInteger(consumedIndex) || consumedIndex < 0) return null;

  return { handle, lastConsumedClientMessageIndex: consumedIndex };
}

export function canAdvanceSessionResumptionCheckpoint(
  current: SessionResumptionCheckpoint | null,
  candidate: SessionResumptionCheckpoint | null,
): candidate is SessionResumptionCheckpoint {
  return candidate !== null &&
    (!current || candidate.lastConsumedClientMessageIndex >= current.lastConsumedClientMessageIndex);
}

/** Evicted input is harmless only if a valid checkpoint already includes it. */
export function isReplayWindowComplete(
  highestEvictedClientMessageIndex: number,
  checkpointConsumedIndex: number,
): boolean {
  return highestEvictedClientMessageIndex <= checkpointConsumedIndex;
}

/**
 * Keep the replay buffer bounded while remembering the newest unacknowledged index
 * evicted from its only replay copy. The caller must stop continuity if this index
 * advances beyond its paired checkpoint cursor.
 */
export function trimReplayBufferToLimit(
  buffer: ReplayMessage[],
  maxChars: number,
  currentChars: number,
  checkpointConsumedIndex: number,
  highestEvictedClientMessageIndex: number,
): { bufferChars: number; highestEvictedClientMessageIndex: number } {
  let bufferChars = currentChars;
  let highestEvicted = highestEvictedClientMessageIndex;

  while (bufferChars > maxChars && buffer.length > 0) {
    const removed = buffer.shift()!;
    bufferChars -= removed.encoded.length;
    if (removed.index > checkpointConsumedIndex) {
      highestEvicted = Math.max(highestEvicted, removed.index);
    }
  }

  return {
    bufferChars: Math.max(0, bufferChars),
    highestEvictedClientMessageIndex: highestEvicted,
  };
}
