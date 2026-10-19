# Project Veda — Phase 0 Repository Audit

**Audit date:** 2026-10-19  
**Repository:** ashini-x/askmoina-voice  
**Audited branch:** main  
**Audited HEAD:** badcf5bf78527bf6412fb20db97c79334e8bdeec  
**Purpose:** Establish a factual baseline before implementing Veda. This document is an audit record, not a claim that Veda has been implemented.

## Executive summary

AskMoina already contains meaningful reusable infrastructure: a Cloudflare Worker serving the PWA and API, server-side Google/Vertex authentication, a Gemini Live WebSocket path, Durable Object session relay, D1 conversation history, Key Memories, selected-memory injection, operational telemetry, and GitHub Actions for validation, deployment, and production health. Veda should reuse compatible code rather than reproduce these systems or require credentials to be re-entered.

Veda does not yet exist as an implemented feature in the audited tree. No Veda routes, Veda D1 binding, Veda device registry, independent Veda session profile, Veda installation endpoint, or Whisper Controller were found in the audited repository tree.

## Repository and runtime baseline

### Current deployed configuration in source

- Worker name: askmoina-voice.
- Entry point: src/index.ts.
- Static asset directory: public/.
- Declared application version: 0.4.140.
- Declared Live model: gemini-3.8-live.
- Declared Live voice: Leda.
- Declared Vertex location: us-central1.
- Existing production D1 binding: DB → askmoina-prod.
- Existing preview D1 binding: DB → askmoina-preview.
- Existing Durable Object classes: UserState and LiveSessionRelay.
- Existing background queue: askmoina-background-prod / preview counterpart.
- Existing Worker secret declarations include GCP_SERVICE_ACCOUNT_JSON, ADMIN_DASHBOARD_PASSWORD, and ADMIN_SESSION_SECRET.
- The secret values are not required for this audit and were not read or copied.

These are configuration values in the repository and must not be interpreted as proof that every production binding or credential is currently valid.

### Relevant existing code and documentation

- src/index.ts: primary Worker routing, authenticated voice WebSocket route, Vertex token exchange/use, Durable Object relay, recovery, usage instrumentation, and operational routes.
- src/auth/google.ts: Google access-token helper.
- src/conversations.ts: account-scoped conversation history and prior-conversation retrieval.
- src/user-memory.ts: user memory management.
- src/grounded-expertise.ts: source URL validation and grounded-source utilities.
- src/sessions/: Live protocol, audio-rate limiting, session recovery/resumption, memory context, pronunciation, and other voice-session helpers.
- public/: PWA assets and existing admin/user interface assets.
- wrangler.jsonc: Worker, asset routing, configuration, D1, Durable Object, and queue bindings.
- docs/ARCHITECTURE.md, docs/SECURITY_MODEL.md, docs/PRIVACY.md, and docs/RELEASE_PROCESS.md: existing implementation and security notes.

## Existing workflow evidence

GitHub Actions records inspected during this audit:

- Release validation run 39273954487 succeeded for commit 3a7685d8603e774fd05667d15136604b82705144: https://github.com/ashini-x/askmoina-voice/actions/runs/39273954487
- Production health smoke run 39273954673 succeeded for that same commit: https://github.com/ashini-x/askmoina-voice/actions/runs/39273954673
- Production deployment and live synthetic verification run 39273954426 failed for that same commit: https://github.com/ashini-x/askmoina-voice/actions/runs/39273954426

The last full deployment/synthetic workflow log reports the following synthetic failures:
1. Grounded web search: Live WebSocket closed during grounded search.
2. Speech-first answer: timed out waiting for the spoken answer to complete.
3. Live voice memory: timed out waiting for a completed model reply.

Other checks in that run passed, including the ranked-list voice flow, browser network recovery, long-running Live continuity, and persistent conversation history. The health smoke passing demonstrates the configured production health route and model configuration at that time; it does not erase the separate synthetic-verification failures.

The current audited main HEAD is badcf5bf78527bf6412fb20db97c79334e8bdeec. Its commit message is “[skip ci] Remove temporary chess branch cleanup workflow”, with parent 3a7685d8603e774fd05667d15136604b82705144. The parent commit contains the feature-removal change; the audited HEAD removes the temporary cleanup workflow. Since the current HEAD skips CI and the latest successful health/workflow runs refer to the parent commit, the HEAD itself has not been shown by these runs to have a fresh post-commit deployment verification.

## Baseline risks and decisions

1. **Reuse credentials without copying them.** Veda should remain inside the existing Worker initially so that the configured Vertex AI service-account secret is reused. Do not reveal secret values or create a second Worker that requires a duplicate secret.
2. **Separate data.** Veda must have a dedicated D1 database and binding. Never silently fall back to AskMoina production DB if provisioning fails.
3. **Provision idempotently.** Use existing GitHub Actions Cloudflare credentials to discover or create Veda resources and report missing permissions explicitly.
4. **Separate behavior.** Veda must have its own admin-only interface, session profile, system instruction, session state, device registry, memory policies, whisper lifecycle, and tests.
5. **Admin authorization is server-side.** A hidden URL or client-side route check is insufficient.
6. **No app-level admin cost limits.** The project's requirement is no daily Veda quota, automatic budget stop, or fixed session-duration limit for the admin. Usage transparency and manual Stop remain; duplicate-session protection remains necessary for correctness.
7. **Background microphone operation is a device constraint.** Test the PWA on the actual Android device. If reliable screen-off use is not possible, plan a TWA plus a minimal Android foreground-service component. Do not claim a standard PWA can guarantee it.
8. **Privacy by default.** Raw live audio/video should not be persisted by default; durable memory saving must be selective and reviewable.
9. **Production regression risk.** Resolve or characterize the three synthetic failures from run 39273954426 before relying on those scenarios as green release gates for later Veda deployment.
10. **Don't redeploy documentation to claim a feature deployment.** Phase 0 adds an audit/roadmap record only. No application runtime code is changed by this phase.

## Tooling limitation during this audit

The repository was inspected through the connected GitHub integration. A direct local Git clone could not be performed in the current execution environment because outbound DNS resolution for github.com failed. Therefore no local npm test run is claimed here. The workflow results above are the CI evidence available for the baseline.

## Phase 0 completion

- [x] Inspected repository metadata, current branch/HEAD, Worker configuration, main code map, and relevant documentation.
- [x] Inspected recent release validation, production health, and deployment/synthetic workflow results.
- [x] Identified existing reusable infrastructure and missing Veda components.
- [x] Documented the production synthetic-test failures that must remain visible.
- [x] Saved the final Veda roadmap as a version-controlled project source of truth.
- [ ] No Veda runtime feature deployed in Phase 0; this phase is audit/documentation only.

## Next phase

Phase 1: create Veda's isolated module, routes, and feature boundary in the existing repository while preserving AskMoina behavior. The next provisioning phase should then automate creation of Veda's separate D1 database and session-state resources using existing Cloudflare credentials, with explicit checks for permissions and no manual secret re-entry.
