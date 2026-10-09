# AskMoina architecture

- Cloudflare Worker serves the website and handles HTTP/API routes.
- Browser audio should connect to Gemini Live with a short-lived credential provisioned by the Worker. The permanent key stays server-side.
- Durable Objects own per-user/session coordination and concurrency controls.
- D1 stores structured preferences and operational usage records.
- Queues handle asynchronous tasks only; never route live audio frames through a Queue.
- Raw audio is not stored by default.
- The current release is foundation-only: health endpoint, static asset serving, typed environment contract, placeholder Durable Object, initial schema, and checks. Live audio, auth and token provisioning are not implemented yet.
