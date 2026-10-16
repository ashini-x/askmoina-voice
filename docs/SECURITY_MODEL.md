# AskMoina security model

## Secrets

- The Google service-account JSON is configured as the Cloudflare Worker Secret `GCP_SERVICE_ACCOUNT_JSON`.
- The admin password and session-signing secret are Cloudflare Worker Secrets named `ADMIN_DASHBOARD_PASSWORD` and `ADMIN_SESSION_SECRET`. The username is a non-secret variable.
- Do not put service-account JSON, private keys, access tokens, passwords, raw user conversation data, or production exports into Git, public HTML/JS, logs or error responses.
- The Worker requests Google OAuth access tokens server-side and never sends those credentials to the browser.
- Vertex AI model and base system instruction are pinned on the Worker; the browser cannot select another model or override base controls.
- Public site assets receive a restrictive Content Security Policy, clickjacking protection, MIME-sniffing protection, a no-referrer policy, same-origin resource policy and a microphone-only permissions policy.

## Conversation history and memory

- Finalized user/assistant text, rolling summaries and task state are stored per authenticated account. Raw audio/video is not stored in the history tables.
- Reusable user preferences are stored in the account's Key Memories and may be used in later Live sessions. Preference learning can be paused; conversation history remains independent.
- A new session receives a bounded history index and excerpts. The model can search saved turns for older details on request; search is restricted to the authenticated user's own account.
- Saved text is sent to Google Cloud Vertex AI when needed for live response and continuity. Do not promise provider-level zero retention without verifying current account settings and terms.

## Operational data retention

- An hourly Worker Cron Trigger removes old voice-session metadata, usage events, stale pseudonymous visitor profiles and expired admin-login attempt records after the configured analytics retention period (30 days by default).
- Admin audit events are retained for 90 days. The operations dashboard reports the configured analytics period and the separate audit retention period.
- Cleanup uses indexed, bounded batches (up to four batches of 10,000 rows per table per run) to avoid unbounded delete statements. Logs report deleted counts, cleanup failures and tables that reached their batch limit so backlog can be monitored.
- Visitor profiles are retained while referenced by any remaining voice-session or usage-event record. 
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
- IP-based controls can affect shared networks and can be evaded with VPNs/proxies.
- Before a public launch, complete real-device browser/audio acceptance, independent cryptographic review, privacy/legal review, provider data retention verification and abuse testing.


## Account identity

- Protected product routes require an opaque HttpOnly account session and D1 `uid_...` identity; an anonymous visitor cookie is no longer accepted as identity.
- WebAuthn passkeys leave biometric processing to the operating system/browser. AskMoina stores public credentials/counters, never face images or fingerprints.
- Phone identities use HMAC-SHA-256 keyed by `AUTH_IDENTITY_PEPPER` (or the admin session secret if not set). Twilio Verify performs OTP delivery and verification; AskMoina does not save raw phone numbers or OTP codes.
- WebAuthn challenges expire after five minutes; account sessions expire after 30 days. OTP includes a per-number resend cooldown; it remains unavailable until the SMS provider secrets are configured.
