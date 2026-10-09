import type { Env } from "./config/env";
import { getGoogleAccessToken } from "./auth/google";

export { UserState } from "./sessions/user-state";

const SYSTEM_INSTRUCTION =
  "You are AskMoina, a warm, respectful voice companion for people in Assam, especially Upper Assam. Speak naturally and clearly. When the user speaks Assamese, try to respond in Assamese; otherwise follow their language. Do not claim to be human. Be honest about uncertainty. Do not present yourself as a substitute for emergency, medical, legal, or mental-health professionals. Keep responses conversational and concise.";

const json = (data: unknown, status = 200): Response =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

function positiveInt(value: string | undefined, fallback: number, maximum: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function hasVertexCredentials(env: Env): boolean {
  const hasJson = Boolean(env.GCP_SERVICE_ACCOUNT_JSON?.trim());
  const hasSplitSecrets = Boolean(env.GCP_CLIENT_EMAIL?.trim() && env.GCP_PRIVATE_KEY?.trim());
  return Boolean(env.GCP_PROJECT_ID?.trim() && (hasJson || hasSplitSecrets));
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function callGuard(
  env: Env,
  objectName: string,
  path: "/session/acquire" | "/session/release",
  body: Record<string, unknown>,
): Promise<{ ok: boolean; allowed?: boolean }> {
  try {
    const id = env.USER_STATE.idFromName(objectName);
    const stub = env.USER_STATE.get(id);
    const response = await stub.fetch(`https://user-state${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (path === "/session/release") return { ok: response.ok };
    const result = (await response.json()) as { allowed?: boolean };
    return { ok: response.ok, allowed: result.allowed === true };
  } catch {
    return { ok: false, allowed: false };
  }
}

interface VoiceReservation {
  sessionId: string;
  ipObjectName: string;
  globalObjectName: string;
}

async function reserveVoiceSession(request: Request, env: Env): Promise<VoiceReservation | null> {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) return null;

  const ipHash = await sha256(ip);
  const ipObjectName = `voice-ip:${ipHash}`;
  const globalObjectName = "voice-global-budget";
  const sessionId = crypto.randomUUID();
  const now = Date.now();
  const maxSessionSeconds = positiveInt(env.MAX_LIVE_SESSION_SECONDS, 540, 540);
  const ipOptions = {
    sessionId,
    now,
    maxSessionSeconds,
    maxDailySeconds: positiveInt(env.MAX_DAILY_SESSION_SECONDS, 1_800, 1_800),
    maxConcurrentSessions: positiveInt(env.MAX_CONCURRENT_SESSIONS_PER_USER, 1, 1),
    enforceRateLimit: true,
  };

  const ipResult = await callGuard(env, ipObjectName, "/session/acquire", ipOptions);
  if (!ipResult.ok || !ipResult.allowed) return null;

  const globalResult = await callGuard(env, globalObjectName, "/session/acquire", {
    sessionId,
    now,
    maxSessionSeconds,
    maxDailySeconds: positiveInt(env.MAX_GLOBAL_DAILY_SESSION_SECONDS, 3_600, 3_600),
    maxConcurrentSessions: positiveInt(env.MAX_GLOBAL_CONCURRENT_SESSIONS, 5, 5),
    enforceRateLimit: false,
  });

  if (!globalResult.ok || !globalResult.allowed) {
    await callGuard(env, ipObjectName, "/session/release", { sessionId, now: Date.now() });
    return null;
  }

  return { sessionId, ipObjectName, globalObjectName };
}

async function releaseVoiceSession(
  env: Env,
  reservation: VoiceReservation,
): Promise<void> {
  await Promise.all([
    callGuard(env, reservation.ipObjectName, "/session/release", {
      sessionId: reservation.sessionId,
      now: Date.now(),
    }),
    callGuard(env, reservation.globalObjectName, "/session/release", {
      sessionId: reservation.sessionId,
      now: Date.now(),
    }),
  ]);
}

async function handleVoiceSocket(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return json({ error: "websocket_upgrade_required" }, 426);
  }

  const requestUrl = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (!origin || origin !== requestUrl.origin) {
    return json({ error: "forbidden_origin" }, 403);
  }
  if (!hasVertexCredentials(env)) return json({ error: "voice_not_configured" }, 503);

  const reservation = await reserveVoiceSession(request, env);
  if (!reservation) {
    return json({ error: "voice_capacity_or_daily_limit_reached" }, 429);
  }

  let accessToken: string;
  try {
    accessToken = await getGoogleAccessToken(env);
  } catch {
    await releaseVoiceSession(env, reservation);
    return json({ error: "voice_authentication_unavailable" }, 503);
  }

  const projectId = env.GCP_PROJECT_ID.trim();
  const location = env.GEMINI_LOCATION?.trim() || "us-central1";
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
    await releaseVoiceSession(env, reservation);
    return json({ error: "voice_provider_unavailable" }, 502);
  }

  const upstreamSocket = upstreamResponse.webSocket;
  if (!upstreamSocket || upstreamResponse.status !== 101) {
    await releaseVoiceSession(env, reservation);
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
    ctx.waitUntil(releaseVoiceSession(env, reservation));
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
          generation_config: { response_modalities: ["audio", "text"] },
          system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
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

  workerSocket.addEventListener("close", (event: CloseEvent) => closeBoth(event.code || 1000, "Client disconnected"));
  workerSocket.addEventListener("error", () => closeBoth(1011, "Client socket error"));
  upstreamSocket.addEventListener("close", (event: CloseEvent) => closeBoth(event.code || 1000, "Voice provider disconnected"));
  upstreamSocket.addEventListener("error", () => closeBoth(1011, "Voice provider socket error"));

  setTimeout(
    () => closeBoth(1000, "Session time limit reached"),
    positiveInt(env.MAX_LIVE_SESSION_SECONDS, 540, 540) * 1_000,
  );

  return new Response(null, { status: 101, webSocket: clientSocket });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        app: "askmoina-voice",
        version: env.APP_VERSION || "0.3.0",
        environment: env.ENVIRONMENT || "unknown",
        status: hasVertexCredentials(env)
          ? "vertex-live-proxy-configured"
          : "vertex-live-proxy-awaiting-secrets",
        model: env.GEMINI_MODEL || "gemini-3.8-live",
        location: env.GEMINI_LOCATION || "us-central1",
      });
    }

    if (url.pathname === "/api/voice/socket") return handleVoiceSocket(request, env, ctx);
    if (url.pathname.startsWith("/api/")) return json({ error: "not_found" }, 404);
    return env.ASSETS.fetch(request);
  },

  async queue(batch: MessageBatch<unknown>): Promise<void> {
    for (const message of batch.messages) message.ack();
  },
};
