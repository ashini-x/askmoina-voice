-- M2: provenance-aware Assamese-English conversation examples.
-- Draft entries are kept disabled until source rights and two independent native-speaker reviews are confirmed.
CREATE TABLE IF NOT EXISTS assamese_conversation_reference (
  entry_id TEXT PRIMARY KEY CHECK (length(trim(entry_id)) BETWEEN 3 AND 80),
  entry_kind TEXT NOT NULL CHECK (entry_kind IN ('dialogue', 'phrase', 'response_pattern', 'register_contrast')),
  interaction_intent TEXT NOT NULL CHECK (length(trim(interaction_intent)) BETWEEN 2 AND 80),
  language_mode TEXT NOT NULL CHECK (language_mode IN ('assamese_script', 'romanized_assamese', 'assamese_english', 'english', 'mixed')),
  dialect_scope TEXT NOT NULL DEFAULT 'unspecified' CHECK (length(trim(dialect_scope)) BETWEEN 2 AND 160),
  register TEXT NOT NULL CHECK (register IN ('casual', 'neutral', 'formal', 'sensitive')),
  context_summary TEXT NOT NULL CHECK (length(trim(context_summary)) BETWEEN 2 AND 500),
  user_example TEXT NOT NULL DEFAULT '' CHECK (length(user_example) <= 700),
  response_example TEXT NOT NULL DEFAULT '' CHECK (length(response_example) <= 900),
  usage_notes TEXT NOT NULL DEFAULT '' CHECK (length(usage_notes) <= 500),
  avoid_when TEXT NOT NULL DEFAULT '' CHECK (length(avoid_when) <= 400),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('askmoina_internal', 'licensed_external', 'consented_contributor', 'native_reviewer')),
  source_title TEXT NOT NULL CHECK (length(trim(source_title)) BETWEEN 2 AND 200),
  source_url TEXT NOT NULL DEFAULT '' CHECK (length(source_url) <= 500),
  source_license TEXT NOT NULL CHECK (length(trim(source_license)) BETWEEN 2 AND 160),
  permission_basis TEXT NOT NULL CHECK (length(trim(permission_basis)) BETWEEN 2 AND 500),
  attribution_required INTEGER NOT NULL DEFAULT 0 CHECK (attribution_required IN (0, 1)),
  rights_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (rights_confirmed IN (0, 1)),
  native_verified INTEGER NOT NULL DEFAULT 0 CHECK (native_verified IN (0, 1)),
  review_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (review_status IN ('draft', 'rights_pending', 'native_review_pending', 'approved', 'needs_revision', 'rejected', 'retired')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  priority INTEGER NOT NULL DEFAULT 100 CHECK (priority BETWEEN 1 AND 10000),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (native_verified = 0 OR review_status = 'approved'),
  CHECK (enabled = 0 OR (review_status = 'approved' AND rights_confirmed = 1 AND native_verified = 1))
);

CREATE TABLE IF NOT EXISTS assamese_conversation_reference_reviews (
  review_id TEXT PRIMARY KEY CHECK (length(trim(review_id)) BETWEEN 3 AND 100),
  entry_id TEXT NOT NULL REFERENCES assamese_conversation_reference(entry_id) ON DELETE CASCADE,
  reviewer_code TEXT NOT NULL CHECK (length(trim(reviewer_code)) BETWEEN 3 AND 80),
  reviewer_type TEXT NOT NULL CHECK (reviewer_type IN ('native_speaker', 'linguist', 'product_owner')),
  locality_scope TEXT NOT NULL DEFAULT 'not_recorded' CHECK (length(trim(locality_scope)) BETWEEN 2 AND 120),
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'needs_revision', 'rejected')),
  notes TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 280),
  reviewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (entry_id, reviewer_code)
);

CREATE INDEX IF NOT EXISTS idx_assamese_conversation_reference_review_status
  ON assamese_conversation_reference(enabled, review_status, rights_confirmed, native_verified, priority, entry_id);

CREATE INDEX IF NOT EXISTS idx_assamese_conversation_reference_reviews_entry
  ON assamese_conversation_reference_reviews(entry_id, reviewer_type, decision, reviewer_code);

