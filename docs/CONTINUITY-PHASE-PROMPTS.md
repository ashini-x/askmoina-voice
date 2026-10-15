# AskMoina Voice — Copy/Paste Prompts for the Five Continuity Phases

Use these prompts in separate ChatGPT conversations. Run them in order. Every prompt is self-contained enough to orient a fresh chat, but must still start by checking the current repository because commits and workflow runs can change.

Common rules for all phases:
- Repository: https://github.com/ashini-x/askmoina-voice
- Work only on the phase named in the prompt. Do not bundle later phases into the same PR.
- Inspect current `main`, latest production `APP_VERSION`, and latest relevant workflow logs before editing.
- Use the connected GitHub tools; do not ask the user to run terminal commands or manually edit source.
- Make a dedicated branch and a small PR. Keep tests strict. After merge, verify the exact deployed version and required live production tests.
- Do not claim a task is done because code was committed, typechecks pass, a WebSocket stays open, or a text probe works when the acceptance criteria require speech.
- At the end, update `docs/PRODUCTION-INCIDENT-HANDOFF.md` with actual commit/PR/workflow IDs, evidence, results, and the next exact task.
- Stop and explain only a precise permissions/secrets/external-service blocker if one genuinely prevents progress. Do not return a diagnostics-only audit; implement and verify a fix.

---

## Prompt 1 — Fix long-running Live speech/session continuity

Continue the AskMoina Voice production incident. This phase is the current priority.

First re-check the current repository and newest run (the previously verified checkpoint was main `ed9f7238bfbe5cde85827939930bbd9a46ec1d01`, release `0.4.48`; it can be stale). Earlier production run:
https://github.com/ashini-x/askmoina-voice/actions/runs/38782822842

The latest evidence at that checkpoint: after roughly 169 seconds, the browser had sent thousands of PCM frames and local VAD observed both speech onset/end, but the speech turn yielded zero new assistant audio. A text probe also got zero audio. Connection-status events repeatedly alternated `resuming` / `resumed`, the interface stayed `connecting`, and no provider error was logged in the captured excerpt. PR #165 already separated the audio/video rate budgets and centralized live-media forwarding. Newer work may have changed the evidence, so always inspect the newest run.

Trace the actual end-to-end path: browser getUserMedia and PCM conversion; client protocol envelope; frame/byte limiters; Worker parser; Durable Object relay; upstream Gemini Live message order; provider inbound response frames; silent turn/recovery logic; session-resumption handle and consumed-input cursor; output parsing/playback; UI state transitions. Establish whether the current fault is audio transport, upstream turn state, a resumption loop, a timeout/replay interaction or more than one issue.

Implement the smallest evidence-based root-cause fix and regression tests. Do not merely add logs, increase timeouts, relax assertions or send a side-channel text prompt instead of speech. The production synthetic must use the actual browser microphone/getUserMedia path and prove a spoken turn after more than 155 seconds, then another spoken turn. Include evidence that the UI is stably live and not stuck in repeated reconnect states.

Run repository checks and workflow tests, open a focused PR, merge through the safe process, confirm the actual deployed APP_VERSION and inspect the new production logs. Do not claim success unless the deployed post-155-second speech test passes. Update the handoff and stop after Phase 1 exit criteria are met.

---

## Prompt 2 — Make session resumption and reconnect/UI recovery deterministic

Only start after Phase 1's deployed production spoken-continuity gate passes. Re-check the handoff and repository to confirm this.

Focus only on disconnect/recovery and resumption checkpoint correctness. Trace browser WebSocket lifecycle, reconnect ownership, `LiveSessionRelay` Durable Object lifecycle, provider session-resumption handles, provider-consumed input cursor, replay buffers, pending input, setup-complete transitions, context compression, microphone/camera resources, playback queues and connection/blur UI.

Cover at least:
- Abrupt browser WebSocket close and network interruption.
- Provider go-away/socket rotation, delayed setup, missing/expired resume handle and resume rejection.
- Multiple/duplicate reconnect or resumption callbacks.
- Preventing two live sockets or two reconnect timers from racing.
- Never advancing a resume checkpoint without the matching valid handle and never moving past unacknowledged input.
- No infinite replay of old audio and no claim of live readiness until the session can receive and answer new speech.
- If true resumption is impossible, one deterministic recovery path must clean up stale resources and establish a replacement session, retaining the latest context that can safely be retained.

Fix the root cause with deterministic unit/integration tests plus a browser synthetic that forces a real interruption and then proves the user can speak and hear an answer again. The camera preview must remain usable; microphone capture and output playback must resume; blurred/connecting UI must clear; repeated `resuming`/`resumed` loops must not occur.

Do not add D1 conversation history or the Continue button in this PR. Validate, merge, deploy and test against production. Update the handoff with exact evidence. Stop after the forced-disconnect recovery gate passes.

---

## Prompt 3 — Add secure persistent D1 conversation history

