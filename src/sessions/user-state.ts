import type { Env } from "../config/env";

type RateRecord = { windowStart: number; count: number };

export class UserState {
  constructor(private readonly state: DurableObjectState, private readonly env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/rate-limit") {
      const now = Date.now();
      const key = "token-rate";
      const current = await this.state.storage.get<RateRecord>(key);
      const windowMs = 60_000;
      const limit = 5;
      const record = !current || now - current.windowStart >= windowMs
        ? { windowStart: now, count: 1 }
        : { ...current, count: current.count + 1 };

      await this.state.storage.put(key, record);
      if (record.count > limit) {
        return Response.json({ allowed: false }, { status: 429, headers: { "Cache-Control": "no-store" } });
      }
      return Response.json({ allowed: true }, { headers: { "Cache-Control": "no-store" } });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true, component: "user-state", environment: this.env.ENVIRONMENT || "unknown" });
    }

    return Response.json({ error: "not_found" }, { status: 404 });
  }
}
