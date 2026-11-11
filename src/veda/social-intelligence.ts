/**
 * Pure, deterministic policy for Veda's private social-intelligence whispers.
 *
 * This module does not capture audio, persist transcripts, identify participants,
 * or authenticate users. It only decides whether a candidate insight may be
 * handed to the private-output layer. The caller must separately enforce admin
 * authorization, explicit armed state, participant notice/consent, and safe
 * earbud routing.
 */

export type InsightKind =
  | "context_reminder"
  | "clarifying_question"
  | "useful_example"
  | "respectful_counterpoint"
  | "grounded_correction";

export interface CandidateInsight {
  id: string;
  text: string;
  kind: InsightKind;
  createdAtMs: number;
  expiresAtMs: number;
  confidence: number;
  relevance: number;
  evidence: "conversation" | "approved_memory" | "grounded_source";
  topicKey: string;
}

export interface WhisperPolicyState {
  /** Listening is explicitly armed by the administrator. */
  armed: boolean;
  /** The administrator has opted into the current conversation mode. */
  consentConfirmed: boolean;
  /** The private earbud/audio route is available and selected. */
  privateOutputReady: boolean;
  /** The administrator is speaking or has manually interrupted playback. */
  userSpeaking: boolean;
  /** A direct request is currently being answered. */
  directRequestPending: boolean;
  nowMs: number;
  lastDeliveredAtMs: number | null;
  cooldownMs: number;
  minimumConfidence: number;
  minimumRelevance: number;
  currentTopicKey: string;
  deliveredIds: readonly string[];
  /** IDs already spoken in this session, for idempotent delivery. */
  queuedIds?: readonly string[];
}

export type WhisperDecision =
  | { allow: true; insight: CandidateInsight }
  | {
      allow: false;
      reason:
        | "not_armed"
        | "consent_not_confirmed"
        | "private_output_unavailable"
        | "user_speaking"
        | "direct_request_priority"
        | "expired"
        | "not_yet_available"
        | "low_confidence"
        | "low_relevance"
        | "stale_topic"
        | "duplicate"
        | "cooldown"
        | "empty_text"
        | "invalid_candidate";
    };

const deny = (reason: Extract<WhisperDecision, { allow: false }>["reason"]): WhisperDecision => ({
  allow: false,
  reason,
});

/**
 * Applies the safety/timing gate to one candidate. This function deliberately
 * prefers silence over a weak, stale, duplicate, or mistimed suggestion.
 */
export function decideWhisper(
  insight: CandidateInsight,
  state: WhisperPolicyState,
): WhisperDecision {
  if (!state.armed) return deny("not_armed");
  if (!state.consentConfirmed) return deny("consent_not_confirmed");
  if (!state.privateOutputReady) return deny("private_output_unavailable");
  if (state.userSpeaking) return deny("user_speaking");
  if (state.directRequestPending) return deny("direct_request_priority");

  if (
    !insight.id.trim() ||
    !insight.topicKey.trim() ||
    !Number.isFinite(insight.createdAtMs) ||
    !Number.isFinite(insight.expiresAtMs) ||
    !Number.isFinite(insight.confidence) ||
    !Number.isFinite(insight.relevance) ||
    insight.expiresAtMs <= insight.createdAtMs ||
    insight.confidence < 0 ||
    insight.confidence > 1 ||
    insight.relevance < 0 ||
    insight.relevance > 1
  ) return deny("invalid_candidate");

  if (!insight.text.trim()) return deny("empty_text");
  if (state.nowMs < insight.createdAtMs) return deny("not_yet_available");
  if (state.nowMs >= insight.expiresAtMs) return deny("expired");
  if (insight.confidence < state.minimumConfidence) return deny("low_confidence");
  if (insight.relevance < state.minimumRelevance) return deny("low_relevance");
  if (insight.topicKey !== state.currentTopicKey) return deny("stale_topic");

  if (
    state.deliveredIds.includes(insight.id) ||
    (state.queuedIds ?? []).includes(insight.id)
  ) return deny("duplicate");

  if (
    state.lastDeliveredAtMs !== null &&
    state.nowMs - state.lastDeliveredAtMs < state.cooldownMs
  ) return deny("cooldown");

  return { allow: true, insight };
}
