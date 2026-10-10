# Release process

1. Work on a feature branch for substantial changes.
2. Run TypeScript checks and automated tests.
3. Review security, migrations, configuration and secrets.
4. Merge to main only when checks pass.
5. Cloudflare Workers Builds deploys the production branch after checks succeed.
6. Apply reviewed production D1 migrations deliberately before relying on new indexes or schema.
7. Verify the active Worker deployment, scheduled-retention trigger, health endpoint, Cloudflare errors and critical flows.
8. Confirm the scheduled production health workflow passes, including the expected configured Live voice. Separately perform an end-to-end voice and selected-memory test and have Upper Assamese speakers rate pronunciation, naturalness, perceived age, warmth, interruption, and first-audio latency before widening access; the health endpoint alone does not exercise provider audio or prove speech quality.
9. Roll back to the last known-good deployment if health or critical flows degrade.

## Large-scale public rollout gate

The current live configuration is controlled-beta capacity, not a million-user capacity promise:

- `MAX_GLOBAL_CONCURRENT_SESSIONS` is configured to 5.
- `MAX_GLOBAL_DAILY_SESSION_SECONDS` is configured to 3,600 seconds (one hour of aggregate voice time per India calendar day); the implementation also hard-caps the supported daily budget at 3,600 seconds.
- Session admission/status/release currently coordinates through a single global Durable Object named `voice-global-budget`, which is a potential hot shard as traffic grows.
- These limits must not be raised merely by changing Wrangler variables. Before broad rollout, redesign and load-test admission control at a defined target concurrency, preserve explicit budget safeguards, and verify Google Cloud billing alerts and provider quotas. Application-level quotas are not provider billing hard caps.
- Define and measure first-audio p50/p95, setup success, provider disconnects, and recovery behavior at the target load before promising real-time performance.

This hardening release deliberately does not remove the current budget/capacity limits or claim million-user readiness.

Production migrations must be reviewed and applied deliberately.
