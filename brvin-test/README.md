# BRVIN Text Test Worker

This directory contains the static text interface for the separate `brvin-text-test` Worker. The Worker is an independent target in this repository; it is not a route or feature inside the production `askmoina-voice` Worker.

## Purpose

Provide a small reference consumer for testing the BRVIN v2 connector:
- discover only projects authorised for this application's trusted environment;
- submit a text query and/or exact physical PDF page;
- display returned passages with book title and page provenance;
- expose clear denied, not-ready, quota and unavailable states.

This is an evidence-inspection console, not an LLM chat product. It does not generate a final answer.

## Local development

```bash
npm run check
npx vitest run test/brvin-text-test-worker.test.ts
npx wrangler dev --config wrangler.brvin-test.jsonc
```

The local Worker can serve the UI, but the BRVIN API reports `BRVIN_NOT_CONNECTED` until a real Service Binding is configured. Unit tests use a mocked v2 RPC binding.

## Connection and deployment boundary

The initial Wrangler config deliberately has:
- a separate Worker name and entrypoint;
- `workers_dev: false` and no public route;
- no D1, Durable Object, queue, Gemini or other AskMoina production bindings;
- no BRVIN Service Binding yet.

Do not add a fabricated `applicationEnvironmentId`. M5 must first create a distinct application, environment, isolated test project and explicit app-project grant through the protected BRVIN admin workflow. M6 then adds the Service Binding with the generated environment ID and provisions the approved test access/deployment path. Until then this Worker is a local/CI scaffold only.

Never borrow AskMoina Voice's production environment ID, point the test application at Fatman by default, or accept application/environment identity from the browser.