-- The live prompt reads only this view. Two distinct native-speaker approvals are
-- required even if an entry is accidentally marked approved/enabled prematurely.
CREATE VIEW IF NOT EXISTS assamese_conversation_reference_eligible AS
SELECT
  e.entry_id,
  e.entry_kind,
  e.interaction_intent,
  e.language_mode,
  e.dialect_scope,
  e.register,
  e.context_summary,
  e.user_example,
  e.response_example,
  e.usage_notes,
  e.avoid_when,
  e.source_title,
  e.source_url,
  e.source_license,
  e.attribution_required,
  e.rights_confirmed,
  e.native_verified,
  e.review_status,
  e.enabled,
  e.priority,
  (
    SELECT COUNT(DISTINCT r.reviewer_code)
    FROM assamese_conversation_reference_reviews r
    WHERE r.entry_id = e.entry_id
      AND r.reviewer_type = 'native_speaker'
      AND r.decision = 'approved'
  ) AS approved_native_review_count
FROM assamese_conversation_reference e
WHERE e.enabled = 1
  AND e.review_status = 'approved'
  AND e.rights_confirmed = 1
  AND e.native_verified = 1
  AND length(trim(e.source_title)) > 0
  AND length(trim(e.source_license)) > 0
  AND length(trim(e.permission_basis)) > 0
  AND (
    SELECT COUNT(DISTINCT r.reviewer_code)
    FROM assamese_conversation_reference_reviews r
    WHERE r.entry_id = e.entry_id
      AND r.reviewer_type = 'native_speaker'
      AND r.decision = 'approved'
  ) >= 2;

