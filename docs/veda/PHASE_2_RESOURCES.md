# Project Veda — Phase 2 Resource Provisioning

**Scope:** isolated production/preview D1 bindings, versioned D1 schema, and a dedicated SQLite Durable Object namespace.

## Resources

- Production D1: `veda-prod` — `d63f471f-3a66-4a7f-9cfb-9087d00f9dcc`
- Preview D1: `veda-preview` — `0ef1c504-6a71-499f-b27c-a3d72b77be0b`
- Durable Object class/binding: `VedaSessionState` / `VEDA_SESSION_STATE`
- Veda migration directory: `migrations/veda`
- Explicit preview migration target: `wrangler.veda-preview-migrations.jsonc`

The D1 databases were listed before creation and both names were absent, so only the two Veda databases were created. No AskMoina database was altered or used as a fallback. Resource identifiers remain normal Wrangler configuration values; no secret values are stored in Git.

## Schema and safety boundary

The initial migration creates only Veda-owned metadata and runtime-session tables. It does not persist microphone audio, video, or raw transcripts. Future pairing, commands, memory, diagnostics, and retention policies must arrive in their own reviewed migrations and must not query AskMoina's `DB` binding.

Veda remains disabled in both production and preview. The new Durable Object reports only an internal health diagnostic and deliberately exposes no session mutation API in this phase. The class does not inherit AskMoina's `UserState` quota/session guard.

## Migration validation

- `VEDA_DB` production binding points only to `veda-prod`.
- Preview's `VEDA_DB` points only to `veda-preview`.
- Both use `migrations/veda`, separate from AskMoina's top-level `migrations/`.
- CI checks the isolation configuration and applies the Veda migration to separate local D1 instances.
- The preview migration config explicitly targets the preview database ID.

## Deployment verification (2026-10-19)

- Main commit: `a4105c553200ac9b4b6fc8686ce3af961345aca8`.
- Successful Cloudflare Workers Build: `648ea478-d193-40e5-8cc0-2ce759fad291` (main branch).
- Production Worker version: `0.4.142`, version ID `71245a2a-47b9-413e-8263-efda5dacb2ca`, 100% traffic.
- Production bindings verified from the deployed version: `VEDA_DB` → `veda-prod`; `VEDA_SESSION_STATE` → `VedaSessionState`; `VEDA_ENABLED=false`. AskMoina's `DB` binding remains separately pointed at `askmoina-prod`.
- The production health smoke returned `ok:true` and `version:0.4.142` after the new version became active.
- The Cloudflare main-branch build reported 543 tests passing across 73 files and a passing PWA contract smoke.
- Remote queries confirmed the Veda-only schema and `0001_initial.sql` migration marker in both production and preview databases.

### First-deployment ordering issue

The separate GitHub Actions deployment job ran its Wrangler preflight before the new Durable Object class had been reconciled, and failed with the "VedaSessionState ... not yet provisioned" binding error. The Cloudflare Workers Build for the same main commit then successfully deployed and provisioned the class; the live health smoke subsequently observed version 0.4.142. Avoid declaring release workflows completely green on this evidence: the production build and health response succeeded, but the parallel deployment path should be reconciled before the next release to avoid this first-class provisioning race.

## Provisioning credential limitation

The existing GitHub Actions deployment secret `CLOUDFLARE_API_TOKEN` is scoped for Worker deployment. The production deploy workflow already records that this token lacks D1 API permission (Cloudflare error code 7403). It therefore cannot safely discover/create missing D1 databases or apply remote D1 migrations from GitHub Actions. The two databases were provisioned through the authorized Cloudflare control plane available for this run, and the IDs are now pinned in source.

This means **the current resources and bindings can be deployed and verified, but self-service recreation of a deleted/missing D1 database from the existing GitHub Actions token is not automated**. Do not claim otherwise or copy another credential into source. To fully automate creation/recovery later, the deployment environment needs an appropriately scoped D1 API permission; the current Worker deployment credential must not be assumed to have it.

## Not implemented in Phase 2

No Veda install portal, device pairing, microphone runtime, Live session, personal memory, whisper controller, or social-intelligence feature is enabled. These remain later phases. Phase 2 creates only the isolated persistence and session-state foundations.
