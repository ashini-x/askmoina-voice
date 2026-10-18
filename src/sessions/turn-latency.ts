/**
 * Privacy-safe latency measurement between a client turn boundary and the first
 * audio-bearing provider frame. This deliberately measures the server-observed
 * activity_end-to-audio interval, not the user's last phoneme: client-side silence
 * tolerance has already elapsed before activity_end is sent.
 */
export interface PendingTurnLatencyMeasurement {
  boundaryAtMs: number;
}

export interface TurnLatencySample {
  latencyMs: number;
}

export function beginTurnLatencyMeasurement(
  boundaryAtMs: number,
): PendingTurnLatencyMeasurement | null {
  if (!Number.isFinite(boundaryAtMs) || boundaryAtMs < 0) return null;
  return { boundaryAtMs };
}

export function measureFirstAudioAfterBoundary(
  pending: PendingTurnLatencyMeasurement | null,
  firstAudioAtMs: number,
  isAudioFrame: boolean,
): TurnLatencySample | null {
  if (
    !pending ||
    !isAudioFrame ||
    !Number.isFinite(pending.boundaryAtMs) ||
    pending.boundaryAtMs < 0 ||
    !Number.isFinite(firstAudioAtMs) ||
    firstAudioAtMs < pending.boundaryAtMs
  ) {
    return null;
  }

  return { latencyMs: Math.round(firstAudioAtMs - pending.boundaryAtMs) };
}

export interface InterruptedTurnSample {
  outcome: "interrupted_before_first_audio";
  elapsedMs: number;
}

/**
 * Classify a pending response when the user begins speaking before any
 * assistant audio has arrived. This is an interruption/turn-taking signal,
 * not a successful first-audio latency sample.
 */
export function measureTurnInterruptedBeforeFirstAudio(
  pending: PendingTurnLatencyMeasurement | null,
  interruptedAtMs: number,
): InterruptedTurnSample | null {
  if (
    !pending ||
    !Number.isFinite(pending.boundaryAtMs) ||
    pending.boundaryAtMs < 0 ||
    !Number.isFinite(interruptedAtMs) ||
    interruptedAtMs < pending.boundaryAtMs
  ) {
    return null;
  }

  return {
    outcome: "interrupted_before_first_audio",
    elapsedMs: Math.round(interruptedAtMs - pending.boundaryAtMs),
  };
}
