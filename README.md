# AskMoina Voice

AskMoina is a voice-first AI companion for Assam, built on Cloudflare Workers and Google Cloud Vertex AI Gemini Live.

## Account access and identity

- AskMoina has no guest mode. Signup/sign-in is required before the home app, Co-Pilot, History, Key Memories, or voice endpoints can be used.
- Each account has a stable `uid_...` identifier in D1. Passkeys invoke native WebAuthn; the operating system handles Face ID, Touch ID, fingerprint, Windows Hello, or its configured fallback. AskMoina never receives biometric images.
- Phone OTP uses Twilio Verify. Configure Cloudflare Worker Secrets `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_VERIFY_SERVICE_SID` to enable SMS. Until configured, this path clearly reports unavailable rather than pretending an OTP was sent. AskMoina stores a keyed digest, not the readable phone number or OTP code.
- Application-level daily/per-browser/concurrent voice quotas are disabled. Gemini/Vertex and Cloudflare infrastructure limits still apply. During network backpressure, AskMoina drops stale/excess microphone packets instead of closing the whole conversation.

## Current capabilities

- Browser-based live voice with microphone permission, 16 kHz PCM input and streamed audio replies.
- Live Co-Pilot at `/copilot`: streams reduced-size camera frames with live audio, renders model-requested approximate focus labels, and supports tap-to-track local image-patch tracking between cloud updates.
- Experimental WebXR surface-anchor lab: on supporting devices/browsers, the optional **Spatial AR** control opens an immersive AR session and places a world anchor using hit testing and the WebXR Anchors API. The latest AI focus label, hint, instruction, and approximate screen region are carried into a 3D cue card. The screen region proposes an off-center hit-test ray where supported; directional controls let the user nudge that ray and restore the AI suggestion before confirming the point. For low-risk walkthroughs, the model may provide a bounded 2–5-step sequence. Each step has a progress state, requires explicit user confirmation, and clears the previous anchor before asking the user to align a fresh anchor for the next step. Completion reflects the user's confirmation, not independent verification that a real-world task succeeded. This is assisted targeting, not object recognition or segmentation. During an AR session, up to five cues can be pinned as simultaneous session-local anchors, and saved scene templates keep their labels/instructions on the current browser device across reloads. Browsers such as Chrome for Android do not expose persistent WebXR anchor handles, so saved templates do not preserve physical world positions; each cue must be re-aligned and re-anchored when a saved scene is loaded in a later session. Scene templates are stored in localStorage and are not cloud-synced. When Co-Pilot is already connected, the lab releases only its video track to let WebXR use the camera while the existing microphone, audio graph, and voice WebSocket stay connected. Camera frames are not sent while Spatial AR owns the camera, so ongoing answers do not have fresh visual updates; after AR ends, the app attempts to reacquire the camera and resume frame streaming. If AR cannot start or the camera cannot be reacquired, the app reports the limitation rather than claiming continuity. Unsupported browsers keep the normal camera/voice and screen-space tracking experience.
- Optional `Use these memories in AskMoina on this browser tab`. Only selected notes are passed to Gemini at the start of the next voice session after explicit user opt-in.
- A protected operations dashboard at `/admin`, with aggregate visitor/session metrics and recent session outcomes. It does not expose memory contents, transcripts or audio.
- Pseudonymous per-browser visitor IDs and operational session telemetry without storing raw audio or conversation text in the app database.

## Conversation history and memory

- Finalized user and assistant text, rolling summaries and task state are stored in account-scoped conversation history. Raw microphone audio and raw camera video are not saved as history.
- Reusable preferences are captured in Key Memories; users can review, edit, delete or pause preference learning from the Co-Pilot Library.
- New sessions receive bounded recent history context. When a user asks about an older detail, the Co-Pilot can search that account's saved transcript turns. This provides retrieval over the archive, not unlimited verbatim model context in every session.

## Architecture and security controls

- Google service-account credentials are stored only as Cloudflare Worker Secrets. Never place secrets in Git or browser code.
- The Worker pins the model, base system instruction, and Live voice; browser clients cannot override them. The current voice is Leda (documented by Google as “Youthful”); its quality for Upper Assamese must still be checked with native speakers.
- The Worker can append a source-attributed Assamese pronunciation-rule reference from D1 at live-session setup. Seed rules are bounded, fail open if the migration/table is unavailable, and remain explicitly unverified by local listeners until evaluated.
- WebSocket browser connections must use the exact same origin as the Worker.
- AskMoina does not enforce app-owned daily voice quotas, per-browser session quotas, fixed session-duration caps, or app-level concurrent-session caps. Short-lived network/payload abuse controls and media backpressure still protect relay stability; they are not question-count or user-usage limits. The IP hash is used only for burst-abuse controls, not personal identity.
- App-level usage caps are disabled for both users and admin. Google/Gemini, Cloudflare platform safeguards, and project billing controls still apply; these provider/platform limits cannot be bypassed by AskMoina. Monitor Google Cloud Billing separately.
- The anonymous continuity cookie uses a random token; only its SHA-256 hash is used as the server-side pseudonymous visitor ID.
- D1 stores account-scoped conversation text, rolling summaries, task state, reusable preferences and operational metadata; it does not store raw microphone audio or raw camera video.
- The admin dashboard uses HMAC-signed, 12-hour HttpOnly/Secure/SameSite cookies and a login throttle. Configure `ADMIN_DASHBOARD_PASSWORD` as a Worker Secret before using it.
- An hourly bounded retention task removes operational analytics after the configured period (30 days by default), keeps admin audit records for 90 days, Cloudflare logs flag cleanup failures or tables reaching their per-run batch limit.
- The Worker logs setup latency and time-to-first-assistant-audio along with frame size only; it does not log audio payloads or transcript text. These timings are measurement inputs, not an established latency SLA.
- A scheduled production health workflow checks the public health endpoint and confirms the Worker still reports its Vertex AI route. This is a configuration smoke test, not proof of successful live audio or Assamese speech quality.
- Configure Cloudflare Access in front of `/admin*` as an additional protection where practical.
- App-level usage limits are not Google Cloud billing hard caps. Use Google Cloud budgets and billing reports for actual spend.
- Raw audio and transcripts are not saved by default.

## Build, tests and deployment

Recommended validation:

- `npm run check`
- `node --check public/app.js`
- `npm test`

Apply migrations in order (including `migrations/0002_continuity_vault.sql`) to local/preview databases. Production already has continuity and account-history tables provisioned; verify schemas before applying a migration.

## Important limitations

- Browser identity is profile-level, not verified human identity. Clearing cookies/local browser data can break continuity; saved history is associated with the signed-in account, not a browser-only identity token.
- Optional encrypted backup sync is manual and revision-checked to avoid silent overwrites; this first release is not an automatic multi-device merge system.
- Admin costs are not inferred from session duration. Use Google Cloud billing as the source of actual spend.
- Real device/mobile acceptance, a security review of the cryptographic lifecycle and the AI provider data-flow/retention configuration are required before making high-assurance privacy claims or opening access broadly.

See `docs/ARCHITECTURE.md`, `docs/SECURITY_MODEL.md`, `docs/PRIVACY.md`, and `docs/RELEASE_PROCESS.md`.
