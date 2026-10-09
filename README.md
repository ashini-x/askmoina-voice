# AskMoina Voice

A voice-first AI companion for Assam, starting with Upper Assam. Built on Cloudflare Workers and Google Cloud Vertex AI Gemini Live.

## Project status

**Voice prototype.** The Worker uses server-side Google service-account OAuth and proxies a WebSocket to Gemini Live on Vertex AI. The browser now captures microphone audio, streams 16 kHz PCM, plays 24 kHz PCM responses, and displays available text transcripts. Real-device end-to-end verification, improved audio worklet/resampling, reconnection/resumption, and public-beta abuse controls remain before broad launch.

## Architecture and security controls

- Google Cloud Vertex AI Gemini Live is billed to the configured Google Cloud project, subject to that project's billing and credit eligibility.
- The service-account JSON is a Cloudflare Worker Secret named `GCP_SERVICE_ACCOUNT_JSON`; it never belongs in Git or browser code.
- The Worker pins the model and system instruction instead of trusting browser-supplied setup.
- Browser connections must use the exact same origin as the Worker.
- Durable Objects enforce a five connection attempts/minute limit per IP, one active session per IP, a per-IP daily session budget, and a global daily session budget.
- Initial beta defaults: at most 540 seconds per session, 1,800 seconds/day per IP, 3,600 seconds/day globally, and 5 concurrent global sessions. These are app-level limits, not Google Cloud billing hard caps.
- IPs are SHA-256 hashed before they are used as Durable Object identifiers. Raw audio is not stored by default.
- Cloudflare Queues handle only asynchronous work; live audio frames never go through a Queue.

## Runtime configuration

Non-secret Worker variables in `wrangler.jsonc` include `GCP_PROJECT_ID`, `GEMINI_LOCATION`, `GEMINI_MODEL`, and the session limits.

One Cloudflare Worker Secret is needed to use the existing JSON key:

- `GCP_SERVICE_ACCOUNT_JSON`: the full service-account JSON contents.

The account must already have permission to invoke Vertex AI, and the Vertex AI API must be enabled in the Google Cloud project. No additional Google Cloud resources are required by this application code.

## Production caveat

Cloudflare app limits reduce exposure but cannot make a long-lived service-account key risk-free. They are also not a Google Cloud billing hard cap. Do not treat a successful `/api/health` response as proof that audio works. Test browser microphone capture, playback, interruption, errors, and session limits before public launch. Add a human-verification control such as Turnstile before opening anonymous access broadly.

## Deployment

Cloudflare Workers Builds should connect to `main`. Recommended commands:

- Build: `npm run check && npm test`
- Deploy: `npm run deploy`

## Security

Never commit service-account JSON/private keys, API keys, Cloudflare tokens, local `.dev.vars`, passwords, production database exports, raw user conversations, or private logs. Use Cloudflare Worker secrets for runtime credentials.

See `docs/ARCHITECTURE.md`, `docs/SECURITY_MODEL.md`, `docs/PRIVACY.md`, and `docs/RELEASE_PROCESS.md`.


## Private memory vault and operations dashboard

The memory vault is device-local and encrypted by default. Create a unique passphrase; the app derives an AES-256-GCM key in the browser using PBKDF2-SHA-256 (600,000 iterations), and never sends the passphrase to the Worker. Only facts you choose to mark for sharing, combined with the per-session sharing checkbox, are included in Gemini's setup context. Voice-session analytics store pseudonymous visitor IDs, timestamps, durations, outcomes and model configuration; they do not store raw audio, transcripts or decrypted memories.

Encrypted cloud backup is optional. It stores ciphertext plus a hash of a random access token for vault authentication. Download and securely store the recovery kit, and keep it separate from the vault passphrase. The kit contains the access credential and encrypted data; it does not contain the passphrase. The service cannot restore a lost passphrase.

The private admin dashboard is available at \`/admin\`. It requires \`ADMIN_DASHBOARD_PASSWORD\` and \`ADMIN_SESSION_SECRET\` Worker secrets; username defaults to \`admin\`. Use a strong, unique password and keep the session secret at least 32 characters long. It shows only operational analytics, not private memory contents.

### Database deployment

Apply migrations in order to production:
1. \`migrations/0001_initial_schema.sql\`
2. \`migrations/0002_memory_vault_admin.sql\`

The Worker includes a daily retention task for raw operational analytics. The current retention default is 30 days. Session durations are not a substitute for actual Google Cloud billing data. Use Google Cloud Billing for actual spend.
