# AskMoina Voice — Final Social Intelligence Roadmap

**Decision locked: 2026-10-21**

AskMoina's primary experience becomes a screen-free social-intelligence copilot. The existing camera/visual assistant stays inside AskMoina as a secondary capability and must not regress. Implement in the normal AskMoina source tree and existing infrastructure; do not build or extend a separate Veda product, route, PWA, or parallel application.

## Product promise

AskMoina should be available through earbuds, understand a live consented conversation, recall relevant context, and whisper a short useful suggestion at the right moment. It should feel instant, remain quiet when there is nothing useful to say, and avoid unnecessary model/audio usage.

## Critical architecture decision: local wake detection + warm Gemini session

The target standby model is:

1. The user explicitly enables standby and grants microphone permission.
2. A lightweight local wake-word detector listens on-device for a chosen phrase (initial candidate: “Hey Moina”). It does not upload standby microphone audio.
3. Where supported and verified, AskMoina keeps the existing Gemini Live WebSocket warm, but **does not send microphone frames to Gemini while in standby**. Assistant output is locally muted/suppressed in standby.
4. On local wake-word detection, the client unmutes assistant output, opens the upstream audio gate, and begins active live input on the existing session when it is still valid.
5. If the socket has expired or been closed, the client resumes/reconnects using AskMoina's existing session-resumption logic and recent context. Wake-up must not wait on an assumption that an old socket is still alive.
6. After an explicit stop or configured idle transition, input is gated again, pending whispers are cancelled, and the app returns to standby only if standby was deliberately enabled. Otherwise it becomes fully disarmed.

