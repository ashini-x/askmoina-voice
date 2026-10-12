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
  it("redirects guest page requests to sign-in without resolving a static asset", async () => {
    for (const path of ["/copilot", "/copilot.html"]) {
      const mock = setup();
      const response = await worker.fetch(new Request("https://askmoina.test" + path), mock.env, ctx);
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("https://askmoina.test/login");
      expect(mock.requestedPath()).toBe("");
    }
  });

  it("denies guest access to camera scripts and styles", async () => {
    for (const path of ["/copilot.js", "/copilot.css"]) {
      const mock = setup();
      const response = await worker.fetch(new Request("https://askmoina.test" + path), mock.env, ctx);
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ error: "authentication_required" });
      expect(mock.requestedPath()).toBe("");
    }
  });

});
