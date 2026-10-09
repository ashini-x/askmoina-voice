# Release process

1. Work on a feature branch for substantial changes.
2. Run TypeScript checks and automated tests.
3. Review security, migrations, configuration and secrets.
4. Merge to main only when checks pass.
5. Cloudflare Workers Builds deploys the production branch after checks succeed.
6. Verify deployment revision, health endpoint, errors and critical flows.
7. Roll back to the last known-good deployment if health degrades.

Production migrations must be reviewed and applied deliberately.


## Production data and dashboard

- Apply D1 migrations sequentially and verify schema before deploying routes that depend on them.
- Configure `ADMIN_DASHBOARD_PASSWORD` and `ADMIN_SESSION_SECRET` as Worker secrets; never commit live values.
- Verify `/api/health`, the identity endpoint, vault backup/restore/delete, admin login throttling, and that an unauthenticated admin API call returns 401.
- Confirm the dashboard never serves decrypted vault contents. Actual AI billing must be checked in Google Cloud Billing.