Only start after Phases 1 and 2 are verified. Confirm this from current main, PRs and the handoff.

Implement durable conversation history for signed-in users, using the existing Cloudflare D1 binding (`env.DB`) and existing authenticated account identity. Inspect the current schema and auth/session middleware before creating migrations; do not duplicate an existing table or infer identity from a client-supplied user ID.

Add an appropriate schema for:
- A conversation/topic, owner ID, title, created/updated timestamps, status and last activity.
- Ordered turns with stable turn/sequence IDs, speaker role, finalized text, timestamps and optional non-sensitive metadata.
- Compact conversation summary and structured task progress that can be used to reconstruct continuity after a replacement Live session.
- Idempotency so a retried append does not duplicate a turn.
- Retention and deletion consistent with existing privacy/account flows.

Build authenticated, owner-scoped APIs for creating, listing, reading and appending conversation records; add rename/archive/delete only where consistent with current product conventions. Every query must enforce ownership server-side. A user must never read or write another account's conversation by changing an ID. Save completed/finalized text and useful task state, not continuous raw camera or microphone recordings by default. D1 is canonical; browser storage may cache drafts or a recent view only.

Add migrations, validation, tests for multi-user isolation, unauthenticated requests, duplicate retries, turn ordering, empty/oversized input, delete/retention behaviour and summary updates. Keep this phase backend-focused: do not build the history sidebar or Continue UI here.

Run migration/schema tests and full repository validation; merge only when safe; deploy and verify authenticated APIs in production without exposing conversation data. Update the handoff with the schema/API decisions and confirmed deployment. Stop after D1 persistence passes.

---

## Prompt 4 — Build in-place Continue conversation recovery

Only start after Phases 1–3 are verified, including persistent D1 history and secure APIs.

Implement an in-place Continue flow that recovers the conversation without reloading the full page. First attempt transparent provider session resumption. When the provider session is irrecoverable, use Phase 3's D1 history and most recent compact summary/recent turns to create a replacement Live session that makes clear it is continuing from saved context rather than pretending hidden provider state was preserved.

Requirements:
- Keep the live camera preview visible; preserve/reacquire camera and mic safely.
- Do not create duplicate WebSockets, mic processors, audio contexts or reconnect timers.
- Make UI state truthful: do not show Live until a new speech turn can be processed; clear stale blur/connecting overlays after success.
- If auto-recovery fails, show a clear “Continue conversation” action with a concise, non-alarming explanation. On tap, reconnect in place and restore context.
- Have Moina say a natural short line such as “Okay, let's continue where we left off,” then continue the previous task with an appropriate caveat if only summary-level context was restored.
- Save the last finalized turn and summary before a replacement-session handoff.
- The proposed 100-second cutoff is not a default timer that interrupts users. Only implement quiet proactive rotation if evidence shows it is necessary and it can be done without interruption or loss.

Build browser-level tests for successful resume, rejected/expired resume handle, user pressing Continue, failing recovery, interrupted camera/mic capture, and next spoken turn after recovery. Verify camera stays visible and there is no full page navigation/reload. Do not modify D1 schema in this PR unless the Phase 3 design exposes a narrowly scoped defect that must be corrected first.

Deploy and prove the actual browser recovery path in production. Update the handoff and stop after in-place continuation is verified.

---

## Prompt 5 — Full end-to-end release and production acceptance

Only start after Phases 1–4 are verified. Inspect main, current production version, migrations, and all previous phase handoff evidence.

Perform the final complete acceptance pass. Fix any defect caused by the phases; do not lower test thresholds or treat intermittent failures as passing. The production tests must demonstrate:
1. Multiple spoken turns before and after 155 seconds in a still-usable audiovisual session.
2. Real microphone speech is processed and gets an audible/model audio reply; a text probe alone does not count.
3. A forced browser/provider disconnect resumes or safely creates a replacement session and the next spoken turn succeeds.
4. Saved turns and summary restore relevant context after replacement-session fallback.
5. Resumption handle and consumed-input cursor remain consistent; no lost unacknowledged input or repeated replay.
6. Camera preview, microphone capture and assistant audio playback work across reconnect; there are no duplicate sockets or stuck blur/connecting UI.
7. D1 APIs remain account-isolated and idempotent, and privacy/retention/delete behaviour is correct.
8. Existing grounded web search, ranked-list, response-card, voice-memory and browser network-recovery suites still pass.

Run repository checks, migrations, full tests, Worker dry-run/bundle checks and the relevant production workflows. Verify the health endpoint reports the exact release version and expected Live configuration. Inspect raw step outcomes and failure logs; an overall green workflow must not hide that a critical scenario was skipped. If any decisive test fails, fix the demonstrated cause and rerun, rather than writing a success summary.

Update `docs/PRODUCTION-INCIDENT-HANDOFF.md` with final release SHA, Worker version, deployment run, health run, each acceptance result and any remaining known limitations. Do not say “complete” until every required production gate passes.
