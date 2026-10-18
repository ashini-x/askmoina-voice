# M1 — Baseline and performance benchmark

Status: **in progress**. This document records the initial source and production-telemetry review. It is not a release certificate.

## Snapshot

- Review window: 2026-10-11 12:52 UTC to 2026-10-18 12:52 UTC.
- Production log source: Cloudflare Workers Observability, filtered to the `askmoina-voice` service and specific metric log messages.
- Data handling: aggregate timing values and outcome counts only. No audio, transcripts, screenshots, or personal identifiers are recorded in this report.

## Existing benchmark infrastructure

The repository already contains:

- `docs/benchmarks/assamese-speech-v1.json`: 15 cases across six dimensions, with an 85% overall pass threshold, dimension thresholds, and zero tolerated critical failures.
- `docs/benchmarks/reality-benchmark-v1.json`: 18 task/evidence/safety cases across eight dimensions, with an 85% overall pass threshold and zero tolerated critical failures.
- `scripts/reality-benchmark.mjs`: suite validation, score-template generation, and scoring.
- `scripts/live-turn-latency-benchmark.py`: 20 locally synthesized, non-user speech turns over the production Live WebSocket; records response-start latency and generated-audio byte counts only.
- CI validation via `npm run benchmark:validate`, with the latency script syntax-checked in Release Validation.

These files define repeatable acceptance criteria, but validating a suite is not the same as running it against real generated speech. No scored live-audio acceptance result was identified in the files reviewed for this snapshot.

## Initial production telemetry

| Metric | Samples | p50 | p95 | Observed range |
|---|---:|---:|---:|---:|
| Session-start to first provider audio frame (legacy metric) | 10 | 2,095 ms | 15,133 ms | 1,155–15,133 ms |
| Session-start to provider setup completion | 10 | 555 ms | 2,131 ms | 470–2,131 ms |

With only 10 samples, p95 is effectively the maximum observation. These values are descriptive signals, not a stable performance SLA.

The legacy `requestToFirstAudioMs` starts at session initialization. It can include session setup and time spent speaking before the first response. It is **not** a valid stand-alone measure of turn response latency.

During the same seven-day review, 14 session-efficiency summary records were found: seven marked `completed` and seven marked `provider_error` (11 Co-Pilot mode records and three voice mode records). This is a small, log-derived sample—not a reliable estimate of the production error rate. The provider-error records should be inspected before any release-readiness claim.

## M1 instrumentation correction

The M1 feature branch adds a privacy-safe `activity_end`-to-first-audio metric for client-detected spoken turns. It logs only:

- operating mode (voice or Co-Pilot),
- elapsed milliseconds from the server receiving the activity-end signal to the first audio-bearing provider frame,
- setup-complete flag and frame size.

It does not capture audio, transcript text, or user content. It does not change turn detection, silence thresholds, prompts, audio formats, or generation configuration.

Important interpretation: this measurement starts after the client-side silence tolerance has already elapsed. It isolates the server/provider response-start interval; it does not by itself measure total time from the user's final phoneme to audible playback. The fixed client silence tolerance and playback scheduling must be reported separately when comparing full perceived latency.

The new metric cannot be collected from production until this branch is reviewed, validated and deliberately deployed. No production deployment is part of this milestone change.

## M1 exit gates

1. CI passes for the measurement helper and existing benchmark suites.
2. Turn-latency samples are collected from a sufficient number of real sessions, split by voice and Co-Pilot mode where available.
3. Report p50/p95 with sample counts and no personal content.
4. Complete the Assamese speech acceptance suite against actual generated audio; do not mark native naturalness as passed from prompt tests alone.
5. Investigate provider-error outcomes before calling the runtime baseline healthy.
