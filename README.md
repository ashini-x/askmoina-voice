# AskMoina Voice

AskMoina is a voice-first AI companion for Assam, built on Cloudflare Workers and Google Cloud Vertex AI Gemini Live.

## Current capabilities

- Browser-based live voice with microphone permission, 16 kHz PCM input and streamed audio replies.
- A local-first Memory Vault at `/vault`: user-entered notes are encrypted in the browser using Web Crypto AES-GCM before they are stored in IndexedDB.
- Optional encrypted cloud backups. The Worker stores ciphertext, salt, IV and key-derivation metadata; it never receives the vault decryption key or plaintext memories.
- Optional `Use these memories in AskMoina on this browser tab`. Only selected notes are passed to Gemini at the start of the next voice session after explicit user opt-in.
- A protected operations dashboard at `/admin`, with aggregate visitor/session metrics and recent session outcomes. It does not expose memory contents, transcripts or audio.
- Pseudonymous per-browser visitor IDs and operational session telemetry without storing raw audio or conversation text in the app database.

## Memory Vault security boundary

**Vault backups are end-to-end encrypted storage; the entire live voice session is not end-to-end encrypted.** Voice audio is processed by Google Cloud Vertex AI. If a user explicitly enables context in AskMoina, selected memory text is sent to Gemini to personalise that session. The service provider therefore sees the audio and selected context needed to provide the service, subject to its processing and retention terms.

Vault encryption uses AES-GCM-256, a random 256-bit recovery code, PBKDF2-SHA-256 (600,000 iterations), a random salt and IV, and authenticated additional data bound to the vault ID. The recovery code is generated on the device and is not uploaded. Cloud backup authorisation is derived by hashing the recovery code; the API never accepts the code in a URL. Store the recovery kit safely: AskMoina cannot recover a lost code.

Memory notes are entered and managed by the user in this release. Automatic extraction of memories from speech is not enabled. While 'Use these memories' is enabled, selected note text also exists as plaintext in local browser storage so separate tabs can use it; disabling the control or locking the vault clears this context. The cache is not sent to AskMoina storage, but it is sent to Gemini for each new voice session while enabled. On-device encryption does not protect unlocked data from a compromised browser/device or malicious same-origin JavaScript. The optional browser-unlock key is stored only in that browser's IndexedDB and should only be enabled on a trusted device.

## Architecture and security controls

- Google service-account credentials are stored only as Cloudflare Worker Secrets. Never place secrets in Git or browser code.
- The Worker pins the model and base system instruction; browser clients cannot select a model.
- WebSocket browser connections must use the exact same origin as the Worker.
- Durable Objects enforce connection-attempt, session-duration, per-IP daily usage and global capacity limits. The IP hash is used for abuse controls, not personal identity.
- The anonymous continuity cookie uses a random token; only its SHA-256 hash is used as the server-side pseudonymous visitor ID.
- D1 stores operational metadata and encrypted vault backups, not decrypted memory notes, microphone recordings or transcript archives.
- The admin dashboard uses HMAC-signed, 12-hour HttpOnly/Secure/SameSite cookies and a login throttle. Configure `ADMIN_DASHBOARD_PASSWORD` as a Worker Secret before using it.
- An hourly bounded retention task removes operational analytics after the configured period (30 days by default), keeps admin audit records for 90 days, and deliberately preserves encrypted vault backups. Cloudflare logs flag cleanup failures or tables reaching their per-run batch limit.
- A scheduled production health workflow checks the public health endpoint and confirms the Worker still reports its Vertex AI route. This is a configuration smoke test, not proof of successful live audio, response latency, or Assamese speech quality.
- Configure Cloudflare Access in front of `/admin*` as an additional protection where practical.
- App-level usage limits are not Google Cloud billing hard caps. Use Google Cloud budgets and billing reports for actual spend.
- Raw audio and transcripts are not saved by default.

## Build, tests and deployment

Recommended validation:

- `npm run check`
- `node --check public/app.js`
- `npm test`

Apply migrations in order (including `migrations/0002_continuity_vault.sql`) to local/preview databases. Production already has the continuity/vault tables provisioned; verify schemas before applying a migration.

## Important limitations

- Browser identity is profile-level, not verified human identity. Clearing cookies/local browser data can break continuity; the recovery kit protects the vault backup, not account identity.
- Optional encrypted backup sync is manual and revision-checked to avoid silent overwrites; this first release is not an automatic multi-device merge system.
- Admin costs are not inferred from session duration. Use Google Cloud billing as the source of actual spend.
- Real device/mobile acceptance, a security review of the cryptographic lifecycle and the AI provider data-flow/retention configuration are required before making high-assurance privacy claims or opening access broadly.

See `docs/ARCHITECTURE.md`, `docs/SECURITY_MODEL.md`, `docs/PRIVACY.md`, and `docs/RELEASE_PROCESS.md`.
