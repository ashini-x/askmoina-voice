# AskMoina architecture

- Cloudflare Worker serves the website and handles HTTP/API routes.
- The Worker creates Google OAuth access tokens from server-side service-account secrets.
- `/api/voice/socket` proxies a browser WebSocket to Vertex AI Gemini Live. The Worker locks the model and system instruction in the first setup frame.
- `GCP_CLIENT_EMAIL`, `GCP_PRIVATE_KEY`, and `GCP_PRIVATE_KEY_ID` are Cloudflare Worker secrets. The project ID, model, and location are non-secret configuration.
- Durable Objects provide basic per-IP handshake rate limiting.
- D1 is reserved for structured preferences, consent, usage, audit events, and user-controlled memory metadata.
- Queues handle asynchronous tasks only; live audio frames never go through a Queue.
- Raw audio is not stored by default.
- Current implementation includes the OAuth token helper and live WebSocket proxy. The browser now has initial microphone capture, PCM audio streaming/playback, transcription display, and interruption queue clearing. This remains a prototype until verified on real devices. Reliable reconnection/session resumption, stronger user identity, human verification, and full abuse/cost controls remain outstanding.


## Account identity and passkeys

- A D1 `uid_...` is the stable product identity. There is no anonymous browser identity for access; protected pages, voice status, and voice WebSocket require an account session.
- Device authentication uses WebAuthn platform passkeys. The operating system handles biometric checks; AskMoina does not collect or store raw biometric samples. D1 stores credential public keys/counters and credential IDs.
- Phone login uses Twilio Verify. D1 stores an HMAC digest of the normalized phone number, not the raw number or OTP value. SMS is disabled until the corresponding Worker Secrets are configured.
- Application usage/concurrency reservations and its app-owned session timer have been removed. Cloudflare resource limits and Gemini/Vertex provider limits remain authoritative.
