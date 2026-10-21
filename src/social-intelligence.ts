/**
 * Deterministic delivery policy for AskMoina's social-intelligence whispers.
 *
 * This is a policy gate, not an audio recorder, identity system, or authenticator.
 * The existing app must supply verified auth, explicit listening state, consent,
 * and a confirmed private output route before any candidate reaches playback.
 */

export type SocialInsightKind =
  | "context_reminder"
  | "clarifying_question"
  | "useful_example"
  | "respectful_counterpoint"
  | "grounded_correction";

export interface SocialInsightCandidate {
  id: string;
  text: string;
  kind: SocialInsightKind;
  createdAtMs: number;
  expiresAtMs: number;
  confidence: number;
  relevance: number;
  evidence: "conversation" | "approved_memory" | "grounded_source";
  topicKey: string;
}

export interface SocialWhisperState {
  armed: boolean;
  participantNoticeConfirmed: boolean;
  privateOutputReady: boolean;
  userSpeaking: boolean;
  directRequestPending: boolean;
  nowMs: number;
  lastDeliveredAtMs: number | null;
  cooldownMs: number;
  minimumConfidence: number;
  minimumRelevance: number;
  currentTopicKey: string;
  deliveredIds: readonly string[];
  queuedIds?: readonly string[];
}

export type SocialWhisperDecision =
  | { allow: true; candidate: SocialInsightCandidate }
  | {
      allow: false;
      reason:
        | "not_armed"
        | "notice_not_confirmed"
        | "private_output_unavailable"
        | "user_speaking"
        | "direct_request_priority"
        | "invalid_candidate"
        | "empty_text"
        | "not_yet_available"
        | "expired"
        | "low_confidence"
        | "low_relevance"
        | "stale_topic"
        | "duplicate"
        | "cooldown";
    };

const reject = (
  reason: Extract<SocialWhisperDecision, { allow: false }>["reason"],
): SocialWhisperDecision => ({ allow: false, reason });

/** Prefer silence over a stale, duplicate, weak, or mistimed suggestion. */
export function decideSocialWhisper(
  candidate: SocialInsightCandidate,
  state: SocialWhisperState,
): SocialWhisperDecision {
  if (!state.armed) return reject("not_armed");
  if (!state.participantNoticeConfirmed) return reject("notice_not_confirmed");
  if (!state.privateOutputReady) return reject("private_output_unavailable");
  if (state.userSpeaking) return reject("user_speaking");
  if (state.directRequestPending) return reject("direct_request_priority");

  if (
    !candidate.id.trim() ||
    !candidate.topicKey.trim() ||
    !Number.isFinite(candidate.createdAtMs) ||
    !Number.isFinite(candidate.expiresAtMs) ||
    !Number.isFinite(candidate.confidence) ||
    !Number.isFinite(candidate.relevance) ||
    candidate.expiresAtMs <= candidate.createdAtMs ||
    candidate.confidence < 0 || candidate.confidence > 1 ||
    candidate.relevance < 0 || candidate.relevance > 1 ||
    !Number.isFinite(state.nowMs) ||
    !Number.isFinite(state.cooldownMs) || state.cooldownMs < 0 ||
    !Number.isFinite(state.minimumConfidence) ||
    !Number.isFinite(state.minimumRelevance)
  ) return reject("invalid_candidate");

  if (!candidate.text.trim()) return reject("empty_text");
  if (state.nowMs < candidate.createdAtMs) return reject("not_yet_available");
  if (state.nowMs >= candidate.expiresAtMs) return reject("expired");
  if (candidate.confidence < state.minimumConfidence) return reject("low_confidence");
  if (candidate.relevance < state.minimumRelevance) return reject("low_relevance");
  if (candidate.topicKey !== state.currentTopicKey) return reject("stale_topic");
  if (
    state.deliveredIds.includes(candidate.id) ||
    (state.queuedIds ?? []).includes(candidate.id)
  ) return reject("duplicate");
  if (
    state.lastDeliveredAtMs !== null &&
    state.nowMs - state.lastDeliveredAtMs < state.cooldownMs
  ) return reject("cooldown");

  return { allow: true, candidate };
}
