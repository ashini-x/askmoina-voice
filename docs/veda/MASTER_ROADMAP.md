# Project Veda — Locked Master Roadmap

**Owner:** Personal, single-admin system  
**Repository:** ashini-x/askmoina-voice  
**Deployment principle:** Reuse existing GitHub Actions, Cloudflare Worker, and configured Vertex AI credentials wherever possible. Avoid recurring manual key/secret setup.  
**Primary objective:** A private, admin-controlled social-intelligence companion that listens to face-to-face conversations when explicitly armed, computes and researches in the background, and speaks concise, useful whispers at appropriate moments.

This is the canonical Project Veda plan. Changes to this scope should be deliberate and documented.

## Locked architecture

- Keep Veda in the existing askmoina-voice repository.
- Keep one existing Cloudflare Worker initially so existing Vertex AI credentials and token generation can be reused without creating another secret setup burden.
- Give Veda a separate installable PWA identity, manifest, route scope, interface, API surface, and application behavior.
- Host its private installation endpoint behind the existing admin authentication.
- Give Veda an independent D1 production database and an independent D1 preview database. Do not use AskMoina's D1 binding as a silent fallback.
- Give Veda independent Durable Object session/state namespaces where required, while reusing compatible relay implementation code.
- Keep Veda's instructions, state, tools, device registry, memory policies, diagnostics, and tests separate from ordinary AskMoina behavior.
- Do not create a second Worker unless a demonstrated technical requirement justifies it. A shared Worker remains one deployment unit, so regression validation is mandatory.
- Use Android-first PWA delivery initially. If reliable screen-off microphone use fails PWA testing, use a TWA with the minimum native foreground-service component necessary.
- Keep the experience out of generic chat UI. The dashboard is the control plane; the phone is the listening/runtime endpoint.
- Avoid new manual API key or secret entry. Reuse existing credentials and automate resource provisioning through current deployment automation where permissions allow. If permissions are missing, report the exact blocker without asking for already configured values again.

## Admin and cost policy

Veda is for one authorized administrator only. There is no public sign-up or ordinary consumer access. Every protected route and API must enforce authorization server-side.

The admin does not want application-level daily spending limits, daily voice quotas, forced session-duration caps, or an automatic budget stop. Usage and estimated costs may be visible diagnostically. A manual Stop control, safe teardown, revoked-device handling, and one-session-at-a-time protection remain essential correctness/security controls. Provider and OS limits still apply.

## Core runtime behavior

- The administrator controls configuration and session state from the separate Veda admin application.
- A locally armed phone runtime captures audio only under the required OS permissions and transparent microphone indication.
- Research, calculations, and reasoning may prepare candidate insights in the background.
- The Whisper Controller alone decides whether and when a candidate can be spoken.
- Veda stops playback and clears queued audio when human speech interrupts a whisper.
- Duplicate, stale, cancelled, already-delivered, and topic-obsolete insights must be suppressed.
- Direct requests to Veda take priority over unsolicited background suggestions.
- If no useful, sufficiently supported, timely contribution exists, Veda stays silent.
- Live conversation audio and context are transient by default; persist only deliberately selected personal memory and the minimum operational metadata needed.

## Phase 0 — Repository audit and baseline

Inspect repository state, routes, admin authentication, Worker config, Vertex authentication, Live WebSocket path, Durable Objects, D1 schemas, grounded search, history/memory, PWA cache/update behavior, and CI/deployment workflows. Record reusable components, missing Veda capabilities, current test results, known failures, resource/secret names without values, and a rollback point. Do not claim tests that did not run. Phase 0 is audit/documentation only, not a Veda feature deployment.

Exit gate: documented component map and CI baseline; existing AskMoina behavior understood; current workflow failures recorded.

## Phase 1 — Veda module and feature isolation

Create a dedicated Veda module and server-controlled mode. Establish route boundaries and Veda-specific tests. Keep AskMoina's system instruction and default behavior unchanged. Avoid bringing unrelated camera, AR, chess, and consumer-specific features into Veda.

Exit gate: Veda code can be tested independently; existing AskMoina baseline remains intact.

## Phase 2 — Automated resource provisioning

Use existing Cloudflare/GitHub credentials. Create Veda production and preview D1 databases and independent session-state bindings/namespaces as needed. Provision idempotently, discover existing resources before creation, maintain versioned migrations, and fail clearly if existing token permissions are insufficient. Never copy secret values into Git or fall back to AskMoina's DB. Keep resource IDs in normal configuration, not secrets.

Exit gate: Veda production/preview resources and bindings are independently verified; migrations apply in preview and are repeatable.

## Phase 3 — Private install portal and admin authorization

