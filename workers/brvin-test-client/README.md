# BRVIN Test Client Worker

This is an independent, text-first consumer fixture for BRVIN 2, hosted in the
`askmoina-voice` repository. It is **not** a route or feature inside the
existing AskMoina Voice Worker.

## Isolation boundary

- Separate Worker name, entrypoint and Wrangler configuration.
- No AskMoina Voice D1, Durable Objects, Queue, Gemini credentials, routes or
  session state are bound here.
- No BRVIN Service Binding or trusted environment identity is configured yet.
  M6's Connect Application wizard is expected to provision those after the
  application registry and admin workflow are ready.
- The browser calls only this Worker's same-origin API. The private BRVIN RPC
  connector is imported and used only by this Worker server-side.
- All API calls require a tester token. Keep it in a Cloudflare Worker secret
  or local `.dev.vars`; never put it into the URL, source code or frontend bundle.

## Local development

Create a local `.dev.vars` file in the repository root (already ignored by Git):

```dotenv
BRVIN_TEST_ACCESS_TOKEN=replace-with-a-local-test-token
```

Then run:

```bash
npx wrangler dev --config wrangler.brvin-test-client.jsonc
```

The interface will be available at the local Wrangler URL. It will initially
show that BRVIN is not connected; this is expected. The application and UI are
being prepared as the reference client that the M6 wizard will connect.

## Separate deployment

To deploy this Worker independently (not as part of the AskMoina Voice release):

```bash
npx wrangler secret put BRVIN_TEST_ACCESS_TOKEN --config wrangler.brvin-test-client.jsonc
npx wrangler deploy --config wrangler.brvin-test-client.jsonc
```

Do not run the deployment until the tester access boundary and Cloudflare
account/preview policy have been reviewed. The initial M4 PR only scaffolds and
validates the Worker; it does not deploy it or bind it to production BRVIN.

## BRVIN integration

Once M5/M6 are available, the trusted Service Binding should be attached to
this Worker with a distinct BRVIN application/environment identity. The
browser must never supply that identity. The server checks the live
authorised-project list and readiness on each retrieval. A project ID is a
selector, never an authorisation credential.
