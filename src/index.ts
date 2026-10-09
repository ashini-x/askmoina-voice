import type { Env } from "./config/env";
export { UserState } from "./sessions/user-state";

const json = (data: unknown, status = 200): Response =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

async function issueLiveToken(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const origin = request.headers.get("Origin");
  const requestUrl = new URL(request.url);
  if (!origin || origin !== requestUrl.origin) {
    return json({ error: "forbidden_origin" }, 403);
  }

  if (!env.GEMINI_API_KEY) {
    return json({ error: "voice_not_configured", message: "Voice service is not configured yet." }, 503);
  }

  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) return json({ error: "request_unavailable" }, 400);

  const rateId = env.USER_STATE.idFromName("token-rate:" + ip);
  const rateStub = env.USER_STATE.get(rateId);
  const rateResponse = await rateStub.fetch("https://user-state/rate-limit", { method: "POST" });
  if (!rateResponse.ok) {
    return json({ error: "rate_limited" }, 429);
  }
  const rateData = await rateResponse.json() as { allowed?: boolean };
  if (!rateData.allowed) return json({ error: "rate_limited" }, 429);

  const now = Date.now();
  const payload = {
    uses: 1,
    expireTime: new Date(now + 30 * 60 * 1000).toISOString(),
    newSessionExpireTime: new Date(now + 60 * 1000).toISOString(),
    liveConnectConstraints: {
      model: env.GEMINI_MODEL || "gemini-3.8-live",
      config: {
        responseModalities: ["AUDIO"],
        sessionResumption: {},
        systemInstruction: {
          parts: [{
            text: "You are AskMoina, a warm, respectful voice companion for people in Assam, especially Upper Assam. Speak naturally and clearly. When the user speaks Assamese, try to respond in Assamese; otherwise follow their language. Do not claim to be human. Be honest about uncertainty. Do not present yourself as a substitute for emergency, medical, legal, or mental-health professionals. Keep responses conversational and concise."
          }]
        }
      }
    }
  };

  let upstream: Response;
  try {
    upstream = await fetch("https://generativelanguage.googleapis.com/v1beta/auth_tokens", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": env.GEMINI_API_KEY
      },
      body: JSON.stringify(payload)
    });
  } catch {
    return json({ error: "voice_provider_unavailable" }, 502);
  }

  if (!upstream.ok) {
    // Do not forward provider details or credentials to the browser.
    return json({ error: "voice_token_unavailable" }, 502);
  }

  const result = await upstream.json() as { name?: string; expireTime?: string; newSessionExpireTime?: string };
  if (!result.name) return json({ error: "invalid_provider_response" }, 502);

  return json({
    token: result.name,
    model: env.GEMINI_MODEL || "gemini-3.8-live",
    expiresAt: result.expireTime ?? null,
    startBy: result.newSessionExpireTime ?? null
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        app: "askmoina-voice",
        version: env.APP_VERSION || "0.1.0",
        environment: env.ENVIRONMENT || "unknown",
        status: env.GEMINI_API_KEY ? "voice-token-endpoint-configured" : "voice-token-endpoint-awaiting-secret"
      });
    }

    if (url.pathname === "/api/voice/token") {
      return issueLiveToken(request, env);
    }

    if (url.pathname.startsWith("/api/")) return json({ error: "not_found" }, 404);
    return env.ASSETS.fetch(request);
  },

  async queue(batch: MessageBatch<unknown>): Promise<void> {
    for (const message of batch.messages) message.ack();
  }
};
