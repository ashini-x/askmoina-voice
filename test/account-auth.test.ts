import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { handleAuthRequest, getAuthenticatedUserId } from "../src/auth/accounts";
import type { Env } from "../src/config/env";

const ctx = { waitUntil(_promise: Promise<unknown>) {} } as unknown as ExecutionContext;
const LOGIN_HTML = readFileSync(new URL("../public/login.html", import.meta.url), "utf8");

function envMock(): Env {
  const db = { prepare(_sql: string) { return {
    bind(..._args: unknown[]) { return this; },
    async run() { return { meta: { changes: 0 } }; },
    async first<T>() { return null as T | null; },
    async all<T>() { return { results: [] as T[] }; },
  }; } };
  const assets = { async fetch(request: Request) {
    const path = new URL(request.url).pathname;
    return new Response(path === "/login.html" ? LOGIN_HTML
      : path === "/account.html" ? "Your AskMoina ID" : "auth", { status: 200 });
  } };
  return { DB: db, ASSETS: assets } as unknown as Env;
}

function authPost(path: string): Request {
  return new Request("https://askmoina.test/api/auth/" + path, {
    method: "POST",
    headers: { Origin: "https://askmoina.test", "Content-Type": "application/json" },
    body: "{}",
  });
}

describe("unique account ID and no-guest access", () => {
  it("presents an iOS-inspired sign-in with passkeys and phone OTP", async () => {
    const r = await handleAuthRequest(new Request("https://askmoina.test/login"), envMock());
    expect(r?.status).toBe(200);
    const body = await r?.text();
    expect(body).toContain("Face ID");
    expect(body).toContain("Touch ID");
    expect(body).toContain("Phone number + OTP");
    expect(body).toContain("backdrop-filter:blur");
    expect(body).toContain("authSheet");
    expect(body).toContain("No guest access");
  });

  it("does not treat a browser cookie as an account identity", async () => {
    const r = new Request("https://askmoina.test/", { headers: { Cookie: "moina_visitor=" + "A".repeat(43) } });
    expect(await getAuthenticatedUserId(r, envMock())).toBeNull();
  });

  it("denies guest voice status and redirects from home and camera co-pilot", async () => {
    const env = envMock();
    const status = await worker.fetch(new Request("https://askmoina.test/api/voice/status"), env, ctx);
    expect(status.status).toBe(401);
    expect(await status.json()).toMatchObject({ error: "authentication_required" });
    for (const path of ["/", "/copilot"]) {
      const response = await worker.fetch(new Request("https://askmoina.test" + path), env, ctx);
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("https://askmoina.test/login");
    }
  });

  it("redirects the account page for an unauthenticated request", async () => {
    const r = await handleAuthRequest(new Request("https://askmoina.test/account"), envMock());
    expect(r?.status).toBe(302);
    expect(r?.headers.get("Location")).toBe("https://askmoina.test/login");
  });

  it("does not force a platform-only authenticator during passkey registration", async () => {
    const response = await handleAuthRequest(authPost("passkey/register/options"), envMock());
    expect(response?.status).toBe(200);
    const options = await response?.json();
    expect(options.authenticatorSelection).toMatchObject({
      residentKey: "required",
      userVerification: "required"
    });
    expect(options.authenticatorSelection.authenticatorAttachment).toBeUndefined();
  });

  it("supports discoverable passkey login without restricting the credential list", async () => {
    const response = await handleAuthRequest(authPost("passkey/login/options"), envMock());
    expect(response?.status).toBe(200);
    const options = await response?.json();
    expect(options.userVerification).toBe("required");
    expect(options.allowCredentials || []).toHaveLength(0);
  });
});
