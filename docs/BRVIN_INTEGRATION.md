# AskMoina Voice — BRVIN 2 integration

**Milestone:** BRVIN 2 M4  
**Status:** M4 consumer implementation merged and live; production synthetic acceptance is finishing  
**Date:** 4 November 2026

## Connector source

AskMoina vendors the dependency-free BRVIN connector at `src/brvin-connector`.

- Upstream repository: `ashini-x/parmar-ai`
- Upstream source commit pinned by this copy: `91b6a499bd782ae298b41e790157c23682f10881`
- Upstream path: `packages/brvin-connector/src/index.ts`

Update the vendored copy only through a reviewed consumer PR. Do not publish it to a public package registry or expose it to client-side JavaScript.

## Production trust configuration

Production config adds:
- Private Service Binding `BRVIN_SERVICE` → `brvin-service`, entrypoint `BrvinRetrievalApi`.
- Trusted Service Binding props `applicationEnvironmentId=00000000-0000-4000-8000-000000000202` (AskMoina production identity).
- `BRVIN_DEFAULT_PROJECT_ID=fatman` and `BRVIN_CONNECTOR_TIMEOUT_MS=15000`.

The application/environment identity comes from deployment-controlled Service Binding props. The project selector comes from trusted Worker configuration. Neither the browser request nor the Gemini function arguments can supply the identity or change the project.

The AskMoina preview environment deliberately has no BRVIN Service Binding and no default project ID. Its separate BRVIN preview identity is registered in D1 for future controlled tests, but the public Worker Preview cannot call the production BRVIN deployment. Cloudflare preview Service Bindings would call the downstream production Worker, so omitting the binding is intentional.

## Live tool flow

1. A signed-in, non-guest voice/Co-Pilot session receives the `search_brvin_knowledge` Gemini Live function declaration only when the Worker has the private binding and configured project.
2. Gemini Live calls the function with a concise semantic query, up to three physical PDF page numbers, or both.
3. AskMoina revalidates the signed-in account in the server-side WebSocket handler and calls `retrieveAskMoinaBrvinEvidence`.
4. The handler uses the server-configured `fatman` project and the vendored connector. It does not accept `projectId`, application ID or environment ID from the tool arguments.
5. BRVIN validates the AskMoina environment, the application grant to Fatman, active project state and ready source permissions. It returns bounded passages and book/PDF-page provenance.
6. AskMoina returns concise text evidence and citations to Gemini Live as a function response. Gemini Live generates and speaks the final answer; AskMoina still owns account auth, D1 history, Key Memories, media, session resumption and user-visible delivery.

Physical PDF pages and printed book page labels are distinct. The tool uses `page_numbers` only when the user explicitly means physical PDF page numbers; for printed page labels, use a semantic query and cite only what BRVIN returned.

## Authorization, quota and failure behavior

The only initial app-project grant is AskMoina → Fatman. No other BRVIN project is granted.

Fatman's monthly search allowance is shared across every application explicitly granted Fatman. AskMoina searches charge the existing Fatman project counter; they do not create a separate allowance or raise the limit. No AskMoina-specific quota or automatic retry is added.

The handler requires an authenticated AskMoina user. Missing identity, missing grant, inactive project, monthly quota exhaustion, timeout and empty retrieval are returned to Gemini as explicit limitations. The assistant must not invent source citations, silently switch projects or claim the book verified an unsupported answer. Retrieval calls are not automatically retried because a timeout can happen after the BRVIN quota reservation has succeeded.

This initial connector forwards searchable passage text and physical PDF-page provenance. If BRVIN returns only a page image without searchable text, AskMoina reports that this integration cannot interpret the image yet; it does not guess the page contents.

## Production release order

1. BRVIN PR #63 (connector) is merged as `91b6a499bd782ae298b41e790157c23682f10881`.
2. BRVIN PR #65 (AskMoina application identities) is merged as `0b3c621b83a28de2f4ca5da95db349b364558a60`; its D1 migration marker, application, production/preview environments, active Fatman grant and empty foreign-key check were verified.
3. AskMoina PR #370 is merged as `ce725d33df452de0e9df2f4613c70ec89592251e` and is deployed at 100% on Worker version `6cf38308-cb52-4745-8a14-be7678862730` (release version `0.4.170`).
4. Cloudflare settings confirm the private `BRVIN_SERVICE` → `brvin-service` / `BrvinRetrievalApi` binding and trusted `applicationEnvironmentId=00000000-0000-4000-8000-000000000202`; `BRVIN_DEFAULT_PROJECT_ID=fatman`. The preview configuration has no BRVIN binding or default project.
5. The production exact-page synthetic requested physical PDF page 14 through Gemini Live. Telemetry confirms `retrieveProjectContextV2` returned success for AskMoina production → Fatman with one source (about 6.7 seconds), and the smoke script progressed beyond this first command into the remaining voice/recovery/memory suite. The overall deployment workflow is still running; do not mark complete until it finishes.
6. The handler and unit tests cover authenticated-only exposure, exact-page citations, no result, image-only pages, project denial, quota exhaustion, and unavailable/missing binding. Fatman's monthly quota remains shared with other authorised consumers; no quota increase was made.
7. After the synthetic workflow completes, record its final result and then close M4 only if the remaining spoken-turn, network recovery, Live continuity, memory and history checks pass.

No preview binding or production D1 write is included in this consumer PR.
