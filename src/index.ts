import type { Env } from "./config/env";
import { getGoogleAccessToken } from "./auth/google";
import { getUserFacingDisconnectNotice, safeWebSocketCloseCode } from "./sessions/disconnect-message";
import { TokenBucket } from "./sessions/audio-rate-limit";
import { inspectProviderControlFrame } from "./sessions/provider-frame";
import { handleContinuityRequest, ensureVisitor, recordSessionStart, recordSessionFinish } from "./continuity";
import { buildPersonalizedSystemInstruction } from "./sessions/memory-context";

export { UserState } from "./sessions/user-state";

const SYSTEM_INSTRUCTION =
  "You are AskMoina, a warm, respectful voice companion for people in Assam, especially Upper Assam. Speak naturally and clearly. When the user speaks Assamese, try to respond in Assamese; otherwise follow their language. Do not claim to be human. Be honest about uncertainty. Do not present yourself as a substitute for emergency, medical, legal, or mental-health professionals. Keep responses conversational and concise.";

// Temporary tester mode: daily voice quotas are bypassed until this fixed expiry.
// Per-session duration, active-session limits, connection-attempt limits, and audio
// rate protection remain enforced. Remove this constant after the testing window.
const TESTING_WINDOW_END_MS = Date.parse("2026-10-10T10:56:24.325Z");
function isUnlimitedTestingWindow(now = Date.now()): boolean {
  return now < TESTING_WINDOW_END_MS;
}

