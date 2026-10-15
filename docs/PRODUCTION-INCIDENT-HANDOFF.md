# AskMoina Voice — Production Incident Handoff

Last updated: 2026-10-16 UTC.

## Status: Phase 1 is not yet verified closed

The production microphone-continuity incident remains open. Do not treat the single passing production run as proof of a stable fix; a subsequent run on the same deployed release failed the spoken-turn assertion.

- Repository: https://github.com/ashini-x/askmoina-voice
- Main at the time of the latest review: `85bfe647aaf77c177c71899376246e189dc64403`
- Production release: `0.4.50`
- Latest relevant failed production workflow: [38788316268](https://github.com/ashini-x/askmoina-voice/actions/runs/38788316268)
- Earlier single-run spoken-turn pass: [38787188368](https://github.com/ashini-x/askmoina-voice/actions/runs/38787188368)
- Current fix + strict two-turn regression PR: [#171 — Verify two real spoken turns after 155 seconds](https://github.com/ashini-x/askmoina-voice/pull/171)
- Candidate branch: `test/second-spoken-turn-phase1`

## Evidence and diagnosis

The original 0.4.48 run [38782822842](https://github.com/ashini-x/askmoina-voice/actions/runs/38782822842) showed replay/resumption loops; the relay log noted provider close 1007 (“Untruncatable session”) and 1011 resource exhaustion after a large buffered replay burst. [PR #167](https://github.com/ashini-x/askmoina-voice/pull/167) addressed context compaction, paced replay and redundant recovery retries.

The 0.4.49 run [38785905379](https://github.com/ashini-x/askmoina-voice/actions/runs/38785905379) isolated the next defect: the real browser microphone sent thousands of PCM frames and local VAD detected speech, but no audio-end signal was sent. [PR #170](https://github.com/ashini-x/askmoina-voice/pull/170) added hybrid VAD's `audioStreamEnd` marker and deployed 0.4.50.

That change is necessary but not sufficient on its own. In [run 38787188368](https://github.com/ashini-x/askmoina-voice/actions/runs/38787188368), one post-boundary utterance received four new assistant audio frames. In the subsequent [run 38788316268](https://github.com/ashini-x/askmoina-voice/actions/runs/38788316268), the browser again sent one audio-end marker after VAD observed speech; the spoken turn received zero new audio frames while the same session answered the text control probe with three audio frames. Both runs reported no provider error or browser socket closure during the failed speech turn. The whole deployment workflow also failed on independent grounded-web-search verification; it must not be confused with the spoken-turn result.

Google documents a hybrid-VAD mode that keeps server VAD and sends `audioStreamEnd` when client VAD detects the end of speech. It warns that overly short endpointing thresholds split natural pauses. The browser currently ended its local gate after 240 ms of silence, making this a credible application-level endpointing defect—not evidence of a fixed two-minute provider limit. The relay already maps `audio_stream_end` to `realtimeInput.audioStreamEnd`. The Worker also has context-window compression and session resumption configured.

## Candidate fix in PR #171

- Increase local speech-end tolerance from 240 ms to 700 ms, reducing premature finalization at natural phrase pauses.
- Explicitly configure automatic server VAD with 250 ms prefix padding and an 800 ms server-side silence fallback. Keep hybrid `audioStreamEnd` enabled; do not switch to manual VAD without evidence, because manual mode removes server prefix buffering and requires reliable client pre-roll.
- Bump the Worker/client release identifier to 0.4.51 and synchronize public and embedded Co-Pilot assets.
- Expand the production browser synthetic to use Chromium's actual `getUserMedia`/microphone PCM path beyond 155 seconds, then deliver two separate speech utterances. Require an end marker for each turn, fresh assistant audio and provider `turnComplete` for each reply on the same session. Keep socket/reconnect assertions strict; do not use text control input as a success condition.

## Verification records

- PR #171's original test-only candidate release validation: [run 38789813759](https://github.com/ashini-x/askmoina-voice/actions/runs/38789813759) passed before the runtime endpointing change below.
- Deployed 0.4.50 health smoke: [run 38788316373](https://github.com/ashini-x/askmoina-voice/actions/runs/38788316373) passed version, selected-voice and route checks.
- The runtime endpointing change and two-turn verification in PR #171 still require release-validation, merge/deployment and a passing production long-session synthetic before this incident can be marked resolved.

## Completion gate

Phase 1 is complete only after a deployment run proves both real-microphone spoken turns—first at the post-155-second boundary, then a second distinct turn—each receive new assistant audio and `turnComplete` on the same session, with no stale reconnect loop or misleading live state. Record the exact merged commit, PR, deployed Worker/version, and workflow result here only after those results exist.
