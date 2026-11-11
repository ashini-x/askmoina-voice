import { describe, expect, it } from "vitest";
import { decideWhisper, type CandidateInsight, type WhisperPolicyState } from "./social-intelligence";

const candidate: CandidateInsight = {
  id: "insight-1",
  text: "Ask whether the proposed timeline includes testing.",
  kind: "clarifying_question",
  createdAtMs: 1_000,
  expiresAtMs: 10_000,
  confidence: 0.94,
  relevance: 0.91,
  evidence: "conversation",
  topicKey: "project-timeline",
};

const state = (overrides: Partial<WhisperPolicyState> = {}): WhisperPolicyState => ({
  armed: true,
  consentConfirmed: true,
  privateOutputReady: true,
  userSpeaking: false,
  directRequestPending: false,
  nowMs: 2_000,
  lastDeliveredAtMs: null,
  cooldownMs: 5_000,
  minimumConfidence: 0.8,
  minimumRelevance: 0.75,
  currentTopicKey: "project-timeline",
  deliveredIds: [],
  queuedIds: [],
  ...overrides,
});

describe("Veda social-intelligence whisper policy", () => {
  it("allows a fresh, relevant candidate only when all controls are ready", () => {
    expect(decideWhisper(candidate, state())).toEqual({ allow: true, insight: candidate });
  });

  it.each([
    [{ armed: false }, "not_armed"],
    [{ consentConfirmed: false }, "consent_not_confirmed"],
    [{ privateOutputReady: false }, "private_output_unavailable"],
    [{ userSpeaking: true }, "user_speaking"],
    [{ directRequestPending: true }, "direct_request_priority"],
  ] as const)("fails closed when required runtime state is unsafe: %j", (overrides, reason) => {
    expect(decideWhisper(candidate, state(overrides))).toEqual({ allow: false, reason });
  });

  it("rejects expired, future, weak, and off-topic candidates", () => {
    expect(decideWhisper(candidate, state({ nowMs: 10_000 }))).toMatchObject({ allow: false, reason: "expired" });
    expect(decideWhisper(candidate, state({ nowMs: 999 }))).toMatchObject({ allow: false, reason: "not_yet_available" });
    expect(decideWhisper({ ...candidate, confidence: 0.4 }, state())).toMatchObject({ allow: false, reason: "low_confidence" });
    expect(decideWhisper({ ...candidate, relevance: 0.2 }, state())).toMatchObject({ allow: false, reason: "low_relevance" });
    expect(decideWhisper(candidate, state({ currentTopicKey: "different-topic" }))).toMatchObject({ allow: false, reason: "stale_topic" });
  });

  it("suppresses duplicate and already queued insights", () => {
    expect(decideWhisper(candidate, state({ deliveredIds: [candidate.id] }))).toMatchObject({ allow: false, reason: "duplicate" });
    expect(decideWhisper(candidate, state({ queuedIds: [candidate.id] }))).toMatchObject({ allow: false, reason: "duplicate" });
  });

  it("enforces a cooldown between unsolicited whispers", () => {
    expect(decideWhisper(candidate, state({ lastDeliveredAtMs: 1_500, cooldownMs: 1_000 }))).toMatchObject({ allow: false, reason: "cooldown" });
    expect(decideWhisper(candidate, state({ lastDeliveredAtMs: 1_000, cooldownMs: 1_000 }))).toMatchObject({ allow: true });
  });

  it("rejects empty text and invalid candidate confidence/timestamps", () => {
    expect(decideWhisper({ ...candidate, text: "   " }, state())).toMatchObject({ allow: false, reason: "empty_text" });
    expect(decideWhisper({ ...candidate, confidence: 1.1 }, state())).toMatchObject({ allow: false, reason: "invalid_candidate" });
    expect(decideWhisper({ ...candidate, expiresAtMs: candidate.createdAtMs }, state())).toMatchObject({ allow: false, reason: "invalid_candidate" });
  });

  it("never treats a voice profile or candidate as authorization", () => {
    // The policy accepts only explicit runtime/consent state; there is no voice-match
    // or speaker-name field capable of granting permission.
    expect(decideWhisper(candidate, state({ armed: false, consentConfirmed: true }))).toMatchObject({ allow: false, reason: "not_armed" });
  });
});