const providerFrameDecoder = new TextDecoder();

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
): Promise<{ ok: boolean; allowed?: boolean; reservedSeconds?: number }> {
  try {
    const id = env.USER_STATE.idFromName(objectName);
    const stub = env.USER_STATE.get(id);
    const response = await stub.fetch(`https://user-state${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (path === "/session/release") return { ok: response.ok };
    const result = (await response.json()) as { allowed?: boolean; reservedSeconds?: number };
    return {
      ok: response.ok,
      allowed: result.allowed === true,
      reservedSeconds: result.reservedSeconds,
    };
  } catch {
    return { ok: false, allowed: false };
  }
}

interface VoiceReservation {
  sessionId: string;
  ipObjectName: string;
  globalObjectName: string;
  maxDurationSeconds: number;
}

async function reserveVoiceSession(request: Request, env: Env): Promise<VoiceReservation | null> {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) return null;

  const ipHash = await sha256(ip);
  const ipObjectName = `voice-ip:${ipHash}`;
  const globalObjectName = "voice-global-budget";
  const sessionId = crypto.randomUUID();
  const now = Date.now();
  const testingMode = isUnlimitedTestingWindow(now);
  const maxSessionSeconds = positiveInt(env.MAX_LIVE_SESSION_SECONDS, 540, 540);
  const ipOptions = {
    sessionId,
    now,
    maxSessionSeconds,
    maxDailySeconds: positiveInt(env.MAX_DAILY_SESSION_SECONDS, 1_800, 1_800),
    maxConcurrentSessions: testingMode ? 5 : positiveInt(env.MAX_CONCURRENT_SESSIONS_PER_USER, 1, 1),
    enforceRateLimit: true,
    bypassDailyLimit: testingMode,
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
    bypassDailyLimit: testingMode,
  });

  if (!globalResult.ok || !globalResult.allowed) {
    await callGuard(env, ipObjectName, "/session/release", { sessionId, now: Date.now() });
    return null;
  }

  const maxDurationSeconds = Math.max(
    1,
    Math.min(
      maxSessionSeconds,
      ipResult.reservedSeconds ?? maxSessionSeconds,
      globalResult.reservedSeconds ?? maxSessionSeconds,
    ),
  );
  return { sessionId, ipObjectName, globalObjectName, maxDurationSeconds };
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


interface VoiceGuardStatus {
  dailySecondsRemaining: number;
  activeSessions: number;
  requestsRemaining: number | null;
  retryAfterSeconds: number;
  rateLimited: boolean;
  concurrencyLimited: boolean;
  dailyLimitReached: boolean;
}

async function readGuardStatus(
  env: Env,
  objectName: string,
  options: {
    now: number;
    maxDailySeconds: number;
    maxConcurrentSessions: number;
    enforceRateLimit: boolean;
    bypassDailyLimit?: boolean;
  },
): Promise<VoiceGuardStatus | null> {
  try {
    const id = env.USER_STATE.idFromName(objectName);
    const stub = env.USER_STATE.get(id);
    const response = await stub.fetch("https://user-state/session/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
    });
    if (!response.ok) return null;
    const result = await response.json() as Partial<VoiceGuardStatus> & { ok?: boolean };
    if (
      result.ok !== true ||
      !Number.isFinite(result.dailySecondsRemaining) ||
      !Number.isFinite(result.activeSessions) ||
      typeof result.rateLimited !== "boolean" ||
      typeof result.concurrencyLimited !== "boolean" ||
      typeof result.dailyLimitReached !== "boolean"
    ) return null;
    return {
      dailySecondsRemaining: Math.max(0, Number(result.dailySecondsRemaining)),
      activeSessions: Math.max(0, Number(result.activeSessions)),
      requestsRemaining: result.requestsRemaining == null ? null : Math.max(0, Number(result.requestsRemaining)),
      retryAfterSeconds: Math.max(0, Number(result.retryAfterSeconds) || 0),
      rateLimited: result.rateLimited,
      concurrencyLimited: result.concurrencyLimited,
      dailyLimitReached: result.dailyLimitReached,
    };
  } catch {
    return null;
  }
}

async function handleVoiceStatus(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);

  if (!hasVertexCredentials(env)) {
    return json({
      available: false,
      reason: "not_configured",
      message: "Voice is temporarily unavailable. Please try again later.",
      maxSessionSeconds: 0,
      dailyRemainingSeconds: null,
    });
  }

  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) {
    return json({
      available: false,
      reason: "status_unavailable",
      message: "Could not check voice availability right now. Please try again shortly.",
      maxSessionSeconds: 0,
      dailyRemainingSeconds: null,
    });
  }

  const now = Date.now();
  const testingMode = isUnlimitedTestingWindow(now);
  const ipObjectName = "voice-ip:" + await sha256(ip);
  const globalObjectName = "voice-global-budget";
  const maxSessionSeconds = positiveInt(env.MAX_LIVE_SESSION_SECONDS, 540, 540);
  const maxDailySeconds = positiveInt(env.MAX_DAILY_SESSION_SECONDS, 1_800, 1_800);
  const maxGlobalDailySeconds = positiveInt(env.MAX_GLOBAL_DAILY_SESSION_SECONDS, 3_600, 3_600);
  const ipStatus = await readGuardStatus(env, ipObjectName, {
    now,
    maxDailySeconds,
    maxConcurrentSessions: testingMode ? 5 : positiveInt(env.MAX_CONCURRENT_SESSIONS_PER_USER, 1, 1),
    enforceRateLimit: true,
    bypassDailyLimit: testingMode,
  });
  const globalStatus = await readGuardStatus(env, globalObjectName, {
    now,
    maxDailySeconds: maxGlobalDailySeconds,
    maxConcurrentSessions: positiveInt(env.MAX_GLOBAL_CONCURRENT_SESSIONS, 5, 5),
    enforceRateLimit: false,
    bypassDailyLimit: testingMode,
  });

  if (!ipStatus || !globalStatus) {
    return json({
      available: false,
      reason: "status_unavailable",
      message: "Could not check voice availability right now. Please try again shortly.",
      maxSessionSeconds,
      dailyRemainingSeconds: null,
    }, 503);
  }

  let reason = "available";
  let message = "Current limits allow a new voice conversation.";
  if (ipStatus.rateLimited) {
    reason = "rate_limited";
    message = "Too many connection attempts just now. Please wait about " +
      Math.max(1, ipStatus.retryAfterSeconds) + " seconds before trying again.";
  } else if (ipStatus.concurrencyLimited) {
    reason = "already_active";
    message = "A voice conversation is already active for this network in another tab. End it there before starting a new one.";
  } else if (!testingMode && ipStatus.dailyLimitReached) {
    reason = "daily_limit";
    message = "Today's voice allowance for this network has been used. It resets at midnight India time.";
  } else if (globalStatus.concurrencyLimited) {
    reason = "app_busy";
    message = "AskMoina is busy right now. Please wait a little and try again.";
  } else if (!testingMode && globalStatus.dailyLimitReached) {
    reason = "app_daily_limit";
    message = "AskMoina has reached its overall voice allowance for today. Please try again after midnight India time.";
  }

  if (testingMode && reason === "available") {
    message = "Testing mode: unlimited daily voice time until " +
      new Date(TESTING_WINDOW_END_MS).toISOString() +
      ". Individual conversations still end after about " +
      Math.ceil(maxSessionSeconds / 60) + " minutes.";
  }

  const dailyRemainingSeconds = testingMode ? Number.MAX_SAFE_INTEGER : Math.min(
    ipStatus.dailySecondsRemaining,
    globalStatus.dailySecondsRemaining,
  );
  const allowedDurationSeconds = Math.max(
    0,
    Math.min(maxSessionSeconds, ipStatus.dailySecondsRemaining, globalStatus.dailySecondsRemaining),
  );
  return json({
    available: reason === "available",
    reason,
    message,
    maxSessionSeconds: allowedDurationSeconds,
    dailyRemainingSeconds: testingMode || ipStatus.activeSessions > 0 ? null : dailyRemainingSeconds,
    testingMode,
    testingModeExpiresAt: new Date(TESTING_WINDOW_END_MS).toISOString(),
  });
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
  if (!reservation) return json({ error: "voice_capacity_or_daily_limit_reached" }, 429);

  const analyticsStartedAt = Date.now();
  let analyticsFinished = false;
  let analyticsSetupComplete = false;
  const analyticsStart = recordSessionStart(env, request, reservation.sessionId, env.GEMINI_MODEL || "gemini-3.8-live", env.GEMINI_LOCATION || "us-central1", analyticsStartedAt).catch(() => null);
  ctx.waitUntil(analyticsStart);
  const finishAnalytics = (outcome: string) => {
    if (analyticsFinished) return;
    analyticsFinished = true;
    ctx.waitUntil(analyticsStart.then((visitorId) => recordSessionFinish(env, reservation.sessionId, visitorId, analyticsStartedAt, outcome, analyticsSetupComplete)).catch(() => undefined));
  };

  let accessToken: string;
  try {
    accessToken = await getGoogleAccessToken(env);
  } catch (error) {
    console.error("[AskMoina] Google token exchange failed", error instanceof Error ? error.message : "unknown error");
    finishAnalytics("provider_auth_error");
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
    finishAnalytics("provider_error");
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
    finishAnalytics("provider_handshake_error");
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
  const MAX_AUDIO_FRAMES_PER_SECOND = 60;
  const MAX_INPUT_CHARS_PER_SECOND = 64 * 1024;
  // Network and browser audio callbacks can arrive in short bursts. Keep the
  // sustained-rate guard, but allow up to two seconds of buffered audio data.
  const INPUT_RATE_BURST_SECONDS = 2;
  const inputFrameBucket = new TokenBucket(MAX_AUDIO_FRAMES_PER_SECOND, INPUT_RATE_BURST_SECONDS);
  const inputByteBucket = new TokenBucket(MAX_INPUT_CHARS_PER_SECOND, INPUT_RATE_BURST_SECONDS);

  const closeBoth = (code = 1000, reason = "Session closed") => {
    if (closed) return;
    closed = true;

    const notice = getUserFacingDisconnectNotice(reason, reservation.maxDurationSeconds, code);
    const analyticsOutcome = reason === "Session time limit reached" ? "session_timeout" :
      (reason === "Client disconnected" && code === 1000 ? (analyticsSetupComplete ? "completed" : "disconnected_before_setup") :
      (code === 1008 ? "protocol_error" : "provider_error"));
    finishAnalytics(analyticsOutcome);
    if (notice && workerSocket.readyState === WebSocket.OPEN) {
      try {
        // WebSocket preserves message order, so the browser receives this explanation before close.
        workerSocket.send(JSON.stringify({ connection_status: notice }));
      } catch {
        // The socket may already be closing.
      }
    }

    if (code !== 1000 || reason !== "Client disconnected") {
      // Log only safe close metadata—never microphone audio or conversation text.
      console.warn("[AskMoina] Voice WebSocket closing", JSON.stringify({
        closeCode: code,
        reason,
        setupForwarded,
        setupCompleteReceived,
        upstreamFrameCount,
        inputFrameCount,
        inputBytesInWindow,
        lifetimeMs: Date.now() - upstreamStartedAt,
      }));
    }

    const safeCode = safeWebSocketCloseCode(code);
    try {
      if (workerSocket.readyState === WebSocket.OPEN) workerSocket.close(safeCode, reason.slice(0, 100));
    } catch {
      // Ignore duplicate close races.
    }
    try {
      if (upstreamSocket.readyState === WebSocket.OPEN) upstreamSocket.close(safeCode, reason.slice(0, 100));
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
        const message = JSON.parse(event.data) as { setup?: unknown; memory_context?: unknown };
        const allowedKeys = ["setup", "memory_context"];
        const memoryContext = typeof message?.memory_context === "string" ? message.memory_context.trim().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, 3_000) : "";
        if (event.data.length > 4_096 || !message || typeof message !== "object" || !message.setup || Object.keys(message).some((key) => !allowedKeys.includes(key)) || (message.memory_context !== undefined && typeof message.memory_context !== "string")) {
          closeBoth(1008, "First message must be a small setup object");
          return;
        }
        const systemInstruction = buildPersonalizedSystemInstruction(SYSTEM_INSTRUCTION, memoryContext);
        const securedSetup = {
          model: `projects/${projectId}/locations/${location}/publishers/google/models/${model}`,
          generationConfig: { responseModalities: ["AUDIO"] },
          // The UI already renders live transcript events; enable the API signals for accessibility and smoke-test verification.
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: { parts: [{ text: systemInstruction }] },
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
      const frameRateAllowed = inputFrameBucket.consume(1, now);
      const byteRateAllowed = inputByteBucket.consume(event.data.length, now);
      if (!frameRateAllowed || !byteRateAllowed) {
        console.warn("[AskMoina] Audio input sustained rate limit exceeded", JSON.stringify({
          frameRateAllowed,
          byteRateAllowed,
          inputFrameCount,
          inputBytesInWindow,
          frameBudgetRemaining: Math.round(inputFrameBucket.remaining),
          byteBudgetRemaining: Math.round(inputByteBucket.remaining),
          lifetimeMs: now - upstreamStartedAt,
        }));
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

  let upstreamFrameCount = 0;
  upstreamSocket.addEventListener("message", async (event: MessageEvent) => {
    if (workerSocket.readyState !== WebSocket.OPEN || closed) return;

    // Workerd can expose upstream WebSocket frames as strings, ArrayBuffers, or Blobs.
    // Normalize them to JSON text before forwarding so the browser never receives an
    // unexpected Blob/binary representation of a JSON protocol frame.
    const frameNumber = ++upstreamFrameCount;
    let frameText: string;
    const frameData: unknown = event.data;
    const frameType =
      typeof frameData === "string" ? "string" :
      typeof Blob !== "undefined" && frameData instanceof Blob ? "Blob" :
      frameData instanceof ArrayBuffer ? "ArrayBuffer" :
      ArrayBuffer.isView(frameData) ? "ArrayBufferView" : typeof frameData;
    const frameSize =
      typeof frameData === "string" ? frameData.length :
      typeof Blob !== "undefined" && frameData instanceof Blob ? frameData.size :
      frameData instanceof ArrayBuffer ? frameData.byteLength :
      ArrayBuffer.isView(frameData) ? frameData.byteLength : null;

    try {
      if (typeof frameData === "string") frameText = frameData;
      else if (typeof Blob !== "undefined" && frameData instanceof Blob) frameText = await frameData.text();
      else if (frameData instanceof ArrayBuffer) frameText = providerFrameDecoder.decode(frameData);
      else if (ArrayBuffer.isView(frameData)) frameText = providerFrameDecoder.decode(frameData);
      else throw new TypeError("Unsupported provider frame type");
    } catch {
      console.error("[AskMoina] Could not decode Vertex Live frame", JSON.stringify({ frameNumber, frameType, frameSize }));
      try {
        workerSocket.send(JSON.stringify({ error: {
          code: "PROVIDER_FRAME_DECODE_FAILED",
          status: "INTERNAL",
          message: "The voice provider sent a response that could not be decoded.",
        } }));
      } catch { /* client may already be closing */ }
      closeBoth(1011, "Provider frame decode failed");
      return;
    }

    // Most provider frames are audio payloads. Avoid parsing their large base64-heavy
    // JSON objects in the Worker; only inspect control frames carrying setup or error keys.
    let providerMessage: ReturnType<typeof inspectProviderControlFrame>;
    try {
      providerMessage = inspectProviderControlFrame(frameText);
    } catch {
      console.error("[AskMoina] Vertex Live sent an invalid control frame", JSON.stringify({ frameNumber, frameType, frameSize }));
      try {
        workerSocket.send(JSON.stringify({ error: {
          code: "PROVIDER_PROTOCOL_ERROR",
          status: "INTERNAL",
          message: "The voice provider sent a response in an unsupported format.",
        } }));
      } catch { /* client may already be closing */ }
      closeBoth(1011, "Invalid provider frame");
      return;
    }

    if (providerMessage?.setupComplete) {
      setupCompleteReceived = true;
      analyticsSetupComplete = true;
      console.log("[AskMoina] Vertex Live setup completed", JSON.stringify({ frameNumber }));
    }

    if (providerMessage?.error) {
      const providerError = providerMessage.error;
      console.error("[AskMoina] Vertex Live returned an error", JSON.stringify({
        code: providerError.code,
        status: providerError.status,
        message: typeof providerError.message === "string" ? providerError.message.slice(0, 800) : undefined,
      }));
    }

    try {
      workerSocket.send(frameText);
    } catch {
      closeBoth(1011, "Client send failed");
    }
  });

  workerSocket.addEventListener("close", (event: CloseEvent) => {
    if (!setupCompleteReceived && !closed) {
      console.warn("[AskMoina] Browser socket closed before setup completed", JSON.stringify({
        clientCode: event.code,
        setupForwarded,
        upstreamFrameCount,
      }));
    }
    closeBoth(event.code || 1000, "Client disconnected");
  });
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

  setTimeout(() => {
    console.warn("[AskMoina] Voice session duration limit reached", JSON.stringify({
      maxDurationSeconds: reservation.maxDurationSeconds,
      setupCompleteReceived,
      lifetimeMs: Date.now() - upstreamStartedAt,
    }));
    closeBoth(1000, "Session time limit reached");
  }, reservation.maxDurationSeconds * 1_000);

  return new Response(null, { status: 101, webSocket: clientSocket });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    const continuityResponse = await handleContinuityRequest(request, env, ctx);
    if (continuityResponse) return continuityResponse;

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

    if (url.pathname === "/api/voice/status") return handleVoiceStatus(request, env);
    if (url.pathname === "/api/voice/socket") return handleVoiceSocket(request, env, ctx);
    if (url.pathname.startsWith("/api/")) return json({ error: "not_found" }, 404);

    const assetResponse = await env.ASSETS.fetch(request);
    const headers = new Headers(assetResponse.headers);
    let responseBody: BodyInit | null = assetResponse.body;
    const isHome = request.method === "GET" && assetResponse.status === 200 && (url.pathname === "/" || url.pathname === "/index.html");
    if (isHome) {
      const visitor = await ensureVisitor(request, env);
      ctx.waitUntil(visitor.touch);
      if (visitor.cookie) headers.set("Set-Cookie", visitor.cookie);
      let html = await assetResponse.text();
      if (!html.includes('href="/vault"') && !html.includes("href=/vault")) {
        html = html.replace("Made for Assam</span>", "Made for Assam</span><a class=brand-location href=/vault>Memory Vault</a>");
      }
      html = html.replace("</body>", "<script src=/continuity.js defer></script></body>");
      responseBody = html;
      headers.delete("Content-Length");
      headers.delete("ETag");
    }
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
    return new Response(responseBody, {
      status: assetResponse.status,
      statusText: assetResponse.statusText,
      headers,
    });
  },

  async queue(batch: MessageBatch<unknown>): Promise<void> {
    for (const message of batch.messages) message.ack();
  },
};
