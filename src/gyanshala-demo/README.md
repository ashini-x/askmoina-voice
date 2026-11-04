# Gyanshala demo — setup and cleanup

## Smart Supply Locator — AI that searches, not chats

The **AI Supply Finder** is a distinct, purpose-built workflow. It is not a general Gemini chat screen. A student types a request such as “borrow a scientific calculator under ₹300 near my hostel”; the server asks Gemini to convert it into validated JSON filters, queries the Gyanshala D1 inventory in real time, filters out unavailable/insufficient stock, and ranks matched pickup hostels by walking-route distance if a Google Routes API key is configured. If not configured, it uses clearly labelled straight-line estimates. Google Maps walking directions are opened via a link; the local map frame uses the standard OpenStreetMap embed so it does not depend on MapLibre or a browser Google Maps key.

- Gemini is query interpretation only. The model never invents stock or supplies, and the application never renders general-purpose AI replies.
- Set the optional Worker secret `GYANSHALA_GEMINI_API_KEY` to enable Gemini query interpretation; `GYANSHALA_GEMINI_MODEL` defaults to `gemini-3.8-flash`. Without the key, the finder remains usable in keyword-fallback mode.
- Set optional secret `GYANSHALA_GOOGLE_MAPS_SERVER_KEY` with the Routes API enabled to return walking distance/time rather than direct-line estimates. Restrict it to the Routes API and server usage. The frontend’s Google Maps API/browser key is not needed for the OpenStreetMap map frame or the external directions link.
- In preview test mode only, the Worker seeds 50 supply templates across 17 hostel labels (850 synthetic hostel/item combinations), with varied conditions, donation/borrow/sale types, quantities, prices and availability. It also records reservations against preview accounts and restores stock when reservations are cancelled.
- The hostels listed use NIT Silchar hostel names from public institute listings, but all coordinates are synthetic, all stock is fictional, and every result is labelled as demo data. Do not use these demo coordinates for real travel. Replace them with verified entrances/pickup pins and real inventory before live use.

## Campus interfaces 7–15

The authenticated preview experience includes:
- **7. Home / Dashboard, 8. Explore / Browse, 9. Resource Details:** browse the shared catalogue, search by keyword, filter by category, and save a borrow request.
- **11. Real campus map & pickup points:** MapLibre GL JS renders OpenFreeMap vector tiles derived from OpenStreetMap, centred on the mapped NIT Silchar university feature. The interface includes zoom/rotation/pitch controls, browser geolocation on user action, clickable map labels, searchable mapped landmarks, an optional 3D-building layer when building data supports it, and a resource list associated with the selected map point.
- **12. Add / List an Item:** authenticated students can publish a listing under their own account with category, description, condition, lending/sale/free preference, amount, and one of the mapped campus locations as pickup point.
- **13. My Requests:** the signed-in student can review their sent requests and filter them by status.
- **14. Messages:** private conversations are attached to a resource request and are available only when the listing belongs to a real Gyanshala account. Messages are stored by the Gyanshala API, not external email or SMS.
- **15. Community / Offers & Needs:** students can publish an offer or need, filter/search the community board, express interest, and mark their own posts as fulfilled.

### Map accuracy and setup

The map does **not** use Google Maps and requires no Google Maps API key. It uses the MapLibre GL JS library and the OpenFreeMap `liberty` style with OpenStreetMap-derived vector tiles. The current showcase points are mapped feature centres for NIT Silchar, NITS Cricket Playground, NITS Football Ground, Indie Lake, NITS Childrens Park, NITS Mini Park and Football Ground Lake. These coordinates identify the mapped OSM feature, not a verified doorway or official pickup counter. Map labels, building outlines, paths and building-height metadata depend on the underlying OpenStreetMap coverage.

The current map does **not** claim live walking routes or verified travel times. Browser geolocation is only requested when the user presses the map's locate control. A network connection is required for the external library and vector tiles. OpenFreeMap is provided as-is without an availability guarantee; a high-traffic production launch may warrant a contracted tile/geocoding provider or self-hosted tiles. The Gyanshala shell alone allows the map CDN hosts in its Content Security Policy; unrelated AskMoina/Veda routes retain the existing restrictive policy.

For a genuinely detailed institute map, verify the building names, campus gates, entrances, accessible paths and safe pickup spots with NIT Silchar data. An official campus GIS export, facilities map, floor plans or a reviewed list of coordinates would allow us to add dependable building search, entrance-level markers and verified pedestrian routing. Until then, treat the selected OSM points as orientation landmarks and confirm exact meetup details with the other student.

The dedicated D1 schema contains `gyanshala_resources`, `gyanshala_resource_requests`, `gyanshala_messages`, `gyanshala_pickup_points`, `gyanshala_community_posts`, and `gyanshala_community_interests`. In guarded preview-test mode only, six sample resources and six community posts are seeded when the relevant tables are empty; the static OpenStreetMap pickup-point reference data is idempotently seeded into the dedicated Gyanshala database. Sample resources and posts are identified as previews and do not represent live student accounts. Resource requests and interest events are stored against the preview test account; messages require a request associated with a genuine student-owned listing. Owner approval/decline, verified indoor mapping, and external notifications are not included in these interfaces.


## Free preview verification testing

The Wrangler `previews.vars` block sets `GYANSHALA_ALLOWED_EMAIL_DOMAINS=nits.ac.in` and `GYANSHALA_PREVIEW_TEST_MODE=true`. In that preview environment only, signup/sign-in verification codes are generated normally but delivery is simulated; the one-time code is returned to the preview UI so the profile/session flow can be tested without purchasing a domain or configuring Resend.

The backend requires both `ENVIRONMENT=preview` and the exact `GYANSHALA_PREVIEW_TEST_MODE=true` flag. The production `vars` block must never contain this flag. Preview test accounts live in the separate Gyanshala preview D1 database. This does **not** prove ownership of an email address and must never be used as the student-facing production verification path. Before launch, configure the real Resend sender and secret, and verify real inbox delivery.


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
