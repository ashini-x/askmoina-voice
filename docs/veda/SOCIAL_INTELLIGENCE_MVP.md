# Project Veda — Social Intelligence MVP

**Status:** Scope locked for the first product slice; implementation not yet complete.  
**Repository:** `ashini-x/askmoina-voice`  
**Branch:** `feat/veda-social-intelligence-mvp`  
**Purpose:** Build one excellent capability before expanding Veda into a general-purpose hands-free assistant.

## Product promise

Veda helps its single authorized administrator follow a live, consented group conversation, retrieve relevant knowledge and personal context, and hear a brief, useful suggestion through an earbud at an appropriate pause. The goal is better understanding and more thoughtful contributions—not pretending to know things, dominating people, or producing constant commentary.

## In scope for this MVP

1. **Admin voice profile**
   - Enrol a voice sample only after an authenticated admin action and explicit confirmation.
   - Use voice matching as a probabilistic hint for diarization and turn attribution, never as the sole authentication or authorization factor.
   - Provide an explicit re-enrol/delete control and show confidence/unknown states rather than forcing a match.
   - Evaluate false matches and misses on representative samples before relying on the profile.

2. **Conversation mode with explicit controls**
   - Admin must explicitly arm and disarm the session; show a clear active-listening state and Android microphone notification.
   - Make it clear to nearby participants that an AI assistant is processing the discussion and provide a straightforward way to pause/stop.
   - No covert/background capture. Do not transmit audio while disarmed. No raw audio persistence by default.
   - Keep transcripts and conversation state transient unless the admin deliberately saves a reviewed memory; implement deletion and retention controls.

3. **Group conversation understanding**
   - Separate speaker turns and label unknown participants neutrally (Speaker A/B); do not infer real identities from voice alone.
   - Track current topic, claims, questions, points of disagreement, unresolved items, and confidence.
   - Treat transcription, speaker attribution, and inferred intent as uncertain; do not state guesses as facts.

4. **Insight engine**
   - Generate candidate insights from the live discussion, relevant admin-approved memories, and grounded retrieval when factual freshness matters.
   - Candidate types: concise context reminder, clarifying question, useful example, respectful counterpoint, or factual correction with grounding.
   - Do not fabricate personal memories, expertise, quotes, or sources. If confidence is insufficient, remain silent.

5. **Whisper Controller**
   - It is the only component allowed to send unsolicited audio to the admin.
   - Prioritize usefulness, confidence, timing, brevity, and non-repetition; respect a cooldown and suppress stale/topic-obsolete suggestions.
   - Wait for natural pauses; stop/cancel playback immediately when the admin begins speaking or manually interrupts.
   - Direct user requests take priority. Silence is a valid and often preferred outcome.
   - Output only to the admin's selected audio route, never to the room speaker by default.

6. **Language and delivery**
   - Start with English and natural Assamese-English code-switching; evaluate Upper Assam phrasing with the admin.
   - Whispers should normally be one short sentence, not a lecture or continuous narration.
   - Include a quick repeat/skip/stop interaction; no full chat UI is required during a conversation.

7. **Operational isolation**
   - Keep Veda server-side admin authorization, separate Veda D1/state, and `VEDA_ENABLED=false` until safety and acceptance gates pass.
   - Do not change AskMoina's default voice, memory, camera, chess, or consumer routes.
   - Keep diagnostics separate and avoid logging raw audio or full transcript content.

## Explicitly out of scope for this MVP

- WhatsApp document delivery, PDF generation, general task automation, Maps/music/calendar actions, broad connector framework, public sign-up, multi-user product support, visual/camera intelligence, and an always-on wake word.
- Do not build a second generic voice chatbot. Do not enable 24/7 listening.
- Do not add identity recognition for other participants by default; anonymous speaker labels are enough for the first version.

## Architecture sketch

