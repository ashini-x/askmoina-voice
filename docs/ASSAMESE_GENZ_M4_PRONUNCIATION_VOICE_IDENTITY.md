# M4 — Pronunciation and voice identity

**Implementation status:** Pronunciation behavior contract, safe Live-voice configuration allowlist, score-only pronunciation/voice suites, and an expanded private audition script are implemented.  
**Acceptance status:** Pending native-listener audio scores; no new production voice has been selected.  
**Scope:** Additive M0–M9 Assamese Gen-Z initiative. This does not replace or renumber M1–M40 or RC1–RC8.

## Runtime behavior

- Add explicit guidance for exact-word pronunciation corrections, preserving conventional English pronunciation during code-switching, repeat/slow requests, Romanized Assamese ambiguity, and uncertainty.
- A listener's correction is scoped to the identified word. The existing listener-reported target for Assamese সৰু (“small”) closer to “horu” must not be generalized to other words or claimed as a universal Upper Assam rule.
- Treat the D1 pronunciation reference as attributed candidate data. Unverified rules are not community-wide facts, and prompt text is not evidence that the voice actually produced the target sound.
- Validate configured Gemini Live voice names against the repository's supported prebuilt-voice allowlist. Unsupported or malformed configured names fall back to Leda rather than being sent as a provider voice name.
- Expand the admin-only Voice Audition Lab with one consistent eight-prompt script. Candidate selection in the lab remains temporary and does not modify the public production voice.

## Reproducible evaluation

### Word-level pronunciation

~~~sh
node scripts/reality-benchmark.mjs init pronunciation ./m4-pronunciation-run.json
# Listen to the generated audio and score each case privately.
node scripts/reality-benchmark.mjs score pronunciation ./m4-pronunciation-run.json
~~~

The 12-case suite covers the reported horu target for the exact word সৰু, English pronunciation as a negative control, mixed-language speech, corrections, repeat/slow behavior, formal register, ambiguity, and regional-humility guardrails.

### Voice identity audition

~~~sh
node scripts/reality-benchmark.mjs init voice ./m4-voice-leda.json Leda
# Repeat for each voice candidate, keeping the same eight prompts and listening conditions.
node scripts/reality-benchmark.mjs score voice ./m4-voice-leda.json
~~~

The voice suite contains all 30 prebuilt Live voice names currently listed in src/sessions/voice-config.ts. Create one score-only run per candidate. Its candidate_id binds the report to the voice being evaluated. Compare the actual audio on the same prompts; the provider's style descriptor is not a quality score.

## Acceptance gate

- At least two consenting Assamese listeners should independently score the generated audio. For a claim about Upper Assam fit, use listeners comfortable with that regional variety.
- Pronunciation suite: at least 10 completed cases, at least 85% overall, configured dimension thresholds met, and zero critical failures.
- Voice identity suite: all 8 cases scored for a candidate, at least 85% overall, configured dimension thresholds met, and zero critical failures.
- Keep the same test phrases, output volume, device, and approximate network conditions across candidates where practical. If one voice wins on English but fails on Assamese or code-switching, do not select it based on its English performance alone.
- Store only candidate voice name, non-identifying evaluator codes, ratings, critical-failure flags, and short non-identifying notes. Do not store or upload audio/transcripts by default.
- Leave the default production voice as Leda until the listening evidence is reviewed. No automated test or synthetic score template chooses the final voice.

## Release status and outstanding issues

M4 does not claim that pronunciation has been acoustically corrected or that voice identity has passed native review. Successful TypeScript/unit tests validate the contract and scorer, not generated voice quality.

The M3 production synthetic run deployed successfully but its final live-verification step failed: grounded web search closed the Live WebSocket, the speech-first test timed out, and voice memory timed out waiting for a completed reply. The ranked-list voice test passed on that run. Those failures remain separate runtime issues and are not represented as fixed by M4.
