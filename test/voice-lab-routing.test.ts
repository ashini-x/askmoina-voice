import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { handleContinuityRequest } from "../src/continuity";
import type { Env } from "../src/config/env";

function mockEnv() {
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
  let requestedAssetPath = "";
  return {
    env: {
      DB: db,
      ADMIN_DASHBOARD_USER: "admin",
      ADMIN_DASHBOARD_PASSWORD: "test-admin-password",
      ADMIN_SESSION_SECRET: "test-session-secret-with-sufficient-entropy",
      ASSETS: {
        async fetch(request: Request) {
          requestedAssetPath = new URL(request.url).pathname;
          return new Response("<!doctype html><title>Voice Audition Lab</title>", {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        },
      },
    } as unknown as Env,
    requestedAssetPath: () => requestedAssetPath,
  };
}

const ctx = { waitUntil(_promise: Promise<unknown>) {} } as unknown as ExecutionContext;

describe("Voice Audition Lab routing", () => {
  it("serves the lab via the canonical path without an asset redirect loop", async () => {
    const mock = mockEnv();
    const login = await handleContinuityRequest(
      new Request("https://askmoina.test/admin/login", {
        method: "POST",
        headers: { Origin: "https://askmoina.test", "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "test-admin-password" }),
      }),
      mock.env,
      ctx,
    );
    expect(login?.status).toBe(200);
    const cookie = (login?.headers.get("Set-Cookie") || "").split(";")[0];

    const response = await worker.fetch(
      new Request("https://askmoina.test/voice-lab", { headers: { Cookie: cookie } }),
      mock.env,
      ctx,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Voice Audition Lab");
    expect(mock.requestedAssetPath()).toBe("/voice-lab");
    expect(response.status).not.toBe(307);

    // The compatibility .html entry point must normalize to the same clean path.
    const aliasResponse = await worker.fetch(
      new Request("https://askmoina.test/voice-lab.html", { headers: { Cookie: cookie } }),
      mock.env,
      ctx,
    );
    expect(aliasResponse.status).toBe(200);
    expect(mock.requestedAssetPath()).toBe("/voice-lab");
  });

  it("redirects unauthenticated users to admin login", async () => {
    const mock = mockEnv();
    const response = await worker.fetch(
      new Request("https://askmoina.test/voice-lab"),
      mock.env,
      ctx,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://askmoina.test/admin/login");
    expect(mock.requestedAssetPath()).toBe("");
  });
});
