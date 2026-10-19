# Project Veda — Phase 3 Private Installation Portal

**Scope:** separate installable PWA control panel, using the existing server-side AskMoina admin authentication. The portal flag is independent from the listening/runtime flag.

## Portal routes

- `/veda`, `/veda/`, `/veda/install`: private portal page.
- `/veda/manifest.webmanifest`: separate Veda PWA identity, `/veda/` scope, and install start URL.
- `/veda/icon.svg`, `/veda/app.css`, `/veda/app.js`, `/veda/service-worker.js`: private app assets. The service worker stays scoped to `/veda/` and does not cache authenticated pages or API results.
- `/api/veda/status`: admin-only deployment/status diagnostic.

All Veda routes remain routed through the Worker before static-asset serving. The Worker validates admin session state for the HTML, every asset, the manifest, the service worker and the API. Anonymous page requests redirect to the existing `/admin/login`; anonymous API/asset requests receive a no-store 401 response. Unsupported Veda paths remain closed.

## Authentication and revocation

Phase 3 reuses the existing `isAdmin()` check from `src/continuity.ts` and the existing admin login configured with `ADMIN_DASHBOARD_USER`, `ADMIN_DASHBOARD_PASSWORD` and `ADMIN_SESSION_SECRET`. No new credential or secret is introduced. The portal sign-out button posts to `/api/auth/logout`, whose existing same-origin check revokes the session and clears session cookies.

Responses include no-store, same-origin resource policy, anti-framing, nosniff, restrictive Content Security Policy and a Permissions Policy that disallows microphone and camera access.

## Independent flags

- `VEDA_PORTAL_ENABLED=true`: publishes the private portal only after admin authorization.
- `VEDA_ENABLED=false`: keeps listening, pairing, commands and the Live runtime disabled.

The portal status explicitly reports the runtime as disabled/not ready. There is no microphone access, pairing endpoint, Live socket, or session-start action in Phase 3. The PWA shell is served from Worker code to preserve the authorization gate; no public static asset may bypass it.

## Tests and deployment evidence

Phase 3 tests cover anonymous denial for pages/assets/APIs, authenticated portal and manifest response, separate portal/runtime flags, unknown-route denial and unaffected AskMoina routes. The Wrangler config tests ensure production and preview both enable only the portal and keep the runtime disabled.

Deployment status must be recorded only after CI has passed and production routes have been checked. PWA installation behavior still needs confirmation in a supported real browser/device; a Worker smoke test alone does not prove install-prompt availability on all platforms.

## Exit gate

- [x] Admin-only route design and server-side gate implemented.
- [x] Existing admin login/session revocation reused without new secrets.
- [x] Separate install manifest, icon, app shell, and service-worker scope implemented.
- [x] Runtime and microphone stay disabled by default.
- [ ] CI and AskMoina regressions pass.
- [ ] Production portal routes and anonymous-denial behavior verified after deployment.
- [ ] Admin confirms the portal can be opened; real-device installability is recorded separately.
