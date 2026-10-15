# AskMoina Voice — Production Incident Handoff

Last verified: 2026-10-15 UTC. **Post-two-minute spoken-turn continuity is now verified passing on production 0.4.50.**

## Production state and evidence

- Repository: https://github.com/ashini-x/askmoina-voice
- Current `main`: `30e026436054a9d08a5a808a98eb8d91bec6b1bd`.
- Deployed release: `0.4.50`.
- [Release validation on main](https://github.com/ashini-x/askmoina-voice/actions/runs/38787188852): passed.
- [Production health smoke](https://github.com/ashini-x/askmoina-voice/actions/runs/38787188912): passed and reported `0.4.50`, `gemini-3.8-live`, `us-central1`, and the expected Live voice.
- [Production deploy + live synthetic run](https://github.com/ashini-x/askmoina-voice/actions/runs/38787188368): **overall failed** because the independent grounded-web-search and ranked-list synthetics failed. Its dedicated long-running audiovisual continuity check **passed**; do not confuse the overall red workflow with the target continuity assertion.
- [PR #167](https://github.com/ashini-x/askmoina-voice/pull/167) merged the session compression/replay fix.
- [PR #170](https://github.com/ashini-x/askmoina-voice/pull/170) merged the hybrid-VAD end-of-speech fix. [Its release validation](https://github.com/ashini-x/askmoina-voice/actions/runs/38787091838) passed.

## Confirmed causes and fixes

The `0.4.48` production failure in [run 38782822842](https://github.com/ashini-x/askmoina-voice/actions/runs/38782822842) revealed Vertex closed with `1007 Untruncatable session`; the relay replayed ~3,200–4,776 buffered messages (~4.9 MB) in a burst; resumed sockets then closed with `1011 Resource has been exhausted`, causing a resume loop. PR #167 raised compression to a 48k trigger / 32k sliding-window target, paced audio replay and queued delivery, compacted replaceable camera frames, and prevented repeat attempts on fatal provider closes.

The deployed `0.4.49` failure in [run 38785905379](https://github.com/ashini-x/askmoina-voice/actions/runs/38785905379) had a different remaining issue: 6,862 browser PCM frames and VAD transitions after ~168.5s, zero new spoken-turn audio, 3 frames from a text probe, and zero browser `audio_stream_end` markers. PR #170 now sends the final silence-bearing PCM first, then `realtime_input.audio_stream_end: true`, while automatic server VAD stays enabled. This matches Google's documented [hybrid VAD approach](https://ai.google.dev/gemini-api/docs/live-api/capabilities).

## Verified post-fix spoken-turn test

Production run [38787188368](https://github.com/ashini-x/askmoina-voice/actions/runs/38787188368) on `0.4.50` reported:
- `elapsedMs: 169166`; `audioFramesSent: 6838`; actual browser microphone VAD transitioned from idle to speech and back.
- `audioStreamEndFramesSent: 1` for the delayed utterance after the two-minute boundary.
- Assistant audio frames increased from 45 to 49 during the dedicated response window: **4 new frames attributable to the spoken turn**.
- The text fallback was not sent (`textProbeSent: false`); no provider errors, browser socket closure, or resume loop were observed.
- Final synthetic result: `Production audiovisual Live continuity: PASS (155 seconds, post-start AI reply, browser socket stayed open).`

This satisfies the production acceptance criterion for the post-two-minute spoken-turn incident. The *entire* deployment workflow remains red only because the separate grounded search and ranked-list checks failed in that run.

## Exact next task

Keep this incident resolved unless the post-two-minute speech assertion regresses. The next separate task is to investigate the grounded-web-search and ranked-list synthetic failures in [run 38787188368](https://github.com/ashini-x/askmoina-voice/actions/runs/38787188368), without weakening assertions or changing the verified microphone/VAD and compression/replay fixes. Do not bundle D1 conversation history or Continue UI into that task.
