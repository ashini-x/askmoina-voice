import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { handleContinuityRequest, visitorIdFromRequest } from "../src/continuity";
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
  return { DB: db } as unknown as Env;
}
const ctx = { waitUntil(_promise: Promise<unknown>) {} } as unknown as ExecutionContext;

describe("AskMoina continuity identity", () => {
  it("returns a stable one-way hash for the same browser cookie", async () => {
    const token = "A".repeat(43);
    const a = await visitorIdFromRequest(new Request("https://askmoina.test/", { headers: { Cookie: "moina_visitor=" + token } }));
    const b = await visitorIdFromRequest(new Request("https://askmoina.test/", { headers: { Cookie: "moina_visitor=" + token } }));
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(a).not.toBe(token);
  });

  it("does not accept malformed identity cookies as a visitor ID", async () => {
    const id = await visitorIdFromRequest(new Request("https://askmoina.test/", { headers: { Cookie: "moina_visitor=not-a-valid-token" } }));
    expect(id).toBeNull();
  });
});

describe("Encrypted vault API boundary", () => {
  it("requires the high-entropy recovery capability to read a backup", async () => {
    const response = await handleContinuityRequest(
      new Request("https://askmoina.test/api/vault/123e4567-e89b-42d3-a456-426614174000"),
      mockEnv(), ctx,
    );
    expect(response?.status).toBe(401);
    expect(await response?.json()).toMatchObject({ error: "recovery_code_required" });
  });

  it("rejects cross-origin backup writes", async () => {
    const response = await handleContinuityRequest(
      new Request("https://askmoina.test/api/vault/123e4567-e89b-42d3-a456-426614174000", {
        method: "PUT",
        headers: { Authorization: "Bearer " + "A".repeat(43), "Content-Type": "application/json", Origin: "https://attacker.example" },
        body: JSON.stringify({}),
      }),
      mockEnv(), ctx,
    );
    expect(response?.status).toBe(403);
    expect(await response?.json()).toMatchObject({ error: "forbidden_origin" });
  });

  it("requires an authenticated admin session before returning dashboard APIs", async () => {
    const response = await handleContinuityRequest(
      new Request("https://askmoina.test/admin/api/overview"),
      mockEnv(), ctx,
    );
    expect(response?.status).toBe(401);
    expect(await response?.json()).toMatchObject({ error: "unauthorized" });
  });

  it("serves parseable first-party client scripts", async () => {
    for (const path of ["/vault.js", "/continuity.js", "/admin.js", "/admin-login.js"]) {
      const response = await handleContinuityRequest(new Request("https://askmoina.test" + path), mockEnv(), ctx);
      expect(response?.status).toBe(200);
      const source = await response?.text();
      expect(() => new Function(source || "")).not.toThrow();
    }
  });

  it("serves the vault with no-store and anti-framing headers", async () => {
    const response = await handleContinuityRequest(
      new Request("https://askmoina.test/vault"),
      mockEnv(), ctx,
    );
    expect(response?.status).toBe(200);
    expect(response?.headers.get("Cache-Control")).toBe("no-store");
    expect(response?.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response?.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(response?.headers.get("Set-Cookie")).toContain("moina_visitor=");
  });
});

describe("selected browser memory reaches the Vertex session setup frame", () => {
  it("adds explicitly staged memory to the first setup frame", async () => {
    const response = await handleContinuityRequest(
      new Request("https://askmoina.test/continuity.js"),
      mockEnv(), ctx,
    );
    expect(response?.status).toBe(200);
    const source = await response!.text();

    function FakeWebSocket(this: { url: string; sent: string[] }, url: string) {
      this.url = url;
      this.sent = [];
    }
    FakeWebSocket.prototype.send = function(this: { sent: string[] }, data: string) {
      this.sent.push(data);
    };

    const stagedMemory = "my name is Raaz, so call me Raaz when you interact with me";
    const localStorage = { getItem: (key: string) => key === "askmoina.memory.context" ? stagedMemory : null };
    const sessionStorage = { getItem: (_key: string) => null };
    const window = { WebSocket: FakeWebSocket };
    runInNewContext(source, { window, localStorage, sessionStorage });

    const SocketConstructor = window.WebSocket as unknown as new (url: string) => { send(data: string): void; sent: string[] };
    const socket = new SocketConstructor("wss://askmoina.test/api/voice/socket");
    socket.send(JSON.stringify({ setup: { generationConfig: { responseModalities: ["AUDIO"] } } }));

    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0]).memory_context).toBe(stagedMemory);
  });

  it("bounds browser-staged memory before sending it over the socket", async () => {
    const response = await handleContinuityRequest(
      new Request("https://askmoina.test/continuity.js"),
      mockEnv(), ctx,
    );
    const source = await response!.text();

    function FakeWebSocket(this: { sent: string[] }, _url: string) { this.sent = []; }
    FakeWebSocket.prototype.send = function(this: { sent: string[] }, data: string) { this.sent.push(data); };
    const localStorage = { getItem: (_key: string) => "x".repeat(4_000) };
    const sessionStorage = { getItem: (_key: string) => null };
    const window = { WebSocket: FakeWebSocket };
    runInNewContext(source, { window, localStorage, sessionStorage });

    const SocketConstructor = window.WebSocket as unknown as new (url: string) => { send(data: string): void; sent: string[] };
    const socket = new SocketConstructor("wss://askmoina.test/api/voice/socket");
    socket.send(JSON.stringify({ setup: {} }));
    expect(JSON.parse(socket.sent[0]).memory_context).toHaveLength(3_000);
  });
});
