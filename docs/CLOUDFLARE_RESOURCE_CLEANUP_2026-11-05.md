# Cloudflare infrastructure cleanup — 5 November 2026

**Account:** `b34a6c0b7221454c5db977fe61ddf759`  
**Scope:** AskMoina Voice branch previews / Durable Objects and the retired Gyanshala API Worker.  
**Result:** account Durable Object namespace count reduced from 100 to 20; 80 isolated preview namespaces freed.

## Cleanup rules

- Production Durable Object namespaces were retained.
- Branch preview state was deleted through Cloudflare's Preview API without the force-delete option. Cloudflare automatically deletes the Durable Object namespace and its preview storage when the Preview is deleted.
- Preview runtimes for unrelated open PRs were preserved.
- GitHub branches and pull requests were not deleted.
- D1 databases and their data were preserved.

## AskMoina Voice namespace accounting

Before cleanup the account was at the Workers Free Durable Object cap: **100 / 100 namespaces**.

After cleanup:
- Account: **20 namespaces** remaining.
- `askmoina-voice`: **16 namespaces** — 3 production namespaces plus 13 namespaces across 5 retained active-PR previews.
- `parmar-ai`: **4 namespaces** — production `JobDedupe` plus 3 BRVIN M3/M4 branch previews retained for the separate BRVIN/Parmar integration work.
- **80 namespaces freed.**

### Production namespaces retained

- `askmoina-voice_UserState` — `3ed2afed851540cb8e17f0f1f6439399`
- `askmoina-voice_LiveSessionRelay` — `0807da0f3f074df3b3d39a2eb4ba2d08`
- `askmoina-voice_VedaSessionState` — `42e3fdc3cab9461fa6b45d6644ca0763`
- `parmar-ai_JobDedupe` — retained

The production Veda namespace was deliberately not removed: the live `askmoina-voice` deployment still declares the `VEDA_SESSION_STATE` binding, and its `VEDA_DB` production D1 binding remains unchanged. Only Veda branch-preview namespaces were deleted.

### Previews retained

The following five preview environments still have DO state because each has an open PR:
- `fix/match-swiftui-glow-interface1-20261017` — PR #245
- `ops/deploy-after-validation` — PR #265
- `feat/askmoina-social-intelligence-primary` — PR #366
- `feat/fitness-tracker-mvp` — PR #368
- `fix/live-vad-benchmark-turn-boundaries` — PR #374

### Preview environments deleted

The following 31 AskMoina Preview environments were deleted, freeing 80 preview-specific namespace/storage slots:
- `fix/live-synthetic-acceptance-reliability`
- `fix/live-turn-latency-speech-boundary`
- `brvin-2/m4-production-evidence-docs`
- `ci/pin-live-synthetic-ubuntu-24-04`
- `brvin-2/m4-brvin-integration`
- `feature/jio-airfiber-remote-pwa`
- `gyanshala-pages-setup`
- `feat/apple-live-status-fund-card`
- `feat/veda-social-intelligence-mvp`
- `feat/gyanshala-onboarding-auth`
- `feat/admin-one-click-assamese-override`
- `fix/live-smoke-audio-turn-protocol`
- `fix/live-search-pending-state`
- `fix/production-verification-not-cancelled`
- `fix/finish-live-synthetic-verification`
- `fix/explicit-assamese-rights-confirmation`
- `feat/m1-m2-assamese-admin-review`
- `phase-2/veda-resource-provisioning`
- `fix/liquid-glass-deploy-contract`
- `redesign/liquid-glass-system`
- `fix/m1-smoke-real-entry-flow`
- `fix/m1-copilot-smoke-actionability`
- `fix/global-fluid-motion-defaults`
- `feat/m1-live-latency-benchmark`
- `feat/ios-fluid-interactivity-main-sync`
- `pwa-performance-audit`
- `fix/android-dark-navigation-divider`
- `fix/interface06-preview-card-height`
- `ui/interface06-spacing-release-labels`
- `design/symmetric-experience-cards`
- `chore/moinaos1-clean-artwork`

The AirFiber, Veda and Gyanshala *branch previews* listed above were removed; their GitHub source branches and open PRs (#369, #365 and #364 respectively) were left intact. The five active-PR previews listed in the retained section were also left intact.

## Gyanshala Worker retirement

The standalone `gyanshala-smart-supply-api` Worker was deleted successfully.

Cloudflare initially rejected deletion with error `10340`, because the Pages project `gyanshala-nits` had a `GYANSHALA_WORKER` service binding in both preview and production configuration. Before retrying deletion:

1. Inspected the Pages project `gyanshala-nits` and its production deployment.
2. Inspected the tracked `gyanshala-pages/_worker.js` on branch `gyanshala-pages-setup`. The production file is a server-rendered pause/maintenance gate and explicitly does not forward page or API requests to the Worker; API requests return the `GYANSHALA_PAUSED` 503 response.
3. Removed the unused `GYANSHALA_WORKER` binding from both Pages preview and production config.
4. Redeployed the same `gyanshala-pages-setup` production branch without changing its source commit. New Pages deployment `eb2eebac-7183-41d2-a77f-a5d3b9677e89` completed successfully on 5 November 2026.
5. Retried and successfully deleted `gyanshala-smart-supply-api`.

Preserved:
- Pages project `gyanshala-nits` and URL `https://gyanshala-nits.pages.dev`, still serving the existing paused maintenance gate.
- D1 database `3424f65d-8ecd-4a35-ac74-02b98abc4579` and its data.
- GitHub source branch `gyanshala-pages-setup`.

## Other Workers left intact

The standalone Workers `jio-airfiber-remote`, `airfiber-apk-download`, `askmoina-download-preview` and `askmoina-fitness-tracker` were not deleted as part of this namespace cleanup. The AirFiber branch Preview was removed, but the standalone AirFiber Worker(s) remain separate resources; the fitness tracker also has an open PR (#368). No Pages project or D1 database was deleted.

## Final verification

The post-cleanup read-back confirmed:
- 20 Durable Object namespaces in the account.
- 16 AskMoina Voice namespaces: all 3 production namespaces intact and only the 5 retained active-PR Preview groups.
- `gyanshala-smart-supply-api` no longer appears in the Workers script inventory.
- The `gyanshala-nits` Pages project remains; `deployment_configs.preview.services` and `deployment_configs.production.services` are both empty.
- The latest canonical Pages deployment is `eb2eebac-7183-41d2-a77f-a5d3b9677e89` and completed successfully.
- No GitHub branch/PR was deleted.
