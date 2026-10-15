/** Hard cap for client input retained across a Live socket rotation (16 MiB). */
export const MAX_RESUME_REPLAY_CHARS = 16 * 1024 * 1024;

export interface SessionResumptionCheckpoint {
  handle: string;
  lastConsumedClientMessageIndex: number;
}

export interface ReplayMessage {
  index: number;
  encoded: string;
  /** Media type supports safe camera compaction during a resumed connection. */
  kind?: "audio" | "video" | "control";
}

/**
 * Camera frames are snapshots, unlike microphone PCM and control messages.
 * During recovery, replay only the newest unconsumed video snapshot while
 * preserving every audio/control message and the order of those messages.
 */
export function compactReplayMessagesForResumption(
  messages: readonly ReplayMessage[],
): ReplayMessage[] {
  let latestVideoPosition = -1;
  for (let i = 0; i < messages.length; i += 1) {
    if (messages[i].kind === "video") latestVideoPosition = i;
  }
  return messages.filter((message, index) =>
    message.kind !== "video" || index === latestVideoPosition
  );
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


/** True only when the provider's checkpoint cursor refers to messages sent on this connection. */
export function isCheckpointWithinSentMessageWindow(
  candidate: SessionResumptionCheckpoint | null,
  highestSentClientMessageIndex: number,
): candidate is SessionResumptionCheckpoint {
  return candidate !== null &&
    Number.isSafeInteger(highestSentClientMessageIndex) &&
    highestSentClientMessageIndex >= 0 &&
    candidate.lastConsumedClientMessageIndex <= highestSentClientMessageIndex;
}

export interface PendingUpstreamMessageLike {
  payload: Record<string, unknown>;
  chars: number;
}

/** Video frames are replaceable evidence; audio, text, and control input are not. */
function isReplaceableVideoMessage(payload: Record<string, unknown>): boolean {
  const realtimeInput = payload.realtimeInput;
  if (!realtimeInput || typeof realtimeInput !== "object" || Array.isArray(realtimeInput)) return false;
  const input = realtimeInput as Record<string, unknown>;
  return "video" in input && !("audio" in input) && !("audioStreamEnd" in input);
}

/**
 * Bounds messages queued while the upstream is reconnecting. If trimming discards
 * anything other than an isolated video frame, the caller must terminate continuity.
 */
export function trimPendingMessagesToLimit<T extends PendingUpstreamMessageLike>(
  pending: T[],
  maxChars: number,
  currentChars: number,
): { bufferChars: number; droppedCount: number; droppedNonReplaceable: boolean } {
  let bufferChars = currentChars;
  let droppedCount = 0;
  let droppedNonReplaceable = false;
  const limit = Math.max(0, maxChars);

  while (bufferChars > limit && pending.length > 0) {
    const dropped = pending.shift()!;
    bufferChars -= dropped.chars;
    droppedCount += 1;
    if (!isReplaceableVideoMessage(dropped.payload)) droppedNonReplaceable = true;
  }

  return {
    bufferChars: Math.max(0, bufferChars),
    droppedCount,
    droppedNonReplaceable,
  };
}
