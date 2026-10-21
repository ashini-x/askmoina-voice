import { describe, expect, it } from "vitest";
import {
  decideSocialWhisper,
  type SocialInsightCandidate,
  type SocialWhisperState,
} from "./social-intelligence";

const candidate: SocialInsightCandidate = {
  id: "candidate-1",
  text: "Ask whether the timeline includes testing.",
  kind: "clarifying_question",
  createdAtMs: 1_000,
  expiresAtMs: 10_000,
  confidence: 0.94,
  relevance: 0.91,
  evidence: "conversation",
  topicKey: "project-timeline",
};

const makeState = (overrides: Partial<SocialWhisperState> = {}): SocialWhisperState => ({
  armed: true,
  participantNoticeConfirmed: true,
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

describe("AskMoina social whisper policy", () => {
  it("allows a fresh and relevant candidate only when controls are ready", () => {
    expect(decideSocialWhisper(candidate, makeState())).toEqual({ allow: true, candidate });
  });

  it.each([
    [{ armed: false }, "not_armed"],
    [{ participantNoticeConfirmed: false }, "notice_not_confirmed"],
    [{ privateOutputReady: false }, "private_output_unavailable"],
    [{ userSpeaking: true }, "user_speaking"],
    [{ directRequestPending: true }, "direct_request_priority"],
  ] as const)("fails closed for unsafe runtime states: %j", (overrides, reason) => {
    expect(decideSocialWhisper(candidate, makeState(overrides))).toEqual({ allow: false, reason });
  });

  it("rejects stale, future, low-confidence, low-relevance, and off-topic candidates", () => {
    expect(decideSocialWhisper(candidate, makeState({ nowMs: 10_000 }))).toMatchObject({ allow: false, reason: "expired" });
    expect(decideSocialWhisper(candidate, makeState({ nowMs: 999 }))).toMatchObject({ allow: false, reason: "not_yet_available" });
    expect(decideSocialWhisper({ ...candidate, confidence: 0.2 }, makeState())).toMatchObject({ allow: false, reason: "low_confidence" });
    expect(decideSocialWhisper({ ...candidate, relevance: 0.2 }, makeState())).toMatchObject({ allow: false, reason: "low_relevance" });
    expect(decideSocialWhisper(candidate, makeState({ currentTopicKey: "other" }))).toMatchObject({ allow: false, reason: "stale_topic" });
  });

  it("suppresses delivered and queued duplicates", () => {
    expect(decideSocialWhisper(candidate, makeState({ deliveredIds: [candidate.id] }))).toMatchObject({ allow: false, reason: "duplicate" });
    expect(decideSocialWhisper(candidate, makeState({ queuedIds: [candidate.id] }))).toMatchObject({ allow: false, reason: "duplicate" });
  });

  it("enforces cooldown and permits delivery at the exact cooldown boundary", () => {
    expect(decideSocialWhisper(candidate, makeState({ lastDeliveredAtMs: 1_500, cooldownMs: 1_000 }))).toMatchObject({ allow: false, reason: "cooldown" });
    expect(decideSocialWhisper(candidate, makeState({ lastDeliveredAtMs: 1_000, cooldownMs: 1_000 }))).toMatchObject({ allow: true });
  });

  it("rejects empty text and invalid scores, timestamps, and cooldowns", () => {
    expect(decideSocialWhisper({ ...candidate, text: "  " }, makeState())).toMatchObject({ allow: false, reason: "empty_text" });
    expect(decideSocialWhisper({ ...candidate, confidence: 1.2 }, makeState())).toMatchObject({ allow: false, reason: "invalid_candidate" });
    expect(decideSocialWhisper({ ...candidate, expiresAtMs: candidate.createdAtMs }, makeState())).toMatchObject({ allow: false, reason: "invalid_candidate" });
    expect(decideSocialWhisper(candidate, makeState({ cooldownMs: -1 }))).toMatchObject({ allow: false, reason: "invalid_candidate" });
  });

  it("does not use a voice match as authorization", () => {
    expect(decideSocialWhisper(candidate, makeState({ armed: false }))).toMatchObject({ allow: false, reason: "not_armed" });
  });
});
