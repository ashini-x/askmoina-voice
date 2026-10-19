-- M1/M2: explicit, auditable owner override. This is NOT represented as two native-speaker reviews.
ALTER TABLE assamese_conversation_reference
  ADD COLUMN admin_override INTEGER NOT NULL DEFAULT 0 CHECK (admin_override IN (0, 1));
ALTER TABLE assamese_conversation_reference
  ADD COLUMN admin_override_by TEXT NOT NULL DEFAULT '' CHECK (length(admin_override_by) <= 80);
ALTER TABLE assamese_conversation_reference
  ADD COLUMN admin_override_at TEXT NOT NULL DEFAULT '' CHECK (length(admin_override_at) <= 40);
ALTER TABLE assamese_conversation_reference
  ADD COLUMN admin_override_reason TEXT NOT NULL DEFAULT '' CHECK (length(admin_override_reason) <= 500);

ALTER TABLE assamese_speech_review_runs
  ADD COLUMN admin_override INTEGER NOT NULL DEFAULT 0 CHECK (admin_override IN (0, 1));
ALTER TABLE assamese_speech_review_runs
  ADD COLUMN override_reason TEXT NOT NULL DEFAULT '' CHECK (length(override_reason) <= 500);

DROP VIEW IF EXISTS assamese_conversation_reference_eligible;
CREATE VIEW assamese_conversation_reference_eligible AS
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
  e.admin_override,
  e.admin_override_by,
  e.admin_override_at,
  e.admin_override_reason,
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
  AND length(trim(e.response_example)) > 0
  AND (
    e.admin_override = 1
    OR (
      SELECT COUNT(DISTINCT r.reviewer_code)
      FROM assamese_conversation_reference_reviews r
      WHERE r.entry_id = e.entry_id
        AND r.reviewer_type = 'native_speaker'
        AND r.decision = 'approved'
    ) >= 2
  );
