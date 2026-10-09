# AskMoina Voice

A voice-first AI companion for Assam, starting with Upper Assam. Built on Cloudflare Workers and Google Cloud Vertex AI Gemini Live.

## Project status

**Foundation plus Vertex AI Live proxy.** The Worker serves the static site, creates Google OAuth access tokens from service-account secrets, and proxies a WebSocket to Gemini Live on Vertex AI. Browser-side microphone capture, audio playback, interruption handling, session reconnection/resumption, and final end-to-end voice acceptance tests still need implementation.

## Architecture principles

- Cloudflare Worker serves the website and handles HTTP/API routes.
- Google Cloud Vertex AI Gemini Live is billed to the configured Google Cloud project, subject to that project's billing and credit eligibility.
- Google service-account credentials stay in Cloudflare Worker secrets; no credential JSON belongs in Git or browser code.
- The browser connects to the Worker at `/api/voice/socket`. The Worker obtains a short-lived OAuth access token server-side and proxies the live WebSocket to Vertex AI.
- The Worker pins the model and system instruction rather than trusting browser-supplied setup.
- Durable Objects provide per-IP handshake rate limiting.
- D1 is the durable relational store for future structured preferences, usage, audit events, and user-controlled memory metadata.
- Cloudflare Queues handle only asynchronous/non-interactive work; live audio frames never go through a Queue.
- Raw audio is not stored by default.
- Type-checks and automated tests must pass before production deployment.

## Runtime configuration

Non-secret Worker variables in `wrangler.jsonc`:

- `GCP_PROJECT_ID`
- `GEMINI_LOCATION` (currently `global`)
- `GEMINI_MODEL` (currently `gemini-3.8-live`)

Cloudflare Worker secrets:

- `GCP_CLIENT_EMAIL`
- `GCP_PRIVATE_KEY`
- `GCP_PRIVATE_KEY_ID`

The service account needs permission to invoke Vertex AI models, and the Vertex AI API must be enabled in the Google Cloud project.

## Deployment

Cloudflare Workers Builds should connect to this repository with `main` as the production branch. Recommended commands:

- Build: `npm run check && npm test`
- Deploy: `npm run deploy`

A successful `/api/health` response confirms configuration state only; it does not prove an end-to-end voice conversation. Do not announce a working voice service until browser microphone capture, audio playback, interruptions, errors, and session limits have been tested in a real browser.

## Security

Never commit API keys, Cloudflare tokens, local `.dev.vars`, passwords, session-signing keys, service-account JSON/private keys, production database exports, raw user conversations, or private logs. Use Cloudflare Worker secrets for runtime credentials.

See `docs/ARCHITECTURE.md`, `docs/SECURITY_MODEL.md`, `docs/PRIVACY.md`, and `docs/RELEASE_PROCESS.md`.
