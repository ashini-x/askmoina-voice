# AskMoina Voice

A voice-first AI companion for Assam, starting with Upper Assam. Built as a web application on Cloudflare Workers, with real-time browser audio planned through the Gemini Live API.

## Project status

**Foundation stage.** This repository currently establishes the project structure, static website shell, Worker health endpoint, typed environment contract, and automated checks. Live audio, authentication, token provisioning, D1, background queues, and production session controls are not yet considered shipped.

## Architecture principles

- Cloudflare Worker is the HTTP/API entry point and serves the static site.
- Durable Objects own explicitly scoped per-user/session state and coordination.
- D1 is the durable relational store for accounts, preferences, usage, audit events, and user-controlled memory metadata.
- Cloudflare Queues handle only asynchronous/non-interactive work; live audio frames never go through a Queue.
- Browser audio connects to Gemini Live using short-lived credentials provisioned by the Worker. The permanent Gemini API key must remain server-side.
- Secrets never belong in Git.
- Type-checks and automated tests must pass before production deployment.
- Raw audio is not stored by default. Memory and retention policies must be explicit and user-controllable.

## Environments

- development: local/test behavior only.
- staging: isolated test resources and credentials.
- production: Cloudflare production resources and secrets.

Never point preview deployments at production user data by default.

## Deployment

Cloudflare Workers Builds should connect to this repository with main as the production branch. Recommended commands:

- Build: npm run check && npm test
- Deploy: npm run deploy

The first deployment is a bootstrap release, not a working AI voice service. Do not enable public voice sessions until the Live API token endpoint, access controls, rate/cost limits, and browser audio integration have been implemented and tested.

## Security

Never commit API keys, Cloudflare tokens, local .dev.vars, passwords, session-signing keys, production database exports, raw user conversations, or private logs. Use Cloudflare Worker secrets for runtime credentials.

See docs/ARCHITECTURE.md, docs/SECURITY_MODEL.md, docs/PRIVACY.md, and docs/RELEASE_PROCESS.md.
