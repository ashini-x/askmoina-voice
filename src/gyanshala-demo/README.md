# Gyanshala demo — setup and cleanup

Gyanshala-specific assets live in public/gyanshala-demo; backend and schema live in src/gyanshala-demo. A small router hook in src/index.ts and binding/asset-route additions in wrangler.jsonc are the only shared integration points.

## Required integrations
1. Cloudflare D1 database bound as GYANSHALA_DB.
2. Resend for college-email verification codes.
3. Twilio Verify for SMS verification.
4. GYANSHALA_ALLOWED_EMAIL_DOMAINS as a comma-separated allowlist of the real college domains.
5. GYANSHALA_OTP_SECRET as a dedicated long random secret.

## Worker secrets (add all in Workers & Pages → gyanshala-voice → Settings → Variables and Secrets)
- GYANSHALA_RESEND_API_KEY
- GYANSHALA_OTP_SECRET
- TWILIO_ACCOUNT_SID
- TWILIO_AUTH_TOKEN
- TWILIO_VERIFY_SERVICE_SID
- GYANSHALA_EMAIL_FROM: sender address verified in Resend, e.g. Gyanshala <verify@your-real-domain.in>
- GYANSHALA_ALLOWED_EMAIL_DOMAINS: real college domains, comma-separated, e.g. students.college.ac.in,college.ac.in

Do not enable signup until the database schema, email sender, Twilio Verify service, domain allowlist, and secret are configured and tested.

## Database initialization
Apply schema.sql to gyanshala-demo-prod using the Cloudflare dashboard D1 Console. Apply the same schema to gyanshala-demo-preview for preview use. Never apply it to askmoina-prod.

## Auth design
- Signup and sign-in require email OTP and Twilio SMS OTP.
- Exact college domain allowlist; no public email providers unless explicitly added.
- Unique email and phone constraints in the Gyanshala-only database.
- OTP values are not returned to the browser or stored in plaintext.
- Session cookie is Secure and HttpOnly; session tokens are stored as keyed hashes.
- Profile completion saves full name, branch, year of study and campus residence.

## Removal after the demo
Delete public/gyanshala-demo and src/gyanshala-demo. Remove the Gyanshala import/dispatch from src/index.ts, its D1 binding and asset route entries from wrangler.jsonc, and any Gyanshala-only validation steps. Confirm no other code imports the module before deleting. After confirming nothing needs to be retained, delete gyanshala-demo-prod and gyanshala-demo-preview and remove its Worker secrets/variables.
