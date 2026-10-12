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
  it("redirects guest Co-Pilot page requests to the root sign-in overlay without resolving a static asset", async () => {
    for (const path of ["/copilot", "/copilot.html"]) {
      const mock = setup();
      const response = await worker.fetch(new Request("https://askmoina.test" + path), mock.env, ctx);
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("https://askmoina.test/");
      expect(mock.requestedPath()).toBe("");
    }
  });

  it("keeps camera JavaScript private while allowing the CSS needed to render the sign-in overlay", async () => {
    const scriptMock = setup();
    const script = await worker.fetch(new Request("https://askmoina.test/copilot.js"), scriptMock.env, ctx);
    expect(script.status).toBe(401);
    expect(await script.json()).toMatchObject({ error: "authentication_required" });
    expect(scriptMock.requestedPath()).toBe("");

    const styleMock = setup();
    const style = await worker.fetch(new Request("https://askmoina.test/copilot.css"), styleMock.env, ctx);
    expect(style.status).toBe(200);
    expect(style.headers.get("Content-Type")).toContain("text/css");
    expect(await style.text()).toContain(".show-problem-button");
    expect(styleMock.requestedPath()).toBe("");
  });

});
