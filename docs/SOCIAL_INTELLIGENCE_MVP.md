# AskMoina Voice — Social Intelligence MVP

**Product decision (2026-10-21):** Social intelligence is the primary AskMoina Voice experience. Existing camera/visual assistance remains available as a secondary mode and must not be removed or regressed. Do not build a separate Veda product, route, PWA identity, or parallel user experience for this capability.

## Product promise

When the administrator/user explicitly starts a conversation session, AskMoina helps follow a live, consented group discussion, understand the current topic, retrieve relevant context, and deliver a short, useful private suggestion through the selected earbud at a natural pause.

## Reuse the existing AskMoina structure

- Existing application shell, sign-in/account, voice infrastructure, Vertex/Gemini transport, conversation history and deployment workflow.
- Existing camera mode remains available as a separate capability.
- Keep implementation in the normal AskMoina source tree and UI; no new Veda route or standalone PWA.
- Do not introduce another model credential setup or duplicate general-purpose voice stack.
- Use existing persistence only for data that is explicitly meant to persist. Live group audio/transcripts should be transient by default.

## MVP vertical slice

1. Explicit conversation mode with visible active state, immediate Stop, no capture/transmission while disarmed, and a clear participant notice/consent path.
2. Optional admin voice enrolment for probabilistic speaker attribution. Voice matching is never authentication; unknown speakers remain anonymous labels.
3. Short-lived group context: speaker turns, current topic, claims, questions, unresolved points, and uncertainty.
4. Insight generation: context reminder, clarifying question, useful example, respectful counterpoint, or grounded correction. Never fabricate memory or evidence.
5. A deterministic Whisper Controller is the sole route for unsolicited speech. It prioritizes relevance, confidence, freshness, natural pauses, cooldown, and cancellation; direct requests and user speech take priority. Silence is valid.
6. Earbud-first output and natural English / Upper Assamese-English phrasing, tested with the user.
7. Preserve the existing camera feature and regression-test it.

## Not in this MVP

WhatsApp delivery, PDF generation, Maps/music/calendar actions, a general connector framework, always-on wake word, covert recording, public multi-user product expansion, and a separate Veda PWA/route.

## Implementation slices

- SI-0: Audit existing AskMoina auth, Live session, speech/audio, history, native wrapper, and Android background behavior; confirm exact reusable components and device constraints.
- SI-1: Integrate deterministic whisper policy into the existing source/test conventions.
- SI-2: Add explicit conversation mode controls and transient state to the existing UI.
- SI-3: Add admin voice enrolment and speaker-turn attribution with confidence/unknown handling.
- SI-4: Add rolling conversation tracker and grounded insight candidates.
- SI-5: Route all ambient suggestions through Whisper Controller and private audio output.
- SI-6: Real Android/earbud pilot, performance and usefulness evaluation, camera/voice/history regression, and staged release.

## Privacy and reliability rules

- Explicit arm/disarm; show OS microphone state; never claim screen-off capture works until verified on actual device.
- Clear notice and consent for group conversation processing; no covert capture.
- Do not retain raw audio by default. Live transcript/context remains transient unless the user deliberately saves a reviewed memory.
- Voice signature cannot authenticate the user or elevate privileges.
- Stop playback and clear queued audio on user speech, Stop, disconnect, or topic obsolescence.
- No stale, duplicate, low-confidence or unsupported whispers.
- Do not log raw audio or sensitive transcript contents.
- Keep camera functionality intact.

## Acceptance gates (targets, not claimed results)

- No capture or upstream audio while disarmed.
- Voice profile is never an authorization factor.
- At least 95% admin-turn precision on a defined pilot set, with recall reported separately.
- At least 90% of delivered whispers rated useful/relevant on a reviewed test set; include the denominator and incorrect outputs.
- Automated tests prove no duplicate/stale whisper and cancellation on interruption.
- Measure actual device latency, battery impact and screen-off reliability; do not invent guarantees.
- Existing AskMoina camera, voice, auth, history and deployment regression suites pass before rollout.

## Release rule

Implement one vertical slice in AskMoina's original structure. Do not enable ambient listening in production until code review, CI, privacy checks and real-device validation pass. Report the exact user action needed if Android installation, microphone permissions, Bluetooth routing or on-device testing cannot be performed remotely.
