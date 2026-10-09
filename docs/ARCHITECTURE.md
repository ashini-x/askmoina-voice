# AskMoina architecture

- Cloudflare Worker serves the website and handles HTTP/API routes.
- The Worker creates Google OAuth access tokens from server-side service-account secrets.
- `/api/voice/socket` proxies a browser WebSocket to Vertex AI Gemini Live. The Worker locks the model and system instruction in the first setup frame.
- `GCP_CLIENT_EMAIL`, `GCP_PRIVATE_KEY`, and `GCP_PRIVATE_KEY_ID` are Cloudflare Worker secrets. The project ID, model, and location are non-secret configuration.
- Durable Objects provide basic per-IP handshake rate limiting.
- D1 is reserved for structured preferences, consent, usage, audit events, and user-controlled memory metadata.
- Queues handle asynchronous tasks only; live audio frames never go through a Queue.
- Raw audio is not stored by default.
- Current implementation includes the OAuth token helper and live WebSocket proxy. Browser microphone capture, audio playback, interruption handling, reliable reconnection/session resumption, stronger user identity, and full abuse/cost controls remain future implementation and must not be described as shipped.
