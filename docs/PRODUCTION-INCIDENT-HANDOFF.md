# AskMoina Voice — Production Incident Handoff

Last checked: 2026-10-15 UTC. Status: **unresolved until the deployed >2-minute spoken-turn test passes.**

## Current verified state

- Repository: https://github.com/ashini-x/askmoina-voice
- Current `main`: `30e026436054a9d08a5a808a98eb8d91bec6b1bd`.
- Release configured: `0.4.50`.
- [PR #167](https://github.com/ashini-x/askmoina-voice/pull/167) merged the confirmed context/replay fix: 48k compression trigger / 32k sliding window, paced audio replay, replacement of stale camera frames only, and protection against resume loops caused by fatal closes.
- [PR #170](https://github.com/ashini-x/askmoina-voice/pull/170) merged the follow-up hybrid-VAD fix: send the last silence-bearing PCM frame followed by `realtime_input.audio_stream_end: true` at the local speech falling edge. The Worker already maps that to provider `realtimeInput.audioStreamEnd`; automatic server VAD stays enabled.
- [Release validation for PR #170](https://github.com/ashini-x/askmoina-voice/actions/runs/38787091838): passed (typecheck, JS/synthetic syntax, benchmark validation, tests, Wrangler dry run and release bundle checks).
- [Production health for 0.4.49](https://github.com/ashini-x/askmoina-voice/actions/runs/38785905442): passed, but health is not a continuity result.
- [Latest main release validation](https://github.com/ashini-x/askmoina-voice/actions/runs/38787188852): queued at last check.
- [Latest production health](https://github.com/ashini-x/askmoina-voice/actions/runs/38787188912): queued at last check.
- [Latest production deploy + synthetic run](https://github.com/ashini-x/askmoina-voice/actions/runs/38787188368): queued at last check. Inspect its final logs for the real post-two-minute spoken turn.

## Verified incident evidence

Production release `0.4.48` run [38782822842](https://github.com/ashini-x/askmoina-voice/actions/runs/38782822842) revealed the original session-level failure: Vertex closed with `1007 Untruncatable session`; the relay replayed about 3,200–4,776 buffered messages (~4.9 MB) in a burst; resumed sockets then closed with `1011 Resource has been exhausted`, causing a resume loop. PR #167 fixed this path.

The subsequent deployed `0.4.49` run [38785905379](https://github.com/ashini-x/askmoina-voice/actions/runs/38785905379) showed the audio-turn failure remains independently:
- About 168.5 seconds elapsed; 6,862 browser microphone PCM frames and local speech-on/off transitions were observed.
- New assistant audio after the speech turn: **0**.
- Text control probe over the same still-open session: **3 audio frames**.
- Browser sent **0** `audio_stream_end` markers; provider error logs in the captured excerpt were empty and no rapid resume loop appeared in this run.

Google documents hybrid VAD as continuous audio with automatic server-side speech-onset detection and a client `audioStreamEnd` signal at end-of-speech to finalize the turn: [Live API capabilities / VAD](https://ai.google.dev/gemini-api/docs/live-api/capabilities). PR #170 adds this signal and the synthetic now asserts it was sent during the delayed (>2-minute) test.

## Exact next task

1. Inspect [production run 38787188368](https://github.com/ashini-x/askmoina-voice/actions/runs/38787188368) after it completes. Verify health reports `0.4.50`, then confirm its continuity diagnostic shows a post-boundary `audioStreamEndFramesSent > 0` and **new assistant audio attributable to the spoken turn**, on the same live session without a resume loop.
2. If the test passes, update this handoff with the exact audio-frame/VAD evidence and workflow outcome, then resolve the incident.
3. If it fails, read the new provider/Worker/client evidence and continue fixing the demonstrated cause on a focused branch/PR. Keep the audio assertion strict. Do not merge any other PR or push a new `main` commit until the current deployment synthetic has finished.

Do **not** implement D1 history or Continue UI in this incident task. Health green, an open WebSocket, a successful text probe, and a deployed commit are not substitutes for a passing spoken turn.
