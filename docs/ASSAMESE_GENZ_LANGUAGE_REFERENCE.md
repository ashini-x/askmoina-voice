# M2 — Assamese-English conversation reference

**Status:** Data model, review gates and fail-open runtime reader are implemented. The seed corpus is intentionally disabled pending local review.  
**Scope:** Additive M0–M9 initiative; this does not renumber the older M1–M40 engineering roadmap.

## What was added

- A D1 reference table for conversational examples and response patterns, with intent, language mode, dialect scope, register, context, sample user line, candidate response, usage guidance and situations to avoid.
- Provenance fields for the source title/URL, use permission, license/permission basis and attribution requirement.
- A separate review table using pseudonymous reviewer codes rather than reviewer names or recordings.
- A database view that exposes an entry to runtime only when it is enabled, rights are confirmed, it is marked native-verified, its status is approved, and **two distinct native-speaker reviewers have approved it**.
- A bounded live-session reader that adds only eligible reference examples to the system instruction. Missing migrations, failed queries and empty corpora return no appendix and do not prevent session setup.
- Initial internal entries taken from existing AskMoina instructions and its own synthetic speech evaluation scenarios. They are marked `native_review_pending`, `native_verified = 0`, and `enabled = 0`. They do not enter live prompts.

## What was deliberately not done

No third-party audio or text dataset was downloaded, copied or bundled. Publicly visible material is not automatically licensed for product use. The current seed uses existing internal project text and carries explicit source metadata. Any external entry must document its license, permitted use, attribution requirement and evidence source before it can be approved.

The initial phrases are drafts, not claims about a community-wide or universal Upper Assam dialect. The existing system-instruction examples remain unchanged as baseline behavior; the new database corpus cannot change runtime behavior until it passes the explicit review gate.

## Review and activation procedure

1. Check each entry's source and use permission. Do not enable an entry with ambiguous rights.
2. Have **two different Assamese native speakers** review the exact wording, intent, register and regional fit. For Upper Assam-labelled examples, both must be comfortable judging that regional style. Mark disputed variants as variants, not errors by default.
3. Store distinct pseudonymous reviewer codes, broad locality scope only, decision and a brief non-identifying note in `assamese_conversation_reference_reviews`. Do not store names, personal phone numbers, audio or transcripts from private conversations.
4. Only after two native reviewers approve, update the entry to `review_status = 'approved'`, `native_verified = 1`, `rights_confirmed = 1`, and `enabled = 1`. The runtime view independently checks the review records, so a flag alone cannot make a single-reviewed entry eligible.
5. Re-run the existing 15-case `docs/benchmarks/assamese-speech-v1.json` suite and compare actual audio in a private review. Never treat SQL validation or a green build as proof of natural speech.

## Acceptance limits

M2 delivers the permission-aware reference mechanism and a reviewable starter set. It is **not** evidence that the local phrases are native-approved, that Gemini Live has been trained or fine-tuned, or that pronunciation quality has improved. No new entry is active until native review and rights checks pass.

See [the existing source and licensing audit](UPPER_ASSAM_PRONUNCIATION_DATA_AUDIT.md) for decisions about outside Assamese speech resources.
