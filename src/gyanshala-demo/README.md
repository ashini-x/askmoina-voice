# Gyanshala demo — setup and cleanup

Gyanshala-specific assets live in public/gyanshala-demo; backend and schema live in src/gyanshala-demo. Shared integration points are a small router hook in src/index.ts, asset-route entries and the dedicated GYANSHALA_DB binding in wrangler.jsonc, plus isolated validation steps in GitHub Actions.

## Institutional email policy

Set GYANSHALA_ALLOWED_EMAIL_DOMAINS to the trusted institutional root domain(s), for example: nits.ac.in.

A root accepts the exact domain and all true subdomains:
- student@nits.ac.in
- student@civil.nits.ac.in
- student@cse.nits.ac.in
- student@a-new-department.nits.ac.in

The matcher requires a dot boundary. It rejects a lookalike such as student@nits.ac.in.example.com. New department subdomains beneath nits.ac.in work automatically without a code change. Add another root only when that institution is explicitly approved.

## Required integrations

1. Cloudflare D1 bound as GYANSHALA_DB.
2. Resend for college-email verification codes.
3. GYANSHALA_ALLOWED_EMAIL_DOMAINS configured with trusted institutional roots.
4. GYANSHALA_OTP_SECRET set to a long random secret used to hash OTPs and session tokens.

## Worker configuration

In Cloudflare Dashboard, open Workers & Pages → askmoina-voice → Settings → Variables and Secrets.

Secrets:
- GYANSHALA_RESEND_API_KEY: preferably an email-sending-only Resend key.
- GYANSHALA_OTP_SECRET: a separate long random secret.

Variables:
- GYANSHALA_EMAIL_FROM: a sender address on a domain verified in Resend, e.g. Gyanshala <verify@your-verified-domain.example>.
- GYANSHALA_ALLOWED_EMAIL_DOMAINS: comma-separated institutional roots. For NIT Silchar, use nits.ac.in.

Do not enable signup until the database schema, verified Resend sender, trusted domain roots, and OTP secret are configured and tested.

## Database initialization

Production database: gyanshala-demo-prod.
Preview database: gyanshala-demo-preview.

Both databases contain Gyanshala-only tables. Do not apply this schema to askmoina-prod.

## Authentication behaviour

- Signup and sign-in require one-time email verification.
- The allowed domain is the configured institutional root or a subdomain ending at a real dot boundary.
- Email addresses are unique in the Gyanshala database.
- OTP codes are never returned to the browser or stored in plaintext.
- Sessions use Secure, HttpOnly cookies; only a keyed hash of each session token is stored.
- Verification codes expire after 10 minutes, attempts are capped, and email sends are rate-limited.
- Profile completion stores full name, branch, year of study, and campus residence.
- No phone number, SMS provider, Twilio or Firebase Phone Authentication is required.

## Removal after the demo

Delete public/gyanshala-demo and src/gyanshala-demo. Remove the Gyanshala import/dispatch from src/index.ts, its D1 binding and asset-route entries from wrangler.jsonc, and Gyanshala-specific validation steps. Confirm no other code imports the module before deleting. After confirming no data needs to be retained, delete gyanshala-demo-prod and gyanshala-demo-preview and remove Gyanshala-only Worker secrets/variables.
