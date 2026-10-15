# AskMoina Voice — Five-Phase Continuity Plan and Incident Handoff

Last verified: 2026-10-15 (Asia/Kolkata)

## Verified checkpoint when this note was created

- Repository: https://github.com/ashini-x/askmoina-voice
- `main`: `ed9f7238bfbe5cde85827939930bbd9a46ec1d01`; latest known release `0.4.48`.
- Production health: [run 38783370664](https://github.com/ashini-x/askmoina-voice/actions/runs/38783370664) — passed.
- Production deployment + synthetic verification: [run 38782822842](https://github.com/ashini-x/askmoina-voice/actions/runs/38782822842) — failed.
- Release validation: [run 38782822801](https://github.com/ashini-x/askmoina-voice/actions/runs/38782822801) — passed.
- PR #165, “Keep Live PCM flowing during continuous camera input,” separated audio/video rate budgets, centralized media-forwarding mapping and added speech-throughput tests.

Always re-check current main and latest workflow logs before acting; this checkpoint may become stale.

## Most recent live failure

The latest continuity workflow observed:
- Around 168,875 ms elapsed before the delayed speech test.
- Browser mic stimulus used a WAV with a long silence followed by speech; 6,857 PCM frames were counted and local VAD on/off transitions were observed.
- Assistant audio before the turn: 46 frames. New audio attributable to the spoken turn: 0.
- A text control probe also received 0 audio frames.
- Provider error logs were empty in the captured excerpt, while connection status repeatedly alternated `resuming`/`resumed`; the UI remained `connecting`.
- Grounded web search also failed intermittently; response-card and ranked-list synthetic passed in this run.

This supersedes earlier evidence where a text probe received audio. Investigate the latest log and code before choosing a root cause; repeated resumption transitions may be central.

## Architecture decision

Use Cloudflare D1 for durable conversation history, owned by the authenticated account/user ID. D1 is already bound to the Worker, but the schema needs conversation/topic and turn tables. Use the existing `LIVE_SESSION_RELAY` Durable Object for ephemeral live socket state, resumption handle/checkpoint, pending input and replay safety. D1 does not replace live socket state.

Store completed/finalized text turns, timestamps, topic IDs, compact summaries and task progress. Do not store continuous raw camera or microphone recordings by default. Browser storage is cache/draft only, never the canonical history.

## Rules for every phase/chat

1. Inspect current main, production version and newest workflow logs at the beginning.
2. One phase per chat, focused branch/PR, tests before merge, then deployment and live verification where required.
3. Do not begin the next phase until current exit criteria pass, unless a dependency is explicitly documented.
4. An open WebSocket, successful text probe, successful deployment upload or green typecheck does not prove speech continuity.
5. Never weaken assertions just to turn CI green; don't ask the user to edit code or run terminal commands.
6. Keep this handoff current with exact commits, PRs, workflow runs and results.

## Phase 1 — Fix long-running Live audio/session continuity (current blocker)

Trace real mic input through browser PCM conversion, client envelope, Worker parser, separate audio/video limits, relay queue/forwarding, upstream provider frames, output audio, compression, session resumption and UI transition logic. Explain and fix why post-boundary spoken input gets no response; investigate the `resuming`/`resumed` loop in run 38782822842. Add a regression test for the demonstrated cause.

**Exit criteria:** a deployed production test keeps AV running beyond 155 seconds, sends speech through the actual browser mic/getUserMedia path, receives assistant audio attributable to that speech and then completes another spoken turn. No reconnect loop or false-live state. Preserve web grounding, ranked lists, response cards, voice memory and network recovery.

## Phase 2 — Deterministic resumption and reconnect/UI recovery

Test forced browser socket loss, upstream/provider rotation, expired/missing handles, setup delay, duplicate callbacks, replay safety and UI state. Keep the handle and consumed-input cursor atomic; never skip unacknowledged input or replay indefinitely. If provider resumption fails, use one deterministic recovery path, clean stale resources, preserve camera/mic where possible and clear stuck blur/connecting indicators. Tell users if continuity is approximate.

**Exit criteria:** forced disconnect/resume/replacement tests pass and the next spoken turn works after recovery without a resuming loop.

## Phase 3 — Durable D1 conversation history

Add migrations for users' conversations/topics and ordered turns linked to authenticated user ID. Build ownership-checked APIs to create/list/read/append and, as appropriate, rename/archive/delete. Store finalized text, timestamps, summaries and task state; no raw media by default. Add idempotency/sequence IDs against duplicate writes on retries, retention/limits and cross-user isolation tests.

**Exit criteria:** schema applies, cross-user access is denied, signed-in user history can be restored, and deletion/retention is tested.

## Phase 4 — In-place Continue conversation experience

Try transparent provider resumption first. If impossible, restore D1 summary + recent turns and start a replacement Live session with that context. Avoid full-page reload: preserve camera preview, reinitialize audio capture/playback safely, prevent duplicate sockets and wait for actual response/audio before showing fully live. Show Continue only when automatic recovery fails. A 100-second rotation is a safeguard only if demonstrated necessary, not a forced user interruption every 100 seconds.

**Exit criteria:** forced disconnect and expired-handle flows recover seamlessly or through Continue, without page reload, with camera/mic working and a contextual spoken follow-up.

## Phase 5 — Full production acceptance

Run the full suite and deployed synthetic checks:
- Two or more spoken turns before and after 155 seconds.
- Forced browser/provider disconnect followed by a successful spoken turn.
- Context restored after a replacement session.
- No lost unacknowledged input; correct resumption handle/checkpoint.
- No duplicate sockets, stuck blur/connecting state or false live indicators.
- Grounded search, ranked lists, response cards, voice memory and network recovery remain passing.

Confirm the exact deployed `APP_VERSION` at health endpoint and inspect live logs. Deployment is not complete until the required production assertions pass.

## Exact starting task for the next chat

Start Phase 1 only. Re-check current main and latest production workflows (do not assume this handoff is still newest), inspect the full failure log at [run 38782822842](https://github.com/ashini-x/askmoina-voice/actions/runs/38782822842), trace the real audio/resumption code and fix the demonstrated root cause. Do not implement history or Continue UI in that same PR. No diagnostics-only audit; deploy and prove the post-155-second speech test passes. Update this document with real evidence when Phase 1 is complete.
