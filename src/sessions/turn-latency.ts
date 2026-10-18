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
