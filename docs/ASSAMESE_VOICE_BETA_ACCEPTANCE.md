# Assamese Voice Beta: Acceptance Plan

This plan is the release gate for the first small-user beta of AskMoina Voice in Upper Assam. It is not evidence that these tests have passed.

## Release order

1. Confirm production health and configuration.
2. Run voice, limit, privacy, and recovery checks on real devices.
3. Run a small Assamese-language evaluation with consenting local speakers.
4. Fix the highest-frequency failures and repeat the checks.
5. Invite a small pilot group only after the release gate below is met.

## Manual production checks

- Open the production site on Android Chrome and desktop Chrome; confirm the microphone permission flow is understandable.
- Complete a short voice session, end it normally, then start a second session.
- Refresh during a session and confirm the old connection releases its reservation.
- Open two tabs on the same network and confirm the configured concurrent-session limit is enforced.
- Check `/api/voice/status` before and after a session; it should return a sensible availability result and never expose credentials.
- Verify a session ends at its configured duration limit.
- With memory personalization disabled, confirm saved memory text is not included in the session setup.
- With personalization enabled, select a harmless test note and confirm only that selected context is used; disable it and confirm it is no longer sent on the next session.
- Lock the vault and verify the local memory context is cleared.
- Verify that an invalid cross-origin WebSocket request is rejected.
- Confirm the operations dashboard requires authentication and does not display audio, transcripts, or memory plaintext.

## Assamese language evaluation

Recruit consenting Assamese speakers from more than one Upper Assam locality. Do not collect names or recordings unless separately consented to and genuinely needed. A reviewer can score each test live without retaining audio.

For each scenario, record: understood correctly (yes/no), response language appropriate (yes/no), factual/helpfulness score (1–5), and failure notes.

- Everyday Assamese greeting and open-ended conversation.
- Assamese with English words mixed naturally in the same sentence.
- Casual Gen-Z-style Assamese-English chat: for example, a user says "Aji mood tu bhal nai yaar" or "Honestly, exam tu loi tension hoi ase"; check that Moina sounds conversational rather than formal/textbook, mirrors the user's mix, and does not force slang.
- Switch from an Assamese-English mix to English and back; check that the assistant follows smoothly without translating everything into formal Assamese.
- Positive social reaction: share a small win and see whether the audio sounds genuinely pleased, with a subtle audible laugh/chuckle only if it fits.
- Light playful moment: use a harmless joke; check whether a brief audible chuckle can be heard in the audio itself, not the literal word/tag "[laugh]".
- Empathetic moment: mention ordinary frustration; check for a soft sigh/exhale or warmer, quieter delivery when it fits. Also confirm that sounds are not inserted mechanically and never appear during grief, fear, or serious topics.
- Local place names and common regional expressions.
- A request to repeat or explain something more simply.
- A noisy-room or slower-network session.
- User switches from Assamese to English and back.
- An ambiguous question: assistant asks a clarifying question rather than inventing details.
- A local scheme, job, or education question: assistant distinguishes verified information from uncertainty and directs the user to an official source when appropriate.

Do not claim the system understands every dialect until testing supports that claim.

## Pilot release gate

Proceed to a small pilot only when:

- TypeScript checks and automated tests pass on the exact release commit.
- The deployed Worker version and source commit are recorded and match the intended release.
- No known critical security or quota-bypass issue remains open.
- Voice session creation, normal close, timeout, reconnect, and quota enforcement have been manually verified.
- Memory opt-in, opt-out, lock, and deletion have been verified.
- Testers can complete core tasks on the target mobile devices without a blocking issue.
- A process exists to report failures, disable access if needed, and monitor provider spending.

A successful deployment or health endpoint alone does not satisfy this gate.


## Live expression limitation

AskMoina currently uses Gemini Live for direct real-time audio-to-audio conversation, not a scripted Gemini TTS transcript. Instructions can encourage laughter, sighs, breaths and expressive prosody, but prompt wording cannot guarantee that every non-speech sound will be generated on every turn. The bracketed/inline vocal tags documented for Gemini TTS are not a control interface that can simply be dropped into this Live audio stream. If reliable, deliberately placed tags are a hard product requirement, evaluate a separate Live-to-TTS cascade as a distinct architecture experiment and measure its added latency and turn-taking trade-offs before replacing the current path.


## Pronunciation-reference prototype

- Apply migration `0004_assamese_pronunciation_rules.sql` in the target D1 database before expecting the reference to be included in Live session instructions.
- Synthetic checks cover the documented Assamese /x/ baseline, conditional word-initial [h] variation, non-globalization, English pronunciation negative controls, Romanized text ambiguity, and graceful fallback if the table is unavailable.
- These synthetic tests validate rule plumbing only. They are not an audio quality test. Use the source audit in `docs/UPPER_ASSAM_PRONUNCIATION_DATA_AUDIT.md` and complete native-speaker audio evaluation before claiming the Upper Assam accent is correct.