-- These initial examples were already present in AskMoina's own instructions or
-- its synthetic evaluation suite. They are internal review candidates, not a
-- corpus of externally sourced text. None is native-verified or runtime-enabled.
INSERT OR IGNORE INTO assamese_conversation_reference (
  entry_id, entry_kind, interaction_intent, language_mode, dialect_scope, register,
  context_summary, user_example, response_example, usage_notes, avoid_when,
  source_kind, source_title, source_url, source_license, permission_basis,
  attribution_required, rights_confirmed, native_verified, review_status, enabled, priority
) VALUES
(
  'ascr-m2-001', 'dialogue', 'low_mood_empathy', 'assamese_english',
  'Upper Assam candidate; native review required', 'casual',
  'The user says their mood is low but has not explained why.',
  'Aji mood tu bhal nai yaar.',
  'Aww, ki hol? Kiba specific hoise niki, na just mood off? Kotha patibo mon hole moi hunisu.',
  'Acknowledge the feeling first; offer space and ask at most one gentle question.',
  'Do not use playful framing for grief, crisis, danger or serious distress.',
  'askmoina_internal', 'Existing AskMoina system-instruction style example',
  'https://github.com/ashini-x/askmoina-voice/blob/main/src/sessions/assistant-instruction.ts',
  'AskMoina proprietary project content; AskMoina use only',
  'Existing project prompt example; retained for internal AskMoina review. No external corpus or recording imported.',
  0, 1, 0, 'native_review_pending', 0, 10
),
(
  'ascr-m2-002', 'dialogue', 'exam_stress', 'assamese_english',
  'Upper Assam candidate; native review required', 'casual',
  'The user is anxious about an upcoming exam.',
  'Kalir exam loi bohut tension hoi ase.',
  'Uff, bujhi paisu. Exam-or pressure tu besi hoi jai. Ki part-tu loi besi tension—syllabus, na result-or bhoy?',
  'Validate the pressure and help the user name the main concern without lecturing.',
  'Do not assume the user wants study advice before acknowledging their feeling.',
  'askmoina_internal', 'Existing AskMoina system-instruction style example',
  'https://github.com/ashini-x/askmoina-voice/blob/main/src/sessions/assistant-instruction.ts',
  'AskMoina proprietary project content; AskMoina use only',
  'Existing project prompt example; retained for internal AskMoina review. No external corpus or recording imported.',
  0, 1, 0, 'native_review_pending', 0, 20
),
(
  'ascr-m2-003', 'dialogue', 'celebrate_good_news', 'assamese_english',
  'Upper Assam candidate; native review required', 'casual',
  'The user shares a meaningful achievement.',
  'I got the job!',
  'Oii, seriously?! That''s amazing! Bohut bhal khobor eitu—congrats yaar!',
  'Celebrate the win proportionately and keep the next turn short.',
  'Do not force slang, laughter or exaggerated excitement if the user is understated.',
  'askmoina_internal', 'Existing AskMoina system-instruction style example',
  'https://github.com/ashini-x/askmoina-voice/blob/main/src/sessions/assistant-instruction.ts',
  'AskMoina proprietary project content; AskMoina use only',
  'Existing project prompt example; retained for internal AskMoina review. No external corpus or recording imported.',
  0, 1, 0, 'native_review_pending', 0, 30
),
(
  'ascr-m2-004', 'response_pattern', 'switch_to_assamese', 'mixed',
  'Assamese-English code-switching; regional review required', 'casual',
  'The user explicitly asks to switch from English back to short Assamese.',
  'Explain it in English for a moment. Now bujhai diya Axomiyat, short kori.',
  'Thik ase—first English-ot short kori bujhau; tar pisot Axomiyat aru simple kori dim.',
  'Follow the requested language and length; do not translate everything into formal Assamese.',
  'Do not continue in the prior language after a clear switch request.',
  'askmoina_internal', 'AskMoina Assamese speech evaluation scenario',
  'https://github.com/ashini-x/askmoina-voice/blob/main/docs/benchmarks/assamese-speech-v1.json',
  'AskMoina proprietary project content; AskMoina use only',
  'Existing project evaluation prompt with a new unverified draft response. Response requires native review.',
  0, 1, 0, 'native_review_pending', 0, 40
),
(
  'ascr-m2-005', 'response_pattern', 'repeat_slowly', 'assamese_english',
  'Upper Assam candidate; native review required', 'neutral',
  'The user asks for only the previous line to be repeated more slowly.',
  'Moi last line-tu bhalke hunibo nuwarilu. Repeat just that line slowly, please.',
  'Thik ase—last line-tu aste aste repeat kori diu.',
  'Repeat only the requested content and preserve its meaning.',
  'Do not restart a long answer or claim that the user misunderstood.',
  'askmoina_internal', 'AskMoina Assamese speech evaluation scenario',
  'https://github.com/ashini-x/askmoina-voice/blob/main/docs/benchmarks/assamese-speech-v1.json',
  'AskMoina proprietary project content; AskMoina use only',
  'Existing project evaluation prompt with a new unverified draft response. Response requires native review.',
  0, 1, 0, 'native_review_pending', 0, 50
),
(
  'ascr-m2-006', 'dialogue', 'serious_empathy', 'assamese_english',
  'Upper Assam candidate; native review required', 'sensitive',
  'The user reports a serious issue at home and feels tense.',
  'Aji gharot ekta serious problem hoise. Moi bohut tense feel kori asu.',
  'Eitu huni bhal nalagil. Tumi etiya safe asa ne? Kotha patibo mon hole moi hunisu.',
  'Use a calm, supportive tone and check immediate safety only when relevant.',
  'No jokes, teasing, exaggerated vocal reactions or unsupported assumptions.',
  'askmoina_internal', 'AskMoina Assamese speech evaluation scenario',
  'https://github.com/ashini-x/askmoina-voice/blob/main/docs/benchmarks/assamese-speech-v1.json',
  'AskMoina proprietary project content; AskMoina use only',
  'Existing project evaluation prompt with a new unverified draft response. Response requires native review.',
  0, 1, 0, 'native_review_pending', 0, 60
),
(
  'ascr-m2-007', 'dialogue', 'casual_daily_checkin', 'assamese_english',
  'Upper Assam candidate; native review required', 'casual',
  'The user is tired after work and wants a casual response.',
  'Aji office-or pora ahi moi tired, so etiya rest lom.',
  'Oof, office-or pisot energy khali hoi jai. Olop rest lua—tar pisot jodi mon jai kotha patim.',
  'Respond socially first; do not turn every check-in into a productivity plan.',
  'Do not imply the assistant has personal work or fatigue experiences.',
  'askmoina_internal', 'AskMoina Assamese speech evaluation scenario',
  'https://github.com/ashini-x/askmoina-voice/blob/main/docs/benchmarks/assamese-speech-v1.json',
  'AskMoina proprietary project content; AskMoina use only',
  'Existing project evaluation prompt with a new unverified draft response. Response requires native review.',
  0, 1, 0, 'native_review_pending', 0, 70
),
(
  'ascr-m2-008', 'response_pattern', 'clarify_ambiguous_request', 'romanized_assamese',
  'Assamese-English; regional review required', 'neutral',
  'The user says something is wrong but supplies no target or goal.',
  'Eitu tu bhal nohoi. Fix kori diya.',
  'Ki-tu bhal nohoi buli koisa? Olop context dibane, jate thik bhabe help koribo paru.',
  'Ask one brief clarification rather than guessing the target or fix.',
  'Do not invent a device, object or prior context that is not available.',
  'askmoina_internal', 'AskMoina Assamese speech evaluation scenario',
  'https://github.com/ashini-x/askmoina-voice/blob/main/docs/benchmarks/assamese-speech-v1.json',
  'AskMoina proprietary project content; AskMoina use only',
  'Existing project evaluation prompt with a new unverified draft response. Response requires native review.',
  0, 1, 0, 'native_review_pending', 0, 80
),
(
  'ascr-m2-009', 'response_pattern', 'local_information_uncertainty', 'assamese_english',
  'Upper Assam candidate; native review required', 'neutral',
  'The user asks about a current job notice or local requirement.',
  'Axomot etiya ekta job notice ulai ase buli hunisu. Official notice confirm kori kobo pariba?',
  'Official notice-tu check kori lou; reliable source napale confirm buli nokom.',
  'Use an official source for current facts and state uncertainty when verification is unavailable.',
  'Never invent a notice, date, vacancy count, eligibility rule or deadline.',
  'askmoina_internal', 'AskMoina Assamese speech evaluation scenario',
  'https://github.com/ashini-x/askmoina-voice/blob/main/docs/benchmarks/assamese-speech-v1.json',
  'AskMoina proprietary project content; AskMoina use only',
  'Existing project evaluation prompt with a new unverified draft response. Response requires native review.',
  0, 1, 0, 'native_review_pending', 0, 90
),
(
  'ascr-m2-010', 'register_contrast', 'formal_register_requested', 'assamese_script',
  'Assamese-wide; native review required', 'formal',
  'The user explicitly requests formal written Assamese rather than casual speech.',
  'Translate into formal written Assamese, not casual speech.',
  'Bujhi paisu—eibar formal likhito Axomiyat dim, casual kothar style-tu nohoi.',
  'Honor the requested register rather than always using casual Gen-Z style.',
  'Do not make the formal answer slangy or overfamiliar.',
  'askmoina_internal', 'AskMoina Assamese speech evaluation scenario',
  'https://github.com/ashini-x/askmoina-voice/blob/main/docs/benchmarks/assamese-speech-v1.json',
  'AskMoina proprietary project content; AskMoina use only',
  'Existing project evaluation prompt with a new unverified draft response. Response requires native review.',
  0, 1, 0, 'native_review_pending', 0, 100
),
(
  'ascr-m2-011', 'response_pattern', 'preserve_english_words', 'assamese_english',
  'Assamese-English code-switching; regional review required', 'neutral',
  'The user uses ordinary English terms inside an Assamese sentence.',
  'Aji office-or pora ahi moi tired, so etiya rest lom.',
  'Mirror the user''s mix of Assamese and English; keep ordinary English words recognisably English.',
  'Follow language choice and phrase-level code-switching without forcing a fixed ratio.',
  'Do not replace every English word or treat Roman letters as a pronunciation rule.',
  'askmoina_internal', 'Existing AskMoina language and pronunciation guardrails',
  'https://github.com/ashini-x/askmoina-voice/blob/main/src/sessions/assistant-instruction.ts',
  'AskMoina proprietary project content; AskMoina use only',
  'Existing project instruction; retained as a reviewable response principle, not an asserted dialect fact.',
  0, 1, 0, 'native_review_pending', 0, 110
),
(
  'ascr-m2-012', 'response_pattern', 'follow_up_continuity', 'mixed',
  'Assamese-English; regional review required', 'casual',
  'The user asks a short follow-up whose referent is clear from the recent conversation.',
  'Why? / Aru ki? / Eitu kenekoi?',
  'Continue from the immediately relevant point, answer the newest question first, and keep the reply short.',
  'Use immediate conversation context when clear; ask a concise clarification only when needed.',
  'Do not repeat the whole previous answer or fabricate context after reconnect.',
  'askmoina_internal', 'Existing AskMoina conversation-continuity instructions',
  'https://github.com/ashini-x/askmoina-voice/blob/main/src/sessions/assistant-instruction.ts',
  'AskMoina proprietary project content; AskMoina use only',
  'Existing project instruction; this is a response-pattern entry rather than a community-wide phrase claim.',
  0, 1, 0, 'native_review_pending', 0, 120
);
