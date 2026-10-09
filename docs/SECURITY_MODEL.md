# AskMoina security model

## Secrets

- The Google service-account JSON is configured as a Cloudflare Worker Secret named `GCP_SERVICE_ACCOUNT_JSON`.
- Do not put service-account JSON, private keys, access tokens, or API keys into Git, public HTML/JS, logs, or error responses.
- The Worker requests Google OAuth access tokens server-side and never sends the access token or private key to the browser.
- Vertex AI model and system instruction are pinned on the Worker; the browser cannot select another model or override the instruction through its first setup frame.

## Abuse controls

- Origin is checked exactly against the Worker request origin. This is a browser cross-site control, not standalone authentication.
- Durable Objects enforce a five connection attempts/minute per-IP limit, one active connection per IP, a 30-minute daily session budget per IP, a one-hour aggregate daily voice budget, a maximum 9-minute session, and at most five concurrent sessions globally.
- Raw IPs are SHA-256 hashed for Durable Object identifiers.
- A session reserves its maximum possible duration before opening the upstream model connection. Early disconnects reconcile reserved time to actual elapsed time. If the Worker disappears without a release, the reservation remains charged until its daily limit resets, which intentionally fails closed.
- The code fails closed when the rate/budget Durable Object cannot be reached.

## Limitations

- IP-based limits can be evaded with VPNs/proxies and may affect multiple legitimate users behind a shared network.
- These controls are application usage caps, not Google Cloud billing caps. The project owner must still monitor billing and set budgets/alerts in Google Cloud.
- The same service-account key is shared with another application; using it in AskMoina does not isolate its IAM permissions or its blast radius. Key rotation and/or a dedicated least-privilege identity remains the stronger eventual mitigation.
- Add Turnstile/human verification, explicit consent/session UI, and real-device end-to-end tests before large-scale anonymous availability.
