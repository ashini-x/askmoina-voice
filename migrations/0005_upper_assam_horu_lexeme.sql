-- Word-specific Upper Assam preference supplied through AskMoina listening feedback.
-- This is a narrowly scoped target for this product, not a universal Assamese spelling/pronunciation claim.
INSERT OR IGNORE INTO assamese_pronunciation_rules
  (rule_id, title, dialect_scope, position_scope, guidance, examples, source_title, source_url, evidence_status, native_verified, enabled, priority)
VALUES
  (
    'upper-assam-horu-small-lexeme',
    'Word-specific Upper Assam target: সৰু (“small”) closer to “horu”',
    'User-reported Upper Assam preference; only this lexeme',
    'Assamese word meaning small',
    'For the Assamese word সৰু meaning “small”, the product tester reports a preferred Upper Assam target closer to “horu” [hɔru], not “soru/xoru”. Follow this exact word-specific target in the user preferred Upper Assam style; this is listener-reported and not an independently established community-wide norm. Do not generalize h for s/x to other words, and preserve conventional English pronunciation in English words.',
    'User listening correction: Assamese সৰু (“small”) → target audio closer to “horu”; preserve English sounds in English words.',
    'AskMoina Voice listener feedback (2026-10-10; user-reported target, not independent dataset)',
    'https://github.com/ashini-x/askmoina-voice',
    'engineering_guardrail',
    0,
    1,
    5
  );
