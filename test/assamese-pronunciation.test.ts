import { describe, expect, it } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import { buildAssamesePronunciationInstruction, type AssamesePronunciationRuleRow } from "../src/sessions/assamese-pronunciation";

const syntheticRules: AssamesePronunciationRuleRow[] = [
  {
    rule_id: "assamese-sibilants-x-baseline",
    title: "Assamese শ, ষ, স baseline",
    dialect_scope: "Assamese-wide baseline; lexical exceptions exist",
    position_scope: "native Assamese words",
    guidance: "For Assamese-native words, শ, ষ and স generally correspond to the voiceless velar fricative /x/, not automatically an ordinary English /s/ or Bengali-like /ʃ/.",
    examples: "Do not use English letter names for Assamese শ/ষ/স.",
    source_title: "Government of Assam / BIS, Assamese Phonology and Vocabulary",
    evidence_status: "published_general",
    native_verified: 0,
    priority: 10,
  },
  {
    rule_id: "eastern-initial-x-h-variation",
    title: "Word-initial /x/ may surface as [h] in a regional variety",
    dialect_scope: "Eastern Assamese; candidate variant to evaluate for Upper Assam",
    position_scope: "word-initial",
    guidance: "A published study reports that /x/ may be realized [h] word-initially in particular words and speakers. Allow this as a possible local realization when natural; do not force [h] on every word or every speaker.",
    examples: "/xɔdai/ → [hɔdai] (“every day”) is a reported example, not a universal prescription.",
    source_title: "Das and Deka, The Allophonic Variation of the Assamese Voiceless Velar Fricative /x/",
    evidence_status: "published_regional_hypothesis",
    native_verified: 0,
    priority: 20,
  },
  {
    rule_id: "assamese-x-position-guardrail",
    title: "Do not generalize the initial [h] variant to every position",
    dialect_scope: "Dialect- and speaker-dependent Assamese varieties",
    position_scope: "medial, final and lexical exceptions",
    guidance: "Realization of /x/ varies with word position, lexical item, region and speaker. One published Eastern Assamese description reports /akax/ → [akakʰ] and /ɔxɔm/ → [ɔkʰɔm] for particular examples. These are not universal or Upper Assam native-verified. Do not convert every /x/ to [h].",
    examples: "Published Eastern-variety examples: /xɔdai/ → [hɔdai], /akax/ → [akakʰ], /ɔxɔm/ → [ɔkʰɔm]. These are not yet Upper Assam native-verified.",
    source_title: "Das and Deka, The Allophonic Variation of the Assamese Voiceless Velar Fricative /x/",
    evidence_status: "published_regional_hypothesis",
    native_verified: 0,
    priority: 30,
  },
  {
    rule_id: "assamese-english-code-switching-guardrail",
    title: "Protect English pronunciation in mixed Assamese-English speech",
    dialect_scope: "Assamese-English code-switching",
    position_scope: "English words and phrases",
    guidance: "During Assamese-English code-switching, retain conventional English pronunciation for English words such as “study”, “system” and “seriously”. Never change each Roman “s” to “h”; apply Assamese sound patterns only when the intended word is Assamese.",
    examples: "Negative control: “I am studying the system seriously” keeps the English /s/ sounds.",
    source_title: "AskMoina Voice product guardrail; synthetic negative control",
    evidence_status: "engineering_guardrail",
    native_verified: 0,
    priority: 40,
  },
  {
    rule_id: "romanized-assamese-not-letter-substitution",
    title: "Interpret Romanized Assamese by word identity, not single letters",
    dialect_scope: "Romanized Assamese and mixed-script chat",
    position_scope: "whole word and context",
    guidance: "Romanized Assamese spelling is inconsistent. Infer the intended Assamese word from context; do not use raw Roman “s”, “x” or “h” as a mechanical substitution rule. If unsure, use the Assamese-native phonological baseline and avoid an overconfident dialect claim.",
    examples: "Do not transform every Romanized s into h.",
    source_title: "AskMoina Voice product guardrail; synthetic negative control",
    evidence_status: "engineering_guardrail",
    native_verified: 0,
    priority: 50,
  },
];

function mockDb(rows: AssamesePronunciationRuleRow[], shouldThrow = false): Pick<D1Database, "prepare"> {
  return {
    prepare: () => ({
      all: async () => {
        if (shouldThrow) throw new Error("D1 table not migrated");
        return { results: rows };
      },
    }),
  } as unknown as Pick<D1Database, "prepare">;
}

const syntheticCases = [
  {
    name: "Assamese-native শ/ষ/স baseline",
    expected: "voiceless velar fricative /x/",
  },
  {
    name: "word-initial [h] is allowed only as a regional variant",
    expected: "/x/ may be realized [h] word-initially",
  },
  {
    name: "a sample initial [h] pronunciation is not universal",
    expected: "not a universal prescription",
  },
  {
    name: "the sound rule is not generalized to every position",
    expected: "Do not generalize the initial [h] variant to every position",
  },
  {
    name: "published medial/final variants remain attributed candidate examples, not a universal rule",
    expected: "/akax/ → [akakʰ]",
  },
  {
    name: "English /s/ remains intact inside Assamese-English code-switching",
    expected: "Never change each Roman “s” to “h”",
  },
  {
    name: "Romanized Assamese is interpreted by word and context",
    expected: "do not use raw Roman “s”, “x” or “h” as a mechanical substitution rule",
  },
  {
    name: "the database's seed rules are not falsely claimed to be native-verified",
    expected: "None of the seed rules is yet locally verified",
  },
] as const;

describe("AskMoina Upper Assam pronunciation reference", () => {
  it("builds a bounded guidance appendix from enabled D1 rule rows", async () => {
    const prompt = await buildAssamesePronunciationInstruction(mockDb(syntheticRules));
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt.length).toBeLessThanOrEqual(4_000);
    expect(prompt).toContain("source-attributed rule database");
    expect(prompt).toContain("native-speaker-verified");
    expect(prompt).toContain("not universal or Upper Assam native-verified");
  });

  for (const testCase of syntheticCases) {
    it(`synthetic case: ${testCase.name}`, async () => {
      const prompt = await buildAssamesePronunciationInstruction(mockDb(syntheticRules));
      expect(prompt).toContain(testCase.expected);
    });
  }

  it("fails open to the existing base prompt if the migration/table is unavailable", async () => {
    await expect(buildAssamesePronunciationInstruction(undefined)).resolves.toBe("");
    await expect(buildAssamesePronunciationInstruction(mockDb([], true))).resolves.toBe("");
    await expect(buildAssamesePronunciationInstruction(mockDb([]))).resolves.toBe("");
  });

  it("limits database context so future lexicon growth cannot bloat each Live setup", async () => {
    const manyRules = Array.from({ length: 50 }, (_, i) => ({
      ...syntheticRules[0],
      rule_id: `rule-${i}`,
      title: `Synthetic rule ${i}`,
      guidance: "regional pronunciation guidance ".repeat(80),
    }));
    const prompt = await buildAssamesePronunciationInstruction(mockDb(manyRules));
    expect(prompt.length).toBeLessThanOrEqual(4_000);
  });
});
