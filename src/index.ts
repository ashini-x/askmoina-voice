import type { Env } from "./config/env";
import { getGoogleAccessToken } from "./auth/google";

export { UserState } from "./sessions/user-state";

const SYSTEM_INSTRUCTION =
  "You are AskMoina, a warm, respectful voice companion for people in Assam, especially Upper Assam. Speak naturally and clearly. When the user speaks Assamese, try to respond in Assamese; otherwise follow their language. Do not claim to be human. Be honest about uncertainty. Do not present yourself as a substitute for emergency, medical, legal, or mental-health professionals. Keep responses conversational and concise.";

const json = (data: unknown, status = 200): Response =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

function hasVertexCredentials(env: Env): boolean {
  return Boolean(
    env.GCP_PROJECT_ID?.trim() &&
      env.GCP_CLIENT_EMAIL?.trim() &&
      env.GCP_PRIVATE_KEY?.trim(),
  );
}

async function checkVoiceRateLimit(request: Request, env: Env): Promise<boolean> {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) return false;

  try {
    const rateId = env.USER_STATE.idFromName("voice-rate:" + ip);
    const rateStub = env.USER_STATE.get(rateId);
    const response = await rateStub.fetch("https://user-state/rate-limit", {
      method: "POST",
    });
    if (!response.ok) return false;
    const result = (await response.json()) as { allowed?: boolean };
    return result.allowed === true;
  } catch {
    return false;
  }
}

async function handleVoiceSocket(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return json({ error: "websocket_upgrade_required" }, 426);
  }

  const requestUrl = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (!origin || origin !== requestUrl.origin) {
    return json({ error: "forbidden_origin" }, 403);
  }
  if (!hasVertexCredentials(env)) {
    return json({ error: "voice_not_configured" }, 503);
  }
  if (!(await checkVoiceRateLimit(request, env))) {
    return json({ error: "rate_limited_or_temporarily_unavailable" }, 429);
  }

  let accessToken: string;
  try {
    accessToken = await getGoogleAccessToken(env);
  } catch {
    return json({ error: "voice_authentication_unavailable" }, 503);
  }

  const projectId = env.GCP_PROJECT_ID.trim();
  const location = env.GEMINI_LOCATION?.trim() || "global";
  const model = env.GEMINI_MODEL?.trim() || "gemini-3.8-live";
  const upstreamHost =
    location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`;
  const upstreamUrl =
    `https://${upstreamHost}/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent`;

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      headers: {
        Upgrade: "websocket",
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch {
    return json({ error: "voice_provider_unavailable" }, 502);
  }

  const upstreamSocket = upstreamResponse.webSocket;
  if (!upstreamSocket || upstreamResponse.status !== 101) {
    return json({ error: "voice_provider_unavailable" }, 502);
  }

  const pair = new WebSocketPair();
  const [clientSocket, workerSocket] = Object.values(pair) as [WebSocket, WebSocket];
  workerSocket.accept();
  upstreamSocket.accept();

  let setupForwarded = false;
  let closed = false;

  const closeBoth = (code = 1000, reason = "Session closed") => {
    if (closed) return;
    closed = true;
    try {
      if (workerSocket.readyState === WebSocket.OPEN) workerSocket.close(code, reason);
    } catch {
      // Ignore duplicate close races.
    }
    try {
      if (upstreamSocket.readyState === WebSocket.OPEN) upstreamSocket.close(code, reason);
    } catch {
      // Ignore duplicate close races.
    }
  };

  workerSocket.addEventListener("message", (event: MessageEvent) => {
    if (upstreamSocket.readyState !== WebSocket.OPEN) return;

    if (!setupForwarded) {
      if (typeof event.data !== "string") {
        closeBoth(1008, "JSON setup required");
        return;
      }

      try {
        const message = JSON.parse(event.data) as { setup?: unknown };
        if (!message || typeof message !== "object" || !message.setup) {
          closeBoth(1008, "First message must be setup");
          return;
        }

        const securedSetup = {
          model: `projects/${projectId}/locations/${location}/publishers/google/models/${model}`,
          generation_config: {
            response_modalities: ["audio"],
          },
          system_instruction: {
            parts: [{ text: SYSTEM_INSTRUCTION }],
          },
          input_audio_transcription: {},
          output_audio_transcription: {},
        };
        upstreamSocket.send(JSON.stringify({ setup: securedSetup }));
        setupForwarded = true;
      } catch {
        closeBoth(1008, "Invalid setup message");
      }
      return;
    }

    try {
      upstreamSocket.send(event.data);
    } catch {
      closeBoth(1011, "Upstream send failed");
    }
  });

  upstreamSocket.addEventListener("message", (event: MessageEvent) => {
    if (workerSocket.readyState !== WebSocket.OPEN) return;
    try {
      workerSocket.send(event.data);
    } catch {
      closeBoth(1011, "Client send failed");
    }
  });

  workerSocket.addEventListener("close", (event: CloseEvent) => {
    closeBoth(event.code || 1000, "Client disconnected");
  });
  workerSocket.addEventListener("error", () => closeBoth(1011, "Client socket error"));
  upstreamSocket.addEventListener("close", (event: CloseEvent) => {
    closeBoth(event.code || 1000, "Voice provider disconnected");
  });
  upstreamSocket.addEventListener("error", () => closeBoth(1011, "Voice provider socket error"));

  const configuredSeconds = Number.parseInt(env.MAX_LIVE_SESSION_SECONDS || "540", 10);
  const sessionSeconds = Number.isFinite(configuredSeconds) && configuredSeconds > 0
    ? Math.min(configuredSeconds, 540)
    : 540;
  setTimeout(() => closeBoth(1000, "Session time limit reached"), sessionSeconds * 1_000);

  return new Response(null, { status: 101, webSocket: clientSocket });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        app: "askmoina-voice",
        version: env.APP_VERSION || "0.2.0",
        environment: env.ENVIRONMENT || "unknown",
        status: hasVertexCredentials(env)
          ? "vertex-live-proxy-configured"
          : "vertex-live-proxy-awaiting-secrets",
        model: env.GEMINI_MODEL || "gemini-3.8-live",
        location: env.GEMINI_LOCATION || "global",
      });
    }

    if (url.pathname === "/api/voice/socket") {
      return handleVoiceSocket(request, env);
    }

    if (url.pathname.startsWith("/api/")) return json({ error: "not_found" }, 404);
    return env.ASSETS.fetch(request);
  },

  async queue(batch: MessageBatch<unknown>): Promise<void> {
    for (const message of batch.messages) message.ack();
  },
};
