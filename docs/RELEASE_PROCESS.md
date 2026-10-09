# Release process

1. Work on a feature branch for substantial changes.
2. Run TypeScript checks and automated tests.
3. Review security, migrations, configuration and secrets.
4. Merge to main only when checks pass.
5. Cloudflare Workers Builds deploys the production branch after checks succeed.
6. Verify deployment revision, health endpoint, errors and critical flows.
7. Roll back to the last known-good deployment if health degrades.

Production migrations must be reviewed and applied deliberately.
