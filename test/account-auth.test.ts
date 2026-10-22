import { describe, expect, it } from "vitest";
// @ts-expect-error Node runtime import used only by the Vitest source-contract assertion.
import { readFileSync } from "node:fs";
import worker from "../src/index";
import { handleAuthRequest, getAuthenticatedUserId } from "../src/auth/accounts";
import type { Env } from "../src/config/env";

const ctx = { waitUntil(_promise: Promise<unknown>) {} } as unknown as ExecutionContext;
const LOGIN_FIXTURE = "Face ID Touch ID Phone number + OTP backdrop-filter:blur authSheet No guest access";
const AUDIO_FIXTURE = '<!doctype html><title>askmoina audio</title><button id="toggleVoice">Start talking</button><section id="mathFundCard">Math course</section><p>moinaOS 1 · moinaOS 2 · Invite only</p>';

function envMock(): Env {
  const db = { prepare(_sql: string) { return {
    bind(..._args: unknown[]) { return this; },
    async run() { return { meta: { changes: 0 } }; },
    async first<T>() { return null as T | null; },
    async all<T>() { return { results: [] as T[] }; },
  }; } };
  const assets = { async fetch(request: Request) {
    const path = new URL(request.url).pathname;
    return new Response(path === "/login.html" ? LOGIN_FIXTURE
      : path === "/account.html" ? "Your AskMoina ID"
      : path === "/audio" ? AUDIO_FIXTURE : "auth", { status: 200 });
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
  it("routes new users to an account page that presents the supported methods", async () => {
    const r = await handleAuthRequest(new Request("https://askmoina.test/login"), envMock());
    expect(r?.status).toBe(200);
    const body = await r?.text();
    expect(body).toContain("Face ID");
    expect(body).toContain("Touch ID");
    expect(body).toContain("Phone number + OTP");
    expect(r?.headers.get("Cache-Control")).toBe("no-store");
  });

  it("does not treat a browser cookie as an account identity", async () => {
    const r = new Request("https://askmoina.test/", { headers: { Cookie: "moina_visitor=" + "A".repeat(43) } });
    expect(await getAuthenticatedUserId(r, envMock())).toBeNull();
  });

  it("serves the public audio-first product home without signup while keeping the camera route gated", async () => {
    const env = envMock();
    const status = await worker.fetch(new Request("https://askmoina.test/api/voice/status"), env, ctx);
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ available: false, reason: "not_configured" });

    const root = await worker.fetch(new Request("https://askmoina.test/"), env, ctx);
    expect(root.status).toBe(200);
    expect(root.headers.get("Set-Cookie")).toBeNull();
    const html = await root.text();
    expect(html).toContain('id="toggleVoice"');
    expect(html).toContain('id="mathFundCard"');
    expect(html).toContain("moinaOS 1");
    expect(html).toContain("moinaOS 2");
    expect(html).not.toContain('id="videoPreview"');
    expect(html).not.toContain("Face ID");
    expect(html).not.toContain("Sign up");
    const copilot = await worker.fetch(new Request("https://askmoina.test/copilot"), env, ctx);
    expect(copilot.status).toBe(302);
    expect(copilot.headers.get("Location")).toBe("https://askmoina.test/");
  });

  it("logs out through the same-origin endpoint and expires the session cookie", async () => {
    const response = await handleAuthRequest(new Request("https://askmoina.test/api/auth/logout", {
      method: "POST", headers: { Origin: "https://askmoina.test" }
    }), envMock());
    expect(response?.status).toBe(200);
    expect(await response?.json()).toMatchObject({ ok: true });
    expect(response?.headers.get("Set-Cookie")).toContain("moina_session=; Max-Age=0");
  });

  it("redirects the account page for an unauthenticated request", async () => {
    const r = await handleAuthRequest(new Request("https://askmoina.test/account"), envMock());
    expect(r?.status).toBe(302);
    expect(r?.headers.get("Location")).toBe("https://askmoina.test/login");
  });

  it("does not force a platform-only authenticator during passkey registration", async () => {
    const response = await handleAuthRequest(authPost("passkey/register/options"), envMock());
    expect(response?.status).toBe(200);
    const options = await response?.json() as {
      authenticatorSelection?: { residentKey?: string; userVerification?: string; authenticatorAttachment?: string };
    };
    expect(options.authenticatorSelection).toMatchObject({
      residentKey: "required",
      userVerification: "required"
    });
    expect(options.authenticatorSelection?.authenticatorAttachment).toBeUndefined();
  });

  it("supports discoverable passkey login without restricting the credential list", async () => {
    const response = await handleAuthRequest(authPost("passkey/login/options"), envMock());
    expect(response?.status).toBe(200);
    const options = await response?.json() as { userVerification?: string; allowCredentials?: unknown[] };
    expect(options.userVerification).toBe("required");
    expect(options.allowCredentials || []).toHaveLength(0);
  });
});