```text
Admin-authenticated Veda control
  -> explicit Arm / Disarm + visible listening state
  -> Android audio capture / OS-required foreground service
  -> transient audio pipeline
       -> speech recognition + turn segmentation
       -> probabilistic admin-voice match + anonymous speaker labels
       -> conversation-state tracker
       -> retrieval from approved memory / grounded sources
       -> candidate insight generator
  -> Whisper Controller (sole output gate)
  -> private earbud output
```

The Android capture/runtime is a separate technical dependency from the intelligence logic. A PWA alone must not be assumed to provide reliable screen-off microphone operation. Validate the current device/browser path; if it fails, implement the minimum native Android foreground-service shell needed for dependable capture and earbud routing.

## Implementation slices

### SI-0 — Code and device feasibility audit
- Re-read current Veda routes, portal, auth, D1 schema, Durable Object, Live relay, session-resumption utilities, and CI.
- Confirm what audio transcription/diarization facilities are actually available; do not assume Gemini Live provides stable named speaker identity.
- Verify Android screen-off capture and Bluetooth output on the target device.
- Record the baseline CI and production route state. No runtime enablement.

### SI-1 — Isolated domain model and contract tests
- Add Veda-only types/state for listening status, transient conversation turns, speaker labels, admin voice profile metadata, candidate insights, delivery status, expiry, and cancellation.
- Add tests for admin authorization, explicit arm/disarm, stale command rejection, privacy defaults, and the no-audio-when-disarmed invariant.
- Persist profile metadata only with explicit enrolment; never store raw enrolment audio unless separately justified and consented.

### SI-2 — Admin voice profile and turn attribution
- Add enrol/delete/replace flow and calibrated match thresholds.
- Test with the admin and non-admin speakers, noise, overlap, and Bluetooth/phone microphones.
- Unknown or low-confidence speech remains unattributed; voice matching never authorizes access.

### SI-3 — Conversation tracker and candidate insights
- Track short-lived topic/turn state and generate structured candidate insights with evidence, confidence, expiry, and type.
- Ground external factual corrections and clearly distinguish recalled personal context from general knowledge.
- Add synthetic group-discussion fixtures and adversarial tests for ambiguous claims, speaker swaps, and hallucinated memory.

### SI-4 — Whisper Controller
- Enforce a single output gate, cooldown, priority, stale-insight cancellation, interruption handling, and direct-request priority.
- Add deterministic tests proving no unsolicited whisper is emitted for low-confidence, duplicate, stale, or unsafe candidates.

### SI-5 — Private pilot and release gate
- Run an opt-in pilot with the admin and informed participants.
- Measure admin-speaker attribution precision/recall, suggestion usefulness, false/unsupported suggestions, interruption rate, p50/p95 time-to-whisper, battery impact, and session recovery.
- Keep runtime disabled until all privacy, authorization, reliability, and usefulness gates are passed and the admin explicitly approves pilot activation.

## Initial acceptance gates (targets to validate, not claimed results)

- No capture or upstream audio transmission while disarmed.
- No raw conversation audio retained by default; saved memory is deliberate and reviewable.
- No voice match can authenticate or elevate privileges.
- At least 95% precision for identifying the admin's turns on the agreed pilot test set; report recall separately and do not hide failures.
- At least 90% of delivered whispers judged relevant/useful by the admin on a blinded review set; report the denominator and all rejected/incorrect suggestions.
- Zero duplicate/stale whispers in automated controller tests; immediate cancellation on interruption in device tests.
- Measure latency and battery on actual target hardware; do not promise a latency target before baseline measurements.
- AskMoina regression tests pass, and Veda stays disabled in production until an explicit activation gate.

## Decision rule

Ship the smallest vertical slice that proves the whole loop—admin voice hint -> group context -> useful candidate -> well-timed private whisper—rather than building every possible tool. If voice attribution or whisper timing is unreliable, fall back to anonymous speaker turns and admin-requested suggestions instead of pretending the capability works.
