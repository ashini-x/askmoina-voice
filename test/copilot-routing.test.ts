import { describe, expect, it } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/config/env";

const ctx = { waitUntil(_promise: Promise<unknown>) {} } as unknown as ExecutionContext;

function setup() {
  let requestedPath = "";
  const db = {
    prepare(_sql: string) {
      return {
        bind(..._args: unknown[]) { return this; },
        async run() { return { meta: { changes: 0 } }; },
        async first<T>() { return null as T | null; },
        async all<T>() { return { results: [] as T[] }; },
      };
    },
  };
  const env = {
    DB: db,
    ASSETS: {
      async fetch(request: Request) {
        requestedPath = new URL(request.url).pathname;
        return new Response("<!doctype html><title>Live Co-Pilot · AskMoina</title>", {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      },
    },
  } as unknown as Env;
  return { env, requestedPath: () => requestedPath };
}

describe("public Live Co-Pilot routing", () => {
  it("serves the clean /copilot route with camera permissions and security headers", async () => {
    const mock = setup();
    const response = await worker.fetch(new Request("https://askmoina.test/copilot"), mock.env, ctx);
    expect(response.status).toBe(200);
    const page = await response.text();
    expect(page).toContain("Live Co-Pilot");
    expect(page).toContain('id="videoPreview"');
    expect(mock.requestedPath()).toBe("");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Permissions-Policy")).toContain("camera=(self)");
    expect(response.headers.get("Content-Security-Policy")).toContain("connect-src 'self' wss:");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("normalizes /copilot.html to the clean asset path", async () => {
    const mock = setup();
    const response = await worker.fetch(new Request("https://askmoina.test/copilot.html"), mock.env, ctx);
    expect(response.status).toBe(200);
    expect(mock.requestedPath()).toBe("");
  });

  it("serves JavaScript and CSS directly from the Worker without depending on a new asset manifest", async () => {
    const mock = setup();
    const script = await worker.fetch(new Request("https://askmoina.test/copilot.js"), mock.env, ctx);
    expect(script.status).toBe(200);
    expect(script.headers.get("Content-Type")).toContain("text/javascript");
    expect(await script.text()).toContain("copilot_mode: true");
    const css = await worker.fetch(new Request("https://askmoina.test/copilot.css"), mock.env, ctx);
    expect(css.status).toBe(200);
    expect(css.headers.get("Content-Type")).toContain("text/css");
    expect(await css.text()).toContain(".focus-marker");
  });

});
