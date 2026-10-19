# M3 — Native conversational personality

**Implementation status:** Prompt contract and held-out score-only suite added.  
**Acceptance status:** Pending live-generated-audio evaluation by consenting Assamese listeners.  
**Scope:** Additive M0–M9 Assamese Gen-Z initiative; this does not replace or renumber M1–M40 or RC1–RC8.

## Runtime change

M3 adds a focused, testable personality contract to the live system instruction. It clarifies how AskMoina should adapt its response to the user's social intent and emotional context while preserving the existing Assamese-English language-matching, pronunciation, continuity, safety, and memory rules.

The contract aims for a relaxed, current, warm companion: not a meme persona or a checklist of stock phrases. It differentiates everyday venting, serious distress, good news, harmless banter, direct practical requests, corrections, interruptions, and explicit register changes. It also states that the assistant should not force slang, invent intimacy, claim human experiences, or end every turn with a question.

The change is instruction-only. It does not alter audio transport, provider configuration, microphone/VAD behavior, retrieval, or memory persistence. The existing M2 database reference remains disabled for its seed phrases until its own review gate has been satisfied.

## Default voice sound target

The default Live voice remains **Leda** (Google's voice descriptor is “Youthful”). The M3 sound target is a consistently youthful, distinctly high-register, bright/light voice with a childlike pitch impression around age 10, including across Assamese, English, and code-switched turns. This is a description of sound only; AskMoina remains an AI assistant and must not claim to be a child. Avoid a cartoon squeak, baby talk, harsh shrillness, and theatrical pitch jumps.

The Live API lets the app select a supported prebuilt voice and guide vocal tone through system instructions; it does not expose a direct numeric pitch/fundamental-frequency lock in the documented voice configuration. Therefore this change can strengthen consistency but cannot guarantee an exact age impression or identical pitch on every utterance. Confirm the actual sound by listening to the deployed audio at normal volume across short replies, longer replies, Assamese, English, and code-switching. Do not claim this target has passed until that listening check is complete.

## Held-out evaluation

`docs/benchmarks/assamese-personality-v1.json` contains 12 held-out prompts covering six dimensions. It uses the existing score-only benchmark workflow:

```sh
node scripts/reality-benchmark.mjs init personality /tmp/m3-personality-run.json
# Have consenting listeners score the generated audio privately.
node scripts/reality-benchmark.mjs score personality /tmp/m3-personality-run.json
```

Each criterion is rated 0–2. The target is at least 85% overall, at least 10 completed cases, all configured dimension thresholds met, and zero critical failures. A perfect synthetic template in a unit test only tests the scorer; it is not a real acceptance result.

## Owner listen-back samples

The production deployment workflow can capture three short, synthetic-text responses from the deployed Live voice as temporary WAV artifacts for owner listen-back: an English greeting, a gentle Assamese-English reply, and an Assamese-English celebration. The workflow retains these generated sample WAVs for one day only when capture succeeds. It does not save the synthetic input audio, prompts, transcripts, or session cookies. These samples help inspect the actual vocal sound, but they are not a substitute for the held-out two-listener M3 acceptance evaluation.

## Native listening protocol

1. Use the deployed live voice experience with the held-out prompts in a private session.
2. Have at least two consenting Assamese speakers rate the same generated responses independently. For claims about a specific local register, use evaluators comfortable with that local context.
3. Score the actual audio for conversational naturalness, emotional calibration, natural code-switching, turn-taking, register control, respectful correction, and consistency of the youthful high-register voice target across languages and turn lengths.
4. Record only a non-identifying evaluator code, case ratings, critical-failure markers, and a brief non-identifying note. Do not save audio or transcripts by default.
5. Compare disagreements rather than forcing regional consensus; a preference from one listener is not a universal dialect rule.
6. If the thresholds fail, revise the contract and rerun the same held-out suite. Do not mark M3 accepted based only on TypeScript, unit tests, or a successful deployment.

## Known boundary

Prompt instructions can guide but cannot guarantee model behavior. The suite intentionally avoids treating one exact phrase as the only correct answer. M3 remains pending until real audio has been listened to and the score-only report passes.
