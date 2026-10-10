# Release process

1. Work on a feature branch for substantial changes.
2. Run TypeScript checks and automated tests.
3. Review security, migrations, configuration and secrets.
4. Merge to main only when checks pass.
5. Cloudflare Workers Builds deploys the production branch after checks succeed.
6. Apply reviewed production D1 migrations deliberately before relying on new indexes or schema.
7. Verify the active Worker deployment, scheduled-retention trigger, health endpoint, Cloudflare errors and critical flows.
8. Confirm the scheduled production health workflow passes. Separately perform an end-to-end voice and selected-memory test before widening access; the health endpoint alone does not exercise provider audio.
9. Roll back to the last known-good deployment if health or critical flows degrade.

Production migrations must be reviewed and applied deliberately.
