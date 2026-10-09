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


async function runOneShotVoiceProbe(env: Env): Promise<Response> {
  const attempts: Array<Record<string, unknown>> = [];
  let accessToken: string;
  try {
    accessToken = await getGoogleAccessToken(env);
  } catch {
    return json({ ok: false, stage: "oauth", error: "Could not obtain a provider access token." }, 502);
  }

  const projectId = env.GCP_PROJECT_ID.trim();
  const location = env.GEMINI_LOCATION?.trim() || "us-central1";
  const model = env.GEMINI_MODEL?.trim() || "gemini-3.8-live";
  const host = location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`;

  for (const apiVersion of ["v1beta1", "v1"]) {
    const started = Date.now();
    const upstreamUrl = `https://${host}/ws/google.cloud.aiplatform.${apiVersion}.LlmBidiService/BidiGenerateContent`;
    let response: Response;
    try {
      response = await fetch(upstreamUrl, {
        headers: { Upgrade: "websocket", Authorization: `Bearer ${accessToken}` },
      });
    } catch {
      attempts.push({ apiVersion, stage: "handshake", error: "Network request failed", elapsedMs: Date.now() - started });
      continue;
    }

    const socket = response.webSocket;
    if (!socket || response.status !== 101) {
      attempts.push({ apiVersion, stage: "handshake", status: response.status, elapsedMs: Date.now() - started });
      continue;
    }

    socket.accept();
    const inbox: Array<unknown> = [];
    let pending: ((value: unknown) => void) | null = null;
    const push = (value: unknown) => {
      if (pending) {
        const resolve = pending;
        pending = null;
        resolve(value);
      } else {
        inbox.push(value);
      }
    };
    const onMessage = (event: MessageEvent) => push({ kind: "message", data: event.data });
    const onClose = (event: CloseEvent) => push({ kind: "close", code: event.code, reason: event.reason });
    const onError = () => push({ kind: "socket-error" });
    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", onClose);
    socket.addEventListener("error", onError);

    const nextEvent = (timeoutMs: number): Promise<any> => {
      if (inbox.length) return Promise.resolve(inbox.shift());
      return new Promise((resolve) => {
        let settled = false;
        const finish = (value: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (pending === finish) pending = null;
          resolve(value);
        };
        const timer = setTimeout(() => finish({ kind: "timeout" }), timeoutMs);
        pending = finish;
      });
    };

    const parseFrame = (data: unknown): Record<string, any> | null => {
      try {
        let text: string;
        if (typeof data === "string") text = data;
        else if (data instanceof ArrayBuffer) text = new TextDecoder().decode(data);
        else if (ArrayBuffer.isView(data)) text = new TextDecoder().decode(data);
        else return null;
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
      } catch {
        return null;
      }
    };

    try {
      socket.send(JSON.stringify({
        setup: {
          model: `projects/${projectId}/locations/${location}/publishers/google/models/${model}`,
          generationConfig: { responseModalities: ["AUDIO"] },
          systemInstruction: { parts: [{ text: "You are an audio session test. Respond with one short, friendly spoken sentence confirming the voice output works." }] },
        },
      }));

      let setupComplete = false;
      let providerError: string | null = null;
      let closeInfo: Record<string, unknown> | null = null;
      for (let i = 0; i < 12; i += 1) {
        const event = await nextEvent(2_500) as Record<string, any>;
        if (event.kind === "timeout") break;
        if (event.kind === "close") {
          closeInfo = { code: event.code, reason: String(event.reason || "").slice(0, 220) };
          break;
        }
        if (event.kind !== "message") break;
        const message = parseFrame(event.data);
        if (!message) {
          providerError = "Provider sent a non-JSON setup frame";
          break;
        }
        if (message.setupComplete || message.setup_complete) {
          setupComplete = true;
          break;
        }
        if (message.error) {
          providerError = String(message.error.message || message.error.status || "Provider returned a setup error").slice(0, 220);
          break;
        }
      }

      if (!setupComplete) {
        attempts.push({
          apiVersion, stage: "setup", setupComplete: false,
          ...(providerError ? { error: providerError } : {}),
          ...(closeInfo ? { close: closeInfo } : {}),
          elapsedMs: Date.now() - started,
        });
        continue;
      }

      socket.send(JSON.stringify({
        clientContent: {
          turns: [{ role: "user", parts: [{ text: "Say: AskMoina voice test successful." }] }],
          turnComplete: true,
        },
      }));

      let audioChunks = 0;
      let audioBase64Chars = 0;
      let turnComplete = false;
      let responseError: string | null = null;
      for (let i = 0; i < 40; i += 1) {
        const event = await nextEvent(750) as Record<string, any>;
        if (event.kind === "timeout") continue;
        if (event.kind === "close" || event.kind === "socket-error") break;
        if (event.kind !== "message") continue;
        const message = parseFrame(event.data);
        if (!message) continue;
        if (message.error) {
          responseError = String(message.error.message || message.error.status || "Provider returned a response error").slice(0, 220);
          break;
        }
        const content = message.serverContent || message.server_content;
        const turn = content?.modelTurn || content?.model_turn;
        const parts = Array.isArray(turn?.parts) ? turn.parts : [];
        for (const part of parts) {
          const inlineData = part.inlineData || part.inline_data;
          if (inlineData && typeof inlineData.data === "string") {
            audioChunks += 1;
            audioBase64Chars += inlineData.data.length;
          }
        }
        if (content?.turnComplete || content?.turn_complete) {
          turnComplete = true;
          break;
        }
      }

      const result = {
        apiVersion, stage: "audio-response", setupComplete,
        audioChunks, audioBase64Chars, turnComplete,
        elapsedMs: Date.now() - started,
        ok: setupComplete && audioChunks > 0 && turnComplete,
        ...(responseError ? { error: responseError } : {}),
      };
      try { socket.close(1000, "One-shot diagnostic complete"); } catch { /* already closed */ }
      return json({ ...result, attempts }, result.ok ? 200 : 502);
    } catch {
      attempts.push({ apiVersion, stage: "probe-execution", error: "Probe execution failed", elapsedMs: Date.now() - started });
      try { socket.close(1000, "One-shot diagnostic failed"); } catch { /* already closed */ }
    } finally {
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("close", onClose);
      socket.removeEventListener("error", onError);
    }
  }

  return json({ ok: false, stage: "provider-setup", attempts }, 502);
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
  } catch (error) {
    console.error("[AskMoina] Google token exchange failed", error instanceof Error ? error.message : "unknown error");
    await releaseVoiceSession(env, reservation);
    return json({ error: "voice_authentication_unavailable" }, 503);
  }

  const projectId = env.GCP_PROJECT_ID.trim();
  const location = env.GEMINI_LOCATION?.trim() || "us-central1";
  const model = env.GEMINI_MODEL?.trim() || "gemini-3.8-live";
  const upstreamHost =
    location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`;
  const upstreamUrl =
    `https://${upstreamHost}/ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent`;

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      headers: {
        Upgrade: "websocket",
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch (error) {
    console.error("[AskMoina] Vertex Live WebSocket request failed", error instanceof Error ? error.message : "unknown error");
    await releaseVoiceSession(env, reservation);
    return json({ error: "voice_provider_unavailable" }, 502);
  }

  const upstreamSocket = upstreamResponse.webSocket;
  if (!upstreamSocket || upstreamResponse.status !== 101) {
    const responseText = await upstreamResponse.clone().text().catch(() => "");
    console.error("[AskMoina] Vertex Live handshake rejected", JSON.stringify({
      status: upstreamResponse.status,
      body: responseText.slice(0, 800),
    }));
    await releaseVoiceSession(env, reservation);
    return json({ error: "voice_provider_unavailable" }, 502);
  }

  const pair = new WebSocketPair();
  const [clientSocket, workerSocket] = Object.values(pair) as [WebSocket, WebSocket];
  workerSocket.accept();
  upstreamSocket.accept();

  const upstreamStartedAt = Date.now();
  let setupForwarded = false;
  let setupCompleteReceived = false;
  let closed = false;
  let inputWindowStart = Date.now();
  let inputFrameCount = 0;
  let inputBytesInWindow = 0;
  const MAX_CLIENT_FRAME_CHARS = 16_384;
  const MAX_AUDIO_BASE64_CHARS = 12_000;
  const MAX_AUDIO_FRAMES_PER_SECOND = 30;
  const MAX_INPUT_CHARS_PER_SECOND = 64 * 1024;

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

    // This browser proxy accepts small JSON frames only. Raw/binary frames and arbitrary
    // client messages are not needed for the current audio-only UI and are rejected.
    if (typeof event.data !== "string" || event.data.length > MAX_CLIENT_FRAME_CHARS) {
      closeBoth(1008, "Invalid or oversized client frame");
      return;
    }

    if (!setupForwarded) {
      try {
        const message = JSON.parse(event.data) as { setup?: unknown };
        if (
          event.data.length > 4_096 ||
          !message ||
          typeof message !== "object" ||
          !message.setup ||
          Object.keys(message).length !== 1
        ) {
          closeBoth(1008, "First message must be a small setup object");
          return;
        }

        const securedSetup = {
          model: `projects/${projectId}/locations/${location}/publishers/google/models/${model}`,
          // Gemini 3.8 Live supports AUDIO output; use the canonical JSON enum and field names.
          generationConfig: { responseModalities: ["AUDIO"] },
          systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        };
        upstreamSocket.send(JSON.stringify({ setup: securedSetup }));
        setupForwarded = true;
      } catch {
        closeBoth(1008, "Invalid setup message");
      }
      return;
    }

    try {
      const message = JSON.parse(event.data) as {
        realtime_input?: {
          audio?: { data?: unknown; mime_type?: unknown };
          audio_stream_end?: unknown;
          [key: string]: unknown;
        };
        [key: string]: unknown;
      };

      if (
        !message ||
        typeof message !== "object" ||
        Object.keys(message).length !== 1 ||
        !message.realtime_input ||
        typeof message.realtime_input !== "object" ||
        Array.isArray(message.realtime_input) ||
        Object.keys(message.realtime_input).length !== 1
      ) {
        closeBoth(1008, "Only realtime audio input is allowed");
        return;
      }

      const realtimeInput = message.realtime_input;
      if (realtimeInput.audio_stream_end === true) {
        upstreamSocket.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
        return;
      }

      const audio = realtimeInput.audio;
      if (
        !audio ||
        typeof audio !== "object" ||
        Array.isArray(audio) ||
        Object.keys(audio).some((key) => key !== "data" && key !== "mime_type") ||
        typeof audio.data !== "string" ||
        audio.data.length < 4 ||
        audio.data.length > MAX_AUDIO_BASE64_CHARS ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(audio.data) ||
        audio.mime_type !== "audio/pcm;rate=16000"
      ) {
        closeBoth(1008, "Invalid PCM audio frame");
        return;
      }

      const now = Date.now();
      if (now - inputWindowStart >= 1_000 || now < inputWindowStart) {
        inputWindowStart = now;
        inputFrameCount = 0;
        inputBytesInWindow = 0;
      }
      inputFrameCount += 1;
      inputBytesInWindow += event.data.length;
      if (
        inputFrameCount > MAX_AUDIO_FRAMES_PER_SECOND ||
        inputBytesInWindow > MAX_INPUT_CHARS_PER_SECOND
      ) {
        closeBoth(1008, "Audio input rate limit exceeded");
        return;
      }

      // Re-serialize the validated shape to avoid forwarding unknown client fields.
      upstreamSocket.send(JSON.stringify({
        realtimeInput: {
          audio: {
            data: audio.data,
            mimeType: "audio/pcm;rate=16000",
          },
        },
      }));
    } catch {
      closeBoth(1008, "Invalid client message");
    }
  });

  upstreamSocket.addEventListener("message", (event: MessageEvent) => {
    if (workerSocket.readyState !== WebSocket.OPEN) return;

    // Log only structured provider error metadata; never log audio, transcripts, or credentials.
    if (typeof event.data === "string") {
      try {
        const providerMessage = JSON.parse(event.data) as {
          setup_complete?: unknown;
          setupComplete?: unknown;
          error?: { code?: unknown; status?: unknown; message?: unknown };
        };
        if (providerMessage.setup_complete || providerMessage.setupComplete) {
          setupCompleteReceived = true;
          console.log("[AskMoina] Vertex Live setup completed", JSON.stringify({
            frameKeys: Object.keys(providerMessage),
          }));
        }
        if (providerMessage.error) {
          const providerError = providerMessage.error;
          console.error("[AskMoina] Vertex Live returned an error", JSON.stringify({
            code: providerError.code,
            status: providerError.status,
            message: typeof providerError.message === "string" ? providerError.message.slice(0, 800) : undefined,
          }));
        }
      } catch {
        // Forward provider frames unchanged; do not log frame contents.
      }
    }

    try {
      workerSocket.send(event.data);
    } catch {
      closeBoth(1011, "Client send failed");
    }
  });

  workerSocket.addEventListener("close", (event: CloseEvent) => closeBoth(event.code || 1000, "Client disconnected"));
  workerSocket.addEventListener("error", () => closeBoth(1011, "Client socket error"));
  upstreamSocket.addEventListener("close", (event: CloseEvent) => {
    if (!closed) {
      console.warn("[AskMoina] Vertex Live socket closed", JSON.stringify({
        code: event.code,
        reason: event.reason.slice(0, 300),
        setupForwarded,
        setupCompleteReceived,
        lifetimeMs: Date.now() - upstreamStartedAt,
      }));
    }
    closeBoth(event.code || 1000, "Voice provider disconnected");
  });
  upstreamSocket.addEventListener("error", () => {
    console.error("[AskMoina] Vertex Live socket error", JSON.stringify({ setupCompleteReceived, setupForwarded }));
    closeBoth(1011, "Voice provider socket error");
  });

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

    if (url.pathname === "/api/_probe_voice_7f29c38a7d214d8e9fe5b6f4" && request.method === "GET") {
      return runOneShotVoiceProbe(env);
    }
    if (url.pathname === "/api/voice/socket") return handleVoiceSocket(request, env, ctx);
    if (url.pathname.startsWith("/api/")) return json({ error: "not_found" }, 404);

    const assetResponse = await env.ASSETS.fetch(request);
    const headers = new Headers(assetResponse.headers);
    headers.set(
      "Content-Security-Policy",
      "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; connect-src 'self' wss:; img-src 'self' data:; style-src 'self'; script-src 'self'; media-src 'self' blob:",
    );
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("X-Frame-Options", "DENY");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("Permissions-Policy", "microphone=(self), camera=(), geolocation=(), payment=()");
    headers.set("Cross-Origin-Resource-Policy", "same-origin");
    headers.set("Cache-Control", "no-store");
    return new Response(assetResponse.body, {
      status: assetResponse.status,
      statusText: assetResponse.statusText,
      headers,
    });
  },

  async queue(batch: MessageBatch<unknown>): Promise<void> {
    for (const message of batch.messages) message.ack();
  },
};
