# M6 — Real-time performance and reliability

**Implementation status:** interrupt-aware response-start measurement and regression coverage are implemented on the M6 candidate branch.  
**Acceptance status:** pending release validation and the production live synthetic run.  
**Scope boundary:** this milestone improves observability of turn-taking while preserving the existing media path, replay checkpoints, single-retry silent-turn recovery, and reconnect policy.

## Change in this candidate

When the Worker receives `activity_start` while a prior `activity_end` is still waiting for its first audio-bearing provider frame, M6 classifies that pending response as `interrupted_before_first_audio`. This is recorded separately from first-audio latency because a user may intentionally barge in before the assistant begins speaking.

The event includes only the mode (`voice` or `copilot`), outcome, elapsed milliseconds, and boundary kind. It does not include audio, transcripts, prompts, task details, user identifiers, or retrieved examples. The pending timer is then cleared exactly as before, so audio from an earlier turn cannot be attributed to the next turn. Ordinary first-audio measurement remains unchanged.

This is instrumentation, not a claim that all missing responses are detected: if the provider never emits turn completion and the user does not speak again, the interruption event does not fire. The live synthetic checks remain necessary to identify silent/time-out cases.

## Reliability invariants retained

- Keep microphone/control ordering through session resumption and preserve the paired resumption handle plus consumed-input cursor.
- Do not announce recovery until provider setup, socket ownership, and replay state are ready; do not create a duplicate provider socket while setup is pending.
- Bound replay/pending input and mark non-replaceable audio loss as a continuity failure; stale camera frames may be compacted.
- Permit at most one controlled retry when a provider turn completes without audio and the original request is known and safe to retry.
- Treat a new user activity boundary as an interruption boundary; never attribute the previous response's first audio to the new user turn.
- Keep telemetry aggregate/timing-only. No raw media or conversational content is added to reliability logs.

## Acceptance gates

### Repository validation

- [ ] TypeScript checks pass.
- [ ] Full Vitest suite and the PWA contract smoke test pass.
- [ ] Benchmark validation, Worker bundle assertions, and Wrangler dry-run pass.
- [ ] Turn-boundary tests cover normal first audio, non-audio frames, invalid timestamps, interruption-before-audio, and boundary isolation.
- [ ] Recovery tests continue to cover resumption checkpoints, replay overflow, duplicate attachment prevention, one silent-turn retry, and replacement after network loss.

### Production validation

- [ ] The exact merged release is promoted and production health, critical routes/no-guest behavior, and PWA gate pass.
- [ ] The 20-turn synthetic response-start benchmark records requested/completed counts and p50/p90/p95/min/max.
- [ ] A forced network-loss scenario ends the stale provider, reconnects explicitly, and completes at least two spoken turns after the long-session boundary with fresh assistant audio and no stuck UI or retry loop.
- [ ] The live suite's web-grounding, speech-first answer, ranked-list, and voice-memory checks are recorded individually. A passing health check does not substitute for these tests.
- [ ] Observe M6 interruption events over real sessions before making response-quality or latency-SLA claims.

## Known open issue carried from M5

The production run at [M5 live synthetic verification](https://github.com/ashini-x/askmoina-voice/actions/runs/39150707898) passed the 20-turn latency benchmark, ranked-list voice flow, browser network recovery, long-running Live continuity, and persistent conversation-history checks. It failed the grounded web-search result check, speech-first spoken-answer timeout, and voice-memory completed-reply timeout. M6's interruption measurement does not claim to fix those issues; their exact outcomes must be rechecked in the M6 production run and investigated separately if they persist.

## Reporting rule

Do not mark M6 accepted solely because code merged or a Worker is healthy. Report repository validation, production deployment, live synthetic checks, observed production timings, and native-speaker/device acceptance as separate evidence levels. This milestone does not certify Assamese naturalness, end-to-end perceived latency, or reliability under untested devices/networks.