Create a private Veda installation endpoint and separate PWA manifest, icon, start URL, and service-worker scope. Reuse the existing admin authentication where suitable. Restrict every Veda asset/API/action to the authorized admin. Add sign-out, session revocation, CSRF/same-origin checks, and unauthorized-route tests. Do not rely on a hidden URL for security.

Exit gate: anonymous, ordinary-user, and unauthorized requests are denied server-side.

## Phase 4 — Device pairing and command channel

Pair the phone using a short-lived one-time code and local confirmation. Issue a revocable Veda-scoped credential; do not rely on device IDs as credentials. Use command IDs, sequence numbers, acknowledgement, expiry, and idempotency for Arm, Disarm, Start, Stop, configuration, and revoke. Prevent stale commands from starting sessions after reconnect; expose device heartbeat and runtime version.

Exit gate: only a paired, non-revoked runtime can receive commands; duplicate or expired commands cannot create duplicate sessions.

## Phase 5 — Android listening runtime

Test the installed PWA on the actual Android phone for microphone access, Bluetooth, audio focus, screen lock, switching apps, network transitions, process termination, and background operation. Support an explicit local Arm action and an ongoing OS microphone indicator/notification. If PWA behavior is insufficient, package the site as a TWA and add the minimum Android foreground-service bridge that meets Android permission/start restrictions. Provide local Stop and handle disarm, permissions, reboot, service death, and disconnect honestly.

Exit gate: real-device behavior matches documented capabilities; do not claim guaranteed screen-off listening from a pure PWA if tests fail.

## Phase 6 — Veda Live session

Reuse the existing Google token helper, Vertex Live transport, compatible WebSocket relay, and session-resumption mechanisms. Create a Veda-specific session route/profile and independent system instruction, voice behavior, context, tools, and session IDs. Keep model choice, provider endpoint, instructions, and privileged tool permissions server-controlled. Ensure upstream and downstream sockets close safely and recovery cannot duplicate sessions.

Exit gate: Veda can start, stop, and recover independently without changing AskMoina Voice/Co-Pilot behavior.

## Phase 7 — Whisper Controller

Implement an explicit candidate lifecycle: listening → preparing → evaluating → waiting for a suitable opening → speaking, or suppressed/cancelled/expired. Interruptions immediately stop client playback, clear queued audio, cancel stale generation where possible, and invalidate old audio. Each candidate has an ID, topic version, timestamps, priority, expiry, and delivery state. Prevent duplicate playback across provider frames, callbacks, retries, and reconnects. Direct requests take priority; no progress announcements in social mode; silence is a valid result.

Exit gate: synthetic tests prove stop-on-interruption, no queue replay, no duplicates, no stale results, and direct request responsiveness.

## Phase 8 — Conversation understanding and rolling context

Maintain a transient, bounded representation of topic, claims, figures, entities, unresolved questions, arguments, and recent context. Track topic changes and invalidate obsolete candidates. Distinguish direct requests from ambient conversation where feasible. Evaluate diarisation before trusting speaker attribution. Handle overlap, noise, accents, rapid Upper Assamese-English code-switching, follow-up references, and network recovery without replaying consumed input. Compress long context to a rolling summary.

Exit gate: multi-turn context and topic changes work in tests; uncertain attribution remains uncertain.

## Phase 9 — Deterministic calculations

Provide safe structured tools for percentages, changes, ratios, totals, averages, discounts, unit/time conversions, budgets, growth, and other useful calculations. Validate inputs; reject malformed or unsupported operations; never execute arbitrary model-generated code. Retrieve an up-to-date exchange rate or other external value only when needed; pure arithmetic should be local. Return structured numeric results to the reasoning layer; the controller decides whether speech is appropriate.

Exit gate: fixtures match expected results, ambiguous input is handled safely, and tool completion does not automatically trigger speech.

## Phase 10 — Current-affairs research

Audit and reuse compatible grounded-search/source-validation infrastructure. Add Veda-specific research for wars, politics, economics, technology, and changing topics. Retrieve current sources when needed; track source URL, publisher, publication time, supporting evidence, uncertainty, and expiry. Prefer primary sources and reputable reporting where appropriate; compare conflicting reports; never treat unsupported retrieval as fact. Run slower research asynchronously, then send the result through the Whisper Controller. Discard results when the topic moves on.

Exit gate: current-affairs fixtures verify source support, time relevance, contradictory evidence handling, uncertainty, and stale-result suppression.

## Phase 11 — Veda personal memory

