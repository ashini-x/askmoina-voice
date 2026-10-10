# AskMoina security model

## Secrets

- The Google service-account JSON is configured as the Cloudflare Worker Secret `GCP_SERVICE_ACCOUNT_JSON`.
- The admin password and session-signing secret are Cloudflare Worker Secrets named `ADMIN_DASHBOARD_PASSWORD` and `ADMIN_SESSION_SECRET`. The username is a non-secret variable.
- Do not put service-account JSON, private keys, access tokens, recovery codes, vault plaintext, passwords, or production exports into Git, public HTML/JS, logs or error responses.
- The Worker requests Google OAuth access tokens server-side and never sends those credentials to the browser.
- Vertex AI model and base system instruction are pinned on the Worker; the browser cannot select another model or override base controls.
- Public site assets receive a restrictive Content Security Policy, clickjacking protection, MIME-sniffing protection, a no-referrer policy, same-origin resource policy and a microphone-only permissions policy.

## Memory Vault

- Vault data is encrypted in the browser with Web Crypto AES-GCM-256. Each encryption uses a fresh 96-bit IV. Authenticated additional data binds ciphertext to the vault ID.
- A cryptographically random 256-bit recovery code is generated locally. PBKDF2-SHA-256 with 600,000 iterations and a random salt derives a non-extractable AES-GCM key. The recovery code and key are never submitted to the Worker.
- Cloud backup authentication uses SHA-256 of the high-entropy recovery code. Writes require same-origin checks and optimistic revision matching. GET/DELETE/PUT require the recovery capability. The server stores ciphertext only.
- The optional local browser-unlock option stores a non-extractable CryptoKey in IndexedDB. It is convenience, not protection against a compromised browser profile or malicious same-origin JavaScript.
- The user's memory is not silently sent to Gemini. The user must explicitly enable the cross-tab voice-context toggle. Selected text is staged in plaintext local browser storage while enabled so other AskMoina tabs can read it; it is sent in the next and subsequent Gemini Live setup requests until disabled or the vault is locked. The UI discloses this, and toggle-off/lock removes the cache.
- Live voice is not end-to-end encrypted: audio is streamed to Vertex AI, and selected memory context is sent there by choice. The product UI states this.
- The first release supports manual memory notes and encrypted backup import/export; it does not automatically extract memory from speech or perform background multi-device merging.

## Operational data retention

- An hourly Worker Cron Trigger removes old voice-session metadata, usage events, stale pseudonymous visitor profiles and expired admin-login attempt records after the configured analytics retention period (30 days by default).
- Admin audit events are retained for 90 days. The operations dashboard reports the configured analytics period and the separate audit retention period.
- Cleanup uses indexed, bounded batches (up to four batches of 10,000 rows per table per run) to avoid unbounded delete statements. Logs report deleted counts, cleanup failures and tables that reached their batch limit so backlog can be monitored.
- Visitor profiles are retained while referenced by any remaining voice-session or usage-event record. Cleanup never deletes `vault_backups`; these are user-controlled encrypted backups and require a separate product retention/deletion policy.
- Voice timing logs record setup and first-audio timing plus frame size, never the audio payload or transcript text. They are available for latency analysis but are not themselves proof of native-language quality or a latency SLA.
- This app retention policy covers AskMoina's D1 operational records only. It does not make claims about provider-side processing or retention.

## Admin operations

- Admin login requires configured secrets, uses HMAC-SHA256 signed 12-hour cookies (HttpOnly, Secure, SameSite=Strict), a five-failure/ten-minute lockout and hashed IP keys.
- Mutating admin requests require same-origin checks. The dashboard exposes operational aggregates and recent session metadata only, not memory contents or transcripts.
- Set up Cloudflare Access on `/admin*` as a second control where practical. The public voice routes must remain reachable and must not be gated accidentally.
- Admin access is audited. Audit rows should not contain secrets or user-provided memory text.

## Abuse controls

- Origin is checked exactly against the Worker request origin. This is a browser cross-site control, not standalone user authentication.
- Durable Objects enforce a five connection attempts/minute limit per IP, one active session per IP, daily voice budgets, a maximum nine-minute session and at most five concurrent sessions globally.
- Raw IPs are SHA-256 hashed for Durable Object identifiers. The continuity cookie hash is a separate pseudonymous identifier.
- The WebSocket proxy limits client frame size, validates 16 kHz PCM audio input, caps input message rate/volume and rejects unsupported protocol fields.
- The app's daily limits are application controls, not Google Cloud billing caps; monitor provider billing independently.

## Remaining limitations

- Anonymous cookie continuity cannot reliably identify the same human across devices and may be lost when browser data is cleared.
- Cloud backup recovery is intentionally impossible without the user-held recovery code or a usable local device key. Recovery-code loss can mean permanent loss of a cloud-only vault.
- Browser XSS/malware can read data while the vault is unlocked or access same-origin operations. CSP and dependency discipline help but do not eliminate this class of risk.
- IP-based controls can affect shared networks and can be evaded with VPNs/proxies.
- Before a public launch, complete real-device browser/audio acceptance, independent cryptographic review, privacy/legal review, provider data retention verification and abuse testing.