**Important distinction:** muting playback alone does not cut input cost. The cost/privacy gate is that standby audio remains local and no standby audio frames are sent to Gemini. A warm WebSocket does not guarantee unlimited connection life: Gemini Live documents a connection length of about 10 minutes and supports session resumption; the app must handle reconnects. Billing is token-based, so do not assume that a permanently connected socket is always free or immortal. Measure real standby cost and wake latency against disconnect-and-reconnect fallback. See [Live API best practices](https://ai.google.dev/gemini-api/docs/live-api/best-practices) and [session management](https://ai.google.dev/gemini-api/docs/live-api/session-management).

This architecture is the target, not a claim that the current app already supports reliable warm standby or screen-off capture. Those must be proved on the target Android device. Browser/PWA lifecycle restrictions may require a native Android foreground-service implementation for background microphone use. Do not start a hidden/always-on session without clear user enablement, visible status, OS permission and appropriate participant notice.

## Product invariants

- One AskMoina product: reuse existing authentication, voice/live transport, Vertex/Gemini integration, conversation history, routing, and deployment.
- Camera feature remains available and is regression-tested.
- Wake-word detection runs locally; standby audio is not streamed upstream.
- Explicit opt-in to standby and explicit stop/disarm control.
- Visible, truthful microphone/standby/active status; no covert recording.
- Participant notice/consent before processing a group conversation.
- Voice signature can support probabilistic turn attribution, never authentication or privilege elevation.
- Unknown speakers remain anonymous labels; do not infer identities without consent.
- Do not retain raw audio by default. Live transcript/context is transient unless the user deliberately saves reviewed information.
- A deterministic Whisper Controller is the sole route for unsolicited suggestions.
- Private earbud output by default; fail safely if the route becomes unavailable.
- User speech, stop, stale context, topic changes and disconnects cancel or suppress pending whispers.
- Prefer silence to unsupported, stale, duplicate, weak, badly timed or intrusive output.
- No WhatsApp delivery, PDF generation, Maps/music/calendar actions, general connector framework, or separate Veda PWA in this MVP.

## Final milestones

### M0 — Repository audit and implementation map

**Purpose:** establish actual integration points before changing the runtime.

- Trace the existing AskMoina authenticated user flow, primary UI, camera mode, microphone capture, audio worklet/encoding, /api/voice/socket, Live Session Relay, Vertex/Gemini setup and output playback.
- Trace session resumption, provider rotation, context compression, turn interruption, user history/memory, auth boundaries, feature/config flags and deployment tests.
- Inspect current PWA/Android installation and microphone lifecycle; distinguish what the browser supports from what needs a native Android foreground service.
- Identify where microphone input can be gated before the existing upstream sender and where output can be locally muted without creating parallel sockets.
- Record baseline latency, reconnect behaviour and camera regression tests.

**Deliverables:** real source-file map, reuse/change table, device constraints, test plan and implementation sequence.

**Done when:** the path from device microphone to Gemini and from Gemini response to earbuds has been verified against source, not assumed from UI labels.

### M1 — Whisper Controller and deterministic policy

**Purpose:** prevent a generated suggestion from speaking unless it is relevant, grounded and safe to deliver.

- Keep a typed candidate schema containing text, kind, provenance, confidence, relevance, topic, creation/expiry and unique ID.
- Gate on armed session, confirmed participant notice, valid private output, user not speaking, no higher-priority direct request, freshness, confidence/relevance, current topic, duplicate status and cooldown.
- Reject missing/invalid fields and default to silence on failure.
- Provide immediate cancellation for Stop, disarm, user speech, route loss, disconnect and stale topic.
- Test allow/reject reasons and verify that caller state cannot accidentally bypass policy.

**Done when:** unit tests pass and runtime playback has exactly one policy gate. A pure helper without runtime wiring is not completion.

### M2 — Local Wake-Up Detector and warm-session controller

**Purpose:** make activation feel immediate without paying to stream standby audio.

- Implement explicit states: DISARMED, STANDBY_LOCAL_WAKE, ACTIVATING, ACTIVE_LISTENING, RECOVERING, and STOPPING.
- In standby, run local wake detection, gate all microphone frames from Gemini, suppress assistant playback, and do not run conversational reasoning.
- On wake, unmute output and open upstream input on the warm session only after connection readiness has been confirmed.
- If the session closed/expired, immediately use the existing resumption/reconnect path; preserve correct session checkpoint and consumed-input cursor.
- Prevent duplicate microphone owners, duplicate sockets and repeated wake events; define false-wake cancellation and activation acknowledgement.
- Add a timeout/energy policy so idle standby can eventually disconnect and reconnect on wake if warm connection costs or reliability are worse.
- Evaluate a local wake-word engine appropriate for Android and the repository's license/build setup; do not rely on a cloud wake-word detector.
- Store no standby audio; process the wake detector locally. Any retained wake metrics must exclude raw audio and transcript content.

**Done when:** local wake detection gates audio before the Gemini sender; tests prove no upstream audio while in standby, no duplicate session on wake, and safe fallback after a dead warm socket. Wake latency and false-activation rate must be measured on a real device.

### M3 — Existing UI integration and device-state clarity

**Purpose:** make the new primary experience discoverable, explicit and controllable within AskMoina.

- Reuse the current authenticated AskMoina shell and account flow.
- Make social intelligence the primary experience; keep camera mode available as a secondary capability.
- Add clear controls for Enable Standby, Stop/Disarm, voice-profile setup and privacy settings.
- Show truthful states for disarmed, local standby, activating, active conversation, private output unavailable, reconnecting and stopped.
- Show or explain microphone permission, participant notice and earbud/output route requirements.
- Never imply that screen-off support exists until verified on that installation/device.

**Done when:** a user can enable and disable the lifecycle knowingly, state remains accurate through permission/device/session changes, and current camera flows pass regression.

### M4 — Voice profile and probabilistic speaker attribution

**Purpose:** help identify the user's own turns during a group discussion.

- Offer explicit, informed voice enrolment and deletion.
- Return speaker label, confidence and timing; allow unknown when evidence is weak.
- Keep other participants anonymous (Speaker A/B) unless they have independently consented to an appropriate identification workflow.
- Treat enrolment strictly as conversational attribution, never auth.
- Test false matches, missed user speech, noise, distance, volume changes, overlapping speech and similar voices.

**Done when:** attribution precision and recall are measured on representative audio, and uncertain cases do not confidently mislabel turns.

### M5 — Live conversation and topic tracker

**Purpose:** maintain the thread of a real discussion rather than treating each utterance as a new isolated prompt.

- Segment speech into turns with timestamps and provisional speaker attribution.
- Track current topic, questions, stated claims, commitments, unresolved points and topic transitions.
- Handle interruption, overlapping speech, backtracking and long pauses.
- Maintain a bounded rolling working context; discard or downgrade observations when they become stale.
- Keep observed facts separate from inferred interpretations and uncertainty.

**Done when:** multi-turn test conversations retain context, track topic changes, and stop treating obsolete content as current.

### M6 — Personal context, evidence and insight generation

**Purpose:** propose useful suggestions grounded in the conversation and approved user context.

- Reuse existing AskMoina memory/history facilities only where access control and retention semantics fit.
- Retrieve only relevant personal context; keep current-session working context separate from saved memory.
- Generate candidate types: context reminder, clarifying question, useful example, respectful counterpoint or grounded correction.
- Attach evidence/provenance, confidence, relevance, topic key, creation time and expiry to every candidate.
- Prefer concise natural English / Upper Assamese-English code-switching, tuned with user evaluation.
- Avoid invented facts about the user or participants; use grounded sources where factual correction is needed.

**Done when:** each candidate's factual basis can be inspected, account boundaries pass tests, and unsupported suggestions are rejected or suppressed.

### M7 — Private earbud delivery and interruption control

**Purpose:** speak briefly at a natural pause without disrupting conversation or leaking private audio.

- Confirm the selected audio route before playback; never silently fall back to the room speaker.
- Deliver short whispers only after M1's controller approves.
- Prioritize direct user requests and user speech; avoid talking over the user or another speaker.
- Cancel queued/playing audio on stop, user speech, route loss, disconnect, expiry or topic invalidation.
- Prevent duplicate delivery after reconnect and record non-sensitive timing metrics.

**Done when:** earbud delivery, cancellation, routing failure and stale queue behaviour pass automated and real-device tests.

### M8 — Continuity, cost and screen-off reliability

**Purpose:** prove the full feature remains stable and economical in real use.

- Reuse the existing Live session lifecycle, compression and resumption logic; keep provider resumption handle and consumed-input checkpoint consistent.
- Handle server GoAway, connection end, network transitions, token expiry and reconnect without duplicate/missing audio.
- Measure warm standby cost, connection survival, wake latency and active-session token use. Compare warm socket against reconnect-on-wake and an idle timeout policy.
- Ensure standby sends no mic frames upstream and avoids unnecessary Live model turns/transcription. Control active-context growth to limit compounding context costs.
- Test screen-off, backgrounding, OS microphone restrictions, battery saver, incoming calls, Bluetooth changes and permission revocation.
- Add safe, visible failure states. No production always-on activation while critical privacy or recovery tests fail.

**Done when:** reliable screen-off behaviour has been demonstrated on target devices, cost/latency results are recorded, and recoverable interruptions do not create duplicate sessions, missed state or stale whispers.

### M9 — Acceptance testing, pilot and staged release

**Purpose:** release only after technical and human-use evidence supports it.

- Run type-check, unit/integration tests and the existing PWA contract smoke test.
- Run synthetic scenarios: user/other-speaker turns, false wake words, no wake word, background noise, topic changes, incorrect/unknown facts, stale candidates, user interruption, stop/disarm, lost earbuds, dead warm socket, reconnect and screen lock.
- Verify account isolation, no upstream standby audio, consent/notice, deletion, camera regression and no private output-route leakage.
- Pilot with consenting participants on real Android devices and earbuds.
- Measure wake false-accept/false-reject, user-turn precision/recall, wake-to-first-audio latency, whisper-to-event latency, proportion of whispers rated useful, stale/duplicate rate, standby/active cost, battery and reconnect success.
- Use proposed targets only as targets until the evaluation protocol and results are recorded: at least 95% user-turn precision and at least 90% of delivered whispers rated useful/relevant on a defined pilot set; report denominators, recall and incorrect outputs too.
- Roll out behind a controlled feature flag only after review, CI, privacy and device gates pass. Preserve a fast rollback to the existing AskMoina experience.

**Done when:** release gates are documented with actual evidence, the pilot meets agreed thresholds, and the existing camera/auth/voice/history/deployment checks pass.

## Dependency order

1. M0: source and device audit.
2. M1: deterministic delivery policy, in parallel with wake state-machine design.
3. M2 + M3: local wake / warm-session controller and explicit UI controls; these form the first user-visible vertical slice.
4. M4 + M5: speaker attribution and live conversation state.
5. M6: grounded personal context and candidate generation.
6. M7: private whisper delivery and cancellation.
7. M8: recovery, cost and screen-off validation.
8. M9: synthetic, device and pilot gates before rollout.

## Current implementation snapshot (2026-10-21)

- Draft PR #366 contains the first deterministic whisper policy module, tests and this roadmap. CI/runtime wiring is not verified yet.
- The existing repository's Worker contains /api/voice/socket routing to the Live Session Relay and imports a client asset bundle from the existing AskMoina source tree. The next audit must map the exact browser audio sender/playback functions inside those modules before implementing wake audio gating.
- No wake-word model, warm-standby controller, group turn tracker or private whisper delivery should be described as implemented until code and device evidence demonstrate it.
- Historical Veda files/resources may remain disabled while implementation proceeds. Do not extend the separate Veda product architecture, and do not delete historical artifacts as part of this feature unless a separate dependency/data-safe cleanup is reviewed.

## Release rule

Work in small commits on the existing AskMoina branch. Each milestone requires source changes, tests, and evidence matching its completion gate. Do not merge or deploy on the strength of a roadmap or an authored test alone. If a step requires physical-device interaction, state the exact user action needed rather than claiming it was verified remotely.
