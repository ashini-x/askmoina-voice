# M1 — Baseline and performance benchmark

Status: **measurement instrumentation deployed; baseline acceptance still in progress**. This is an evidence record, not a release certificate. This baseline is also the measurement foundation for the additive Assamese Gen-Z initiative (M0–M9); it does not renumber the older M1–M40 engineering roadmap.

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

## M1 instrumentation and production measurement path

The current `main` source includes the privacy-safe turn-latency helper in `src/sessions/turn-latency.ts`, its live-session integration in `src/index.ts`, and regression tests in `test/turn-latency.test.ts`. For each client-detected `activity_end`, the server records a one-shot pending boundary and measures the first subsequent audio-bearing provider frame. A new `activity_start` clears a pending measurement so an interrupted prior turn is not misattributed.

The metric logs only:
- operating mode (`voice` or `copilot`),
- elapsed milliseconds from the server observing the activity-end signal to the first audio-bearing provider frame,
- setup-complete state and provider frame size.

No audio, transcript, prompt, or personal content is written by this metric. It does not alter turn detection, silence thresholds, prompts, audio format, or generation configuration.

The existing `scripts/live-turn-latency-benchmark.py` sends 20 locally synthesized **English** speech turns through the production Live WebSocket and reports sample count plus p50, p90, p95, minimum, and maximum boundary-to-first-audio latency. The standard production workflow invokes this benchmark using an authenticated synthetic account. The result must be read from the corresponding GitHub Actions logs; validating or syntax-checking the script is not evidence that the run passed.

**Interpretation limit:** this starts after the browser's silence-tolerance logic has closed the turn. It measures the server/provider response-start interval, not total perceived latency from the user's final phoneme to sound reaching the speaker. Client VAD delay, browser scheduling, playback scheduling, and device/network differences must be kept separate. The English synthetic benchmark is not a measure of Assamese pronunciation, dialect fit, or naturalness.

The measurement path is included in the production release process, but M1 is not accepted solely because the code was deployed. Numeric benchmark output, repeated production samples by mode where available, failure investigation, and native-speaker scoring remain evidence gates.

## Assamese Gen-Z initiative: M1 baseline procedure

### Technical baseline

1. Run the normal release-validation workflow, including `npm run benchmark:validate`, the turn-latency helper tests, and the Wrangler dry-run.
2. Run the production workflow's 20-turn latency benchmark; record the run URL, the requested/completed turn counts, p50/p90/p95, min/max, and failures from the workflow output.
3. Report the source-observed `activity_end`-to-first-audio metric separately from total user-perceived response latency and from the legacy session-start metric.
4. Gather enough production observations to stratify by voice and Co-Pilot mode where available. Include sample counts and the measurement window. Do not write raw media or transcripts into benchmark results.
5. Reproduce and investigate provider-error, clipped-turn, interruption, reconnect, and session-continuity failures before calling the runtime baseline healthy.

### Assamese-English conversational baseline

The existing `docs/benchmarks/assamese-speech-v1.json` is the baseline evaluation suite: 15 scenarios across six dimensions (language matching, conversational naturalness, pronunciation clarity, code-switching, turn-taking, and uncertainty honesty). Use `node scripts/reality-benchmark.mjs init speech <path-to-run.json>` to create a score-only reviewer template, then `node scripts/reality-benchmark.mjs score speech <path-to-run.json>` to calculate its score.

Have consenting Upper Assam speakers rate the actual generated audio in a private evaluation. Do not save audio or transcripts by default; store only evaluator codes, ratings, critical-failure flags, and brief non-identifying notes. Keep disputed regional variants marked as variants. One reviewer's preference must not be presented as a universal dialect rule.

### M1 status and acceptance

**Deployed:** turn-latency instrumentation, its unit tests, an existing 20-turn synthetic runner, the 15-case speech suite, and score-only evaluation tooling are already in the repository and in the production release path.

**Still pending:** a linked successful 20-turn production timing result; a sufficiently sampled per-mode baseline from production telemetry; root-cause review of the small historical provider-error sample; and a scored native-listener run of the Assamese speech suite. No native pronunciation/naturalness result should be invented from synthetic tests or prompt contracts.

M1 can be marked fully accepted only once the measurement run results are attached and the native-speaker baseline has been collected privately. This is a pre-release quality task, not a public-beta requirement.
