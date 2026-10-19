import type { Env } from "../config/env";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
};

/**
 * Veda owns a separate SQLite-backed Durable Object namespace.
 *
 * Phase 2 deliberately exposes no session mutation API. Pairing, leases,
 * commands, and session lifecycle are implemented in later phases. In
 * particular this class does not inherit AskMoina's quota/session guard.
 */
export class VedaSessionState {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/_internal/health") {
      return Response.json({
        ok: true,
        feature: "veda",
        component: "session-state",
        featureEnabled: this.env.VEDA_ENABLED?.trim().toLowerCase() === "true",
        runtimeReady: false,
      }, { headers: NO_STORE_HEADERS });
    }

    return Response.json({ error: "not_found" }, {
      status: 404,
      headers: NO_STORE_HEADERS,
    });
  }
}
