export interface SilentTurnRecoveryObservation {
  turnComplete: boolean;
  responseHasAudio: boolean;
  retryPending: boolean;
  retryAlreadyUsed: boolean;
  hasRecentUserInput: boolean;
  safeToRetry: boolean;
}

export type SilentTurnRecoveryDecision = "wait" | "normal" | "retry" | "recovered" | "failed";

/**
 * Decide recovery only at a provider turn boundary. This deliberately does not
 * infer a reconnect or compression event: it only distinguishes an audible turn
 * from a completed, audio-less turn while the original request is still known.
 */
export function decideSilentTurnRecovery(
  observation: SilentTurnRecoveryObservation,
): SilentTurnRecoveryDecision {
  if (!observation.turnComplete) return "wait";
  if (observation.responseHasAudio) return observation.retryPending ? "recovered" : "normal";
  if (observation.retryPending) return "failed";
  if (!observation.hasRecentUserInput || !observation.safeToRetry) return "normal";
  return observation.retryAlreadyUsed ? "failed" : "retry";
}
