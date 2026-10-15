# AskMoina Voice — Production Incident Handoff

Last checked: 2026-10-15 (UTC). Status: **not resolved until the post-two-minute spoken-turn production synthetic passes.**

## Verified repository and release

- Repository: https://github.com/ashini-x/askmoina-voice
- Current `main`: `63dd35e93e7c7db961971001d6be78ae9ca37d73` (merge commit for [PR #167](https://github.com/ashini-x/askmoina-voice/pull/167)).
- Release: `0.4.49`.
- [Release validation for PR #167](https://github.com/ashini-x/askmoina-voice/actions/runs/38785792088): passed, including typecheck, tests, benchmark validation and Wrangler dry run.
- [Main release validation](https://github.com/ashini-x/askmoina-voice/actions/runs/38785905274): passed.
- [Production health](https://github.com/ashini-x/askmoina-voice/actions/runs/38785905442): passed. Health reported `ok=true`, version `0.4.49`, model `gemini-3.8-live`, location `us-central1`, and the expected Live voice.
- [Production deployment + synthetic verification](https://github.com/ashini-x/askmoina-voice/actions/runs/38785905379): deployment and health/route checks passed; the full live synthetic step was still running at the time of this note. Do not infer continuity success from health alone.

## Confirmed failure and fix

The failed `0.4.48` production synthetic, [run 38782822842](https://github.com/ashini-x/askmoina-voice/actions/runs/38782822842), observed 6,857 browser PCM frames and local speech/end transitions after the two-minute boundary, but zero new assistant audio. The text-control probe also got zero audio; the browser then showed repeated `resuming`/`resumed` transitions.

The cause was confirmed in provider telemetry: Vertex closed with `1007 Untruncatable session`; resumption tried to replay roughly 3,200–4,776 buffered messages (about 4.9 MB) as a burst; resumed sockets then closed with `1011 Resource has been exhausted`, driving a rapid resume loop.

[PR #167](https://github.com/ashini-x/askmoina-voice/pull/167) fixes the demonstrated failure by raising context compression to a 48k trigger / 32k sliding-window target, pacing audio replay and pending audio delivery, compacting replaceable camera snapshots while preserving audio/control order, serializing replay against provider rotation, and stopping retries for fatal provider closes. These changes are deployed as `0.4.49`; the production spoken-turn test remains the release gate.

## Exact next task

1. Inspect the final status and complete logs for [production run 38785905379](https://github.com/ashini-x/askmoina-voice/actions/runs/38785905379).
2. Confirm the delayed real-microphone utterance after the 155-second boundary produces new assistant audio on the same live session, without a resume loop. If it passes, record the exact speech/audio-frame evidence and close the incident. The unmerged [PR #168](https://github.com/ashini-x/askmoina-voice/pull/168) only adds a hybrid-VAD end-of-speech marker; it is a secondary hypothesis from an older base and must not be merged without evidence it is needed.
3. If it fails, use the new provider close/error and replay telemetry to fix the demonstrated remaining cause on a dedicated branch/PR, keep the post-two-minute assertion strict, validate before merge, and repeat production verification.

Do **not** implement D1 history or Continue UI here. Do not call this complete on the basis of a green health check, an open WebSocket, or a successful text probe; the deployed post-two-minute spoken turn must pass.
