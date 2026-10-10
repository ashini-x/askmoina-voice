CREATE TABLE IF NOT EXISTS assamese_pronunciation_rules (
  rule_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  dialect_scope TEXT NOT NULL,
  position_scope TEXT NOT NULL,
  guidance TEXT NOT NULL,
  examples TEXT NOT NULL DEFAULT '',
  source_title TEXT NOT NULL,
  source_url TEXT NOT NULL,
  evidence_status TEXT NOT NULL CHECK (
    evidence_status IN ('published_general', 'published_regional_hypothesis', 'engineering_guardrail')
  ),
  native_verified INTEGER NOT NULL DEFAULT 0 CHECK (native_verified IN (0, 1)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  priority INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_assamese_pronunciation_rules_enabled_priority
  ON assamese_pronunciation_rules(enabled, priority, rule_id);

INSERT OR IGNORE INTO assamese_pronunciation_rules
  (rule_id, title, dialect_scope, position_scope, guidance, examples, source_title, source_url, evidence_status, native_verified, enabled, priority)
VALUES
  (
    'assamese-sibilants-x-baseline',
    'Assamese শ, ষ, স baseline',
    'Assamese-wide baseline; lexical exceptions exist',
    'native Assamese words',
    'For Assamese-native words, শ, ষ and স generally correspond to the voiceless velar fricative /x/ (the consonant-like sound heard in Scottish “loch”), not automatically to an ordinary English /s/ or Bengali-like /ʃ/. Treat this as a phonological baseline, not a spelling-to-sound replacement rule: some borrowed words and individual lexical items differ.',
    'Do not pronounce Assamese শ/ষ/স using English letter names; preserve the actual word and context.',
    'Government of Assam / BIS, Assamese Phonology and Vocabulary (ISO 10646 proposal)',
    'https://www.unicode.org/wg2/docs/n4947-Proposal_AssameseScript_ISO10646%20-%20V1.pdf',
    'published_general',
    0,
    1,
    10
  ),
  (
    'eastern-initial-x-h-variation',
    'Word-initial /x/ may surface as [h] in a regional variety',
    'Eastern Assamese; candidate variant to evaluate for Upper Assam',
    'word-initial',
    'A published study of Assamese allophonic variation reports that /x/ may be realized [h] word-initially in particular words and speakers. The paper gives /xɔdai/ → [hɔdai] (“every day”) as an example. Allow this as a possible local realization when natural; do not force [h] on every word or every speaker.',
    '/xɔdai/ → [hɔdai] (“every day”) is a reported example, not a universal prescription.',
    'Das and Deka, The Allophonic Variation of the Assamese Voiceless Velar Fricative /x/ (ICOSAL 13, 2018)',
    'https://www.academia.edu/35777293/The_Allophonic_Variation_of_the_Assamese_voiceless_velar_fricative_x',
    'published_regional_hypothesis',
    0,
    1,
    20
  ),
  (
    'assamese-x-position-guardrail',
    'Do not generalize the initial [h] variant to every position',
    'Dialect- and speaker-dependent Assamese varieties',
    'medial, final and lexical exceptions',
    'Realization of /x/ varies with word position, lexical item, region and speaker. Do not convert every /x/ to [h], and do not infer pronunciation from the Roman letter alone. When the word-specific Upper Assam realization is uncertain, keep the Assamese /x/ baseline rather than inventing a hard substitution.',
    'A word-initial [h] example does not establish the pronunciation of medial or final /x/ in a different word.',
    'Das and Deka, The Allophonic Variation of the Assamese Voiceless Velar Fricative /x/ (ICOSAL 13, 2018)',
    'https://www.academia.edu/35777293/The_Allophonic_Variation_of_the_Assamese_voiceless_velar_fricative_x',
    'published_regional_hypothesis',
    0,
    1,
    30
  ),
  (
    'assamese-english-code-switching-guardrail',
    'Protect English pronunciation in mixed Assamese-English speech',
    'Assamese-English code-switching',
    'English words and phrases',
    'During Assamese-English code-switching, retain conventional English pronunciation for English words such as “study”, “system” and “seriously”. Never change each Roman “s” to “h”; apply Assamese sound patterns only when the intended word is Assamese.',
    'Negative control: “I am studying the system seriously” keeps the English /s/ sounds.',
    'AskMoina Voice product guardrail; synthetic negative control',
    'https://github.com/ashini-x/askmoina-voice',
    'engineering_guardrail',
    0,
    1,
    40
  ),
  (
    'romanized-assamese-not-letter-substitution',
    'Interpret Romanized Assamese by word identity, not single letters',
    'Romanized Assamese and mixed-script chat',
    'whole word and context',
    'Romanized Assamese spelling is inconsistent. Infer the intended Assamese word from context; do not use raw Roman “s”, “x” or “h” as a mechanical substitution rule. If unsure, use the Assamese-native phonological baseline and avoid an overconfident dialect claim.',
    'Do not transform every Romanized s into h.',
    'AskMoina Voice product guardrail; synthetic negative control',
    'https://github.com/ashini-x/askmoina-voice',
    'engineering_guardrail',
    0,
    1,
    50
  );
