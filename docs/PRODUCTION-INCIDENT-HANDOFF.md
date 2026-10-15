# AskMoina Voice — Production Incident Handoff

Last updated: 2026-10-16 UTC.

## Status: Phase 1 production speech continuity verified; Phase 2 in progress

The stricter post-two-minute speech test passed against the deployed `0.4.51` Worker. Phase 1 is considered closed for the speech-continuity criterion; the overall production workflow still reports a separate live web-grounding synthetic failure.

- Repository: https://github.com/ashini-x/askmoina-voice
- Current `main`: `d9a2ee82d31018a4b2d5ba414766a5fa803b1b05`
- Deployed Worker release: `0.4.51`
- Worker version deployed by production workflow: `e8fac2bf-5b23-4986-83f4-6e5b12eb2946`
- Phase 1 long-session synthetic: [production run 38793224730](https://github.com/ashini-x/askmoina-voice/actions/runs/38793224730)
- Release validation: [run 38793224586](https://github.com/ashini-x/askmoina-voice/actions/runs/38793224586); production health: [run 38793224567](https://github.com/ashini-x/askmoina-voice/actions/runs/38793224567)
- Phase 1 implementation: [PR #171 — Stabilize Live speech endpointing and verify two spoken turns](https://github.com/ashini-x/askmoina-voice/pull/171)
- Phase 2 candidate: [PR #172 — Make Live session recovery deterministic](https://github.com/ashini-x/askmoina-voice/pull/172), branch `phase-2/deterministic-session-recovery`.

Production run 38793224730 deployed `0.4.51` and its long-session synthetic passed. The first health poll observed the prior version during propagation; the next health poll confirmed `0.4.51`. The workflow's final conclusion is `failure` only because the independent live web-grounding synthetic failed; the two spoken turns, response card, ranked list, voice memory, browser network recovery, and long-session continuity synthetics passed.

## Evidence and diagnosis

The original 0.4.48 run [38782822842](https://github.com/ashini-x/askmoina-voice/actions/runs/38782822842) showed replay/resumption loops; the relay log noted provider close 1007 (“Untruncatable session”) and 1011 resource exhaustion after a large buffered replay burst. [PR #167](https://github.com/ashini-x/askmoina-voice/pull/167) addressed context compaction, paced replay and redundant recovery retries.

The 0.4.49 run [38785905379](https://github.com/ashini-x/askmoina-voice/actions/runs/38785905379) isolated the next defect: the real browser microphone sent thousands of PCM frames and local VAD detected speech, but no audio-end signal was sent. [PR #170](https://github.com/ashini-x/askmoina-voice/pull/170) added hybrid VAD's `audioStreamEnd` marker and deployed 0.4.50.

That change is necessary but not sufficient on its own. In [run 38787188368](https://github.com/ashini-x/askmoina-voice/actions/runs/38787188368), one post-boundary utterance received four new assistant audio frames. In the subsequent [run 38788316268](https://github.com/ashini-x/askmoina-voice/actions/runs/38788316268), the browser again sent one audio-end marker after VAD observed speech; the spoken turn received zero new audio frames while the same session answered the text control probe with three audio frames. Both runs reported no provider error or browser socket closure during the failed speech turn. The whole deployment workflow also failed on independent grounded-web-search verification; it must not be confused with the spoken-turn result.

Google documents a hybrid-VAD mode that keeps server VAD and sends `audioStreamEnd` when client VAD detects the end of speech. It warns that overly short endpointing thresholds split natural pauses. The browser currently ended its local gate after 240 ms of silence, making this a credible application-level endpointing defect—not evidence of a fixed two-minute provider limit. The relay already maps `audio_stream_end` to `realtimeInput.audioStreamEnd`. The Worker also has context-window compression and session resumption configured.

## Phase 1 fix merged and production verified (PR #171)

- Increase local speech-end tolerance from 240 ms to 700 ms, reducing premature finalization at natural phrase pauses.
- Explicitly configure automatic server VAD with 250 ms prefix padding and an 800 ms server-side silence fallback. Keep hybrid `audioStreamEnd` enabled; do not switch to manual VAD without evidence, because manual mode removes server prefix buffering and requires reliable client pre-roll.
- Bump the Worker/client release identifier to 0.4.51 and synchronize public and embedded Co-Pilot assets.
- Expand the production browser synthetic to use Chromium's actual `getUserMedia`/microphone PCM path beyond 155 seconds, then deliver two separate speech utterances. Require an end marker for each turn, fresh assistant audio and provider `turnComplete` for each reply on the same session. Keep socket/reconnect assertions strict; do not use text control input as a success condition.

## Verification records

- Merged Phase 1 commit: `d9a2ee82d31018a4b2d5ba414766a5fa803b1b05`.
- Deployed `0.4.51` Worker version: `e8fac2bf-5b23-4986-83f4-6e5b12eb2946` (confirmed by the deployment log and the successful retry health poll in [run 38793224730](https://github.com/ashini-x/askmoina-voice/actions/runs/38793224730)).
- First delayed spoken turn: `audioStreamEndFramesSent: 1`, `assistantAudioFramesReceived: 17`, provider turn completion observed.
- Second distinct delayed spoken turn: `audioStreamEndFramesSent: 1`, `assistantAudioFramesReceived: 29`, `completed: true`.
- Both turns passed after the 170-second silence window on one browser Live socket; no socket closure or provider error was recorded during the speech turn.
- Independent failure: the same full workflow failed `Synthetic live web grounding test` because the Live WebSocket closed during grounded search. Response-card, ranked-list, voice-memory, browser network-recovery and long-session speech synthetics passed.

## Phase 1 completion gate — satisfied

Phase 1 speech continuity is verified on deployed `0.4.51`: the production synthetic observed two delayed real-microphone turns, each producing fresh assistant audio and turn completion on the same session without a browser socket close or provider error. The unrelated web-grounding synthetic remains a separate issue and is not counted as a speech-continuity failure.

## Phase 2 — deterministic session recovery (candidate)

- PR: [#172 — Phase 2: Make Live session recovery deterministic](https://github.com/ashini-x/askmoina-voice/pull/172).
- Branch: `phase-2/deterministic-session-recovery`.
- Candidate release: `0.4.52`.
- The candidate gates resumed UI on real provider setup and replay completion; makes a pending attachment own the single relay socket slot; rejects duplicate concurrent reattachments; invalidates stale browser start promises; de-duplicates browser reconnect timers; and routes missing/expired handles to one explicit fresh-session path while closing stale provider sockets and clearing pending queues.
- New automated coverage includes delayed provider setup, duplicate reattachment, missing handle/setup, invalid/expired handle errors, provider-requested rotation during replay, and one forced browser network interruption followed by two required post-170-second spoken replies.
- Status at this handoff revision: PR validation and production recovery verification are still pending. Do not call Phase 2 complete until the browser-level forced-disconnect test passes after deployment and the following spoken turn produces assistant audio and completion, with no duplicate sockets or stuck status overlay.


## Phase 2 follow-up — replace silent provider after browser network loss

- Previous merged candidate: [PR #172](https://github.com/ashini-x/askmoina-voice/pull/172), commit `e2947f6107862be290ab2c37bc3f8b9b4050ba73`, deployed `0.4.52`.
- Production run [38804098966](https://github.com/ashini-x/askmoina-voice/actions/runs/38804098966) confirmed that the browser could recover its connection and UI with one socket and one `resumed` signal, but then failed the spoken turn after the 170-second delay: `audioStreamEndFramesSent: 1`, `assistantAudioFramesReceived: 0`. A text control probe on the same connection got two audio frames, with no provider errors.
- Root cause isolated in recovery policy: the browser's offline event closed with code 4001 (`Reconnect handoff`), which deliberately preserved the old upstream session. Reattaching the browser therefore mislabeled a still-audio-silent provider as recovered.
- Follow-up branch: `phase-2/fresh-provider-after-network-loss`; candidate release `0.4.53`. Explicit browser offline now closes the old socket with code 4002, which the relay treats as termination rather than handoff. The user-requested Reconnect action then creates a new session UUID and starts one fresh provider session while keeping local camera preview available.
- The production synthetic was changed to require zero `resuming`/`resumed` signals for this explicit replacement path, exactly one live browser socket after reconnect, clear preview/recovery UI, and two real microphone turns after the 170-second delay, each with fresh assistant audio and provider `turnComplete`.
- Status at this candidate revision: PR validation, deployment and production spoken-turn verification remain pending. Phase 2 is not complete until the new deployed synthetic passes; the earlier `0.4.52` UI-only recovery pass does not meet the audio requirement.


## Phase 2 audio-turn follow-up — explicit client VAD candidate `0.4.54`

- The fresh-session change is verified at the transport/UI level, but production run [38806059263](https://github.com/ashini-x/askmoina-voice/actions/runs/38806059263) still showed no new assistant audio for the delayed microphone utterance after network replacement. It recorded the client audio-end marker; a text probe still received audio and the provider reported no error.
- This confirms the outstanding issue is broader than session reattachment. The browser streamed more than two minutes of silence into an automatically detected audio stream and depended on a hybrid end marker, which was not reliably committing the delayed speech turn.
- Candidate branch: `phase-2/deterministic-audio-activity`, release `0.4.54`.
- Co-Pilot now keeps a bounded ~300 ms PCM pre-roll locally; while idle it sends no silence-only PCM. On voice onset it sends `activityStart`, flushes pre-roll, and streams PCM; after sustained local VAD silence it sends the final PCM frame and `activityEnd`. Provider setup disables automatic activity detection, as required by this explicit activity-boundary protocol. The continuity synthetic checks both activity markers and requires two fresh assistant-audio replies with `turnComplete` after the long pause.
- The deterministic reconnect fixes from PRs #172 and #173 remain in place. No D1 history or Continue button was added.
- Status: candidate release validation, deployment and the live browser synthetic remain pending. Do not mark Phase 2 complete unless the delayed spoken-turn assertions pass after deployment.