Use Veda's own database and retrieval interface for deliberately selected personal notes, professional context, projects, interests, commitments, and preferred communication style. Keep durable memory separate from transient live context. Use bounded retrieval with source/provenance metadata. Provide review, edit, revoke, and deletion controls. Do not automatically make everyone heard during a conversation part of permanent memory. Do not query AskMoina production data as a fallback.

Exit gate: retrieval is relevant, deletion works, permissions are respected, and no cross-application data access occurs.

## Phase 12 — Social intelligence and response formulation

Produce structured candidate insights: verified facts, implications, comparisons, follow-up questions, tactful disagreement, missing assumptions, alternative arguments, and permitted personal reminders. Evaluate usefulness, support, novelty, active topic, timing, and concision before approval. Distinguish explicitly stated facts, evidence-supported implications, and uncertain interpretations. Do not claim mind-reading or present guesses about intentions as facts.

Exit gate: evaluated conversations show helpful, concise suggestions with an acceptable rate of error and interruption.

## Phase 13 — Upper Assamese-English speech

Give Veda its own spoken-response style. Evaluate natural code-switching, local expressions, names, numbers, acronyms, and pronunciation with a test set. Compare available voices if necessary. Keep ordinary whispers short and direct; remove unnecessary introductions/progress commentary. Tune from tested examples rather than assuming prompt instructions guarantee correct dialect. Voice generation remains behind the Whisper Controller.

Exit gate: agreed language tests and local listener evaluation show that output is understandable and sufficiently natural for use.

## Phase 14 — Privacy and retention

Default to transient audio and live context. Do not persist raw microphone audio or video by default. Persist only deliberately selected memories and necessary operational metadata. Keep logs free of raw transcripts, memory contents, secrets, and audio payloads. Document retention/deletion for every table; support revocation and erasure. Show microphone state clearly on the phone. Review actual Vertex data-processing/retention configuration before claiming zero retention. Use appropriate consent and transparency when processing other people's speech.

Exit gate: data lifecycle, deletion, revocation, account separation, and logging have passed tests.

## Phase 15 — Diagnostics and usage visibility

Track connection/setup failures, session recovery, first-audio latency, whisper latency, tool/search latency, device heartbeat/runtime version, candidate delivery/suppression/interruption, and provider-reported token usage when available. Attribute Veda usage separately where reliable. Show cost as an estimate unless reconciled with billing. Do not implement admin cost caps, daily quotas, automatic budget stops, or forced session timeouts.

Exit gate: diagnostics are useful, privacy-preserving, and honest about attribution limits.

## Phase 16 — Automated deployment and updates

Extend the existing GitHub Actions workflow. Reuse existing Cloudflare deploy credentials and Worker-side Vertex secret. Run idempotent resource provisioning, preview migrations, type checks, tests, static checks for incorrect DB bindings, Worker dry run, admin-route/auth tests, Veda integration tests, and AskMoina regression checks. Keep Veda PWA assets versioned and avoid mid-session reloads. Confirm deployed version/health; document rollback. Native Android service changes require a new package build; ordinary web changes load through the deployed PWA assets.

Exit gate: safe end-to-end deploy, health checks, and rollback work with no repeated credential setup.

## Phase 17 — Full integration testing and personal pilot

Test admin-only access, pairing/revocation, command expiry, live audio, stop-on-interruption, no duplicates, topic changes, current-affairs grounding, calculations, memory isolation, network recovery, screen lock, privacy, provider usage, and AskMoina regression. Use scripted/synthetic tests plus real-device and consent-appropriate conversation tests. Track usefulness, missed opportunities, false or stale suggestions, unwanted interruptions, and latency.

Exit gate: Veda consistently improves real conversational participation without unacceptable interruption, factual, privacy, or runtime failures.

## Global acceptance requirements

- No repeated secret/key configuration unless an existing credential or permission is genuinely missing.
- No app-level admin spending caps or automatic budget shutdowns.
- No public Veda registration/access.
- No ordinary chatbot interface as the primary product.
- No duplicate Live sessions or whisper playback after cancellation.
- No stale/unsupported current-affairs claims presented as certain.
- No unintended persistent raw audio.
- No Veda-to-AskMoina production database fallback.
- No Veda release without AskMoina regression checks.
- No claim of deployed/working capability without evidence from CI, health tests, or the target device.
- Preserve an independently reviewable phase history and update this roadmap when scope changes.

## Immediate next step

Phase 0 is the repository audit documented in docs/veda/PHASE_0_AUDIT.md. Phase 1 is to create Veda's isolated module and route boundary. Phase 2 provisions the separate Veda databases/resources automatically. Do not start the social-reasoning feature before isolation, pairing, and session controls exist.

This roadmap defines intended behavior and acceptance criteria; it does not claim any of the Veda phases beyond Phase 0 have been implemented.
