import type { Env } from "./config/env";
import { getGoogleAccessToken } from "./auth/google";
import { getUserFacingDisconnectNotice, safeWebSocketCloseCode } from "./sessions/disconnect-message";
import { TokenBucket } from "./sessions/audio-rate-limit";
import { inspectProviderControlFrame, isProviderAudioFrame } from "./sessions/provider-frame";
import { handleContinuityRequest, ensureVisitor, visitorIdFromRequest, isAdmin, recordSessionStart, recordSessionFinish } from "./continuity";
import { buildPersonalizedSystemInstruction } from "./sessions/memory-context";
import { SYSTEM_INSTRUCTION } from "./sessions/assistant-instruction";
import { buildAssamesePronunciationInstruction } from "./sessions/assamese-pronunciation";
import { runRetentionMaintenance } from "./maintenance/retention";
import { buildVoiceGenerationConfig, DEFAULT_LIVE_VOICE_NAME, isPrebuiltLiveVoiceName } from "./sessions/voice-config";
import { parseLiveClientInput } from "./sessions/copilot-protocol";
import { COPILOT_HTML, COPILOT_JS, COPILOT_CSS } from "./copilot-assets";

export { UserState } from "./sessions/user-state";

const providerFrameDecoder = new TextDecoder();

const COPILOT_SYSTEM_INSTRUCTION = [
  "You are Moina's live camera co-pilot for Assamese-speaking users.",
  "Speak naturally in Assamese (Axomiya), allowing everyday Assamese-English code-switching. Keep spoken steps short and easy to follow.",
  "Use the live camera frames to answer questions about visible objects, labels, components, and the user's immediate task.",
  "When you have identified a useful visual target or a next step worth highlighting, call display_screen_overlay with a concise label, one safe next-step instruction, a brief target hint, and the approximate screen region.",
  "If the user explicitly asks for a walkthrough that needs multiple visual steps, you may include a steps array of 2–5 ordered, short actions. Each step must include its own label, one safe instruction, target hint, and approximate screen region. Keep the top-level fields consistent with step one; do not invent steps just to fill the array.",
  "Only emit a multi-step sequence for low-risk tasks with visible, user-verifiable actions. Never generate a guided repair sequence for live electrical equipment, gas leaks, bypassing safety systems, or tasks with a meaningful risk of injury; recommend a qualified professional instead.",
  "Screen regions are rough screen-space hints, not calibrated coordinates. Never claim the marker is physically anchored to the object. If the target is ambiguous, ask the user to point more steadily or move closer rather than guessing.",
  "For troubleshooting, guide one step at a time and wait for the user to confirm before proceeding. When a sequence is present, its progress remains unconfirmed until the user inspects the result and taps Confirm step. Do not treat a button tap as independent proof that the task succeeded.",
  "Maintain the user's current task across turns: track their stated goal, the last step they confirmed, and visible changes in later camera frames. Do not restart from step one or repeat the full explanation unless asked.",
  "Keep each reply focused on the next useful action. Use the user's confirmation or the visible result before advancing; if the view changes or the target is uncertain, ask a short clarifying question.",
  "Keep overlays minimal: one concise label and one actionable instruction near the rough target region. Never imply precise object tracking or calibrated coordinates.",
  "If the user interrupts or asks a follow-up, respond naturally and resume from the last confirmed step when appropriate.",
  "Do not claim to have changed a device setting, purchased an item, or executed an external action unless a real approved tool confirms it. The overlay tool only displays a label on screen."
].join("\n");

const COPILOT_TOOL = {
  functionDeclarations: [{
    name: "display_screen_overlay",
    description: "Display a concise on-screen focus label and next-step hint over the live camera preview. Use only when a visible target or step is relevant. The screen region is approximate, not a measured object coordinate.",
    parameters: {
      type: "OBJECT",
      properties: {
        text_to_display: { type: "STRING", description: "Short label for the visual target, preferably under 50 characters." },
        instruction: { type: "STRING", description: "One brief and safe next-step instruction, under 160 characters." },
        target_hint: { type: "STRING", description: "Short description of the visible object or component." },
        screen_region: {
          type: "STRING",
          description: "Approximate screen region where the target appears in the most recent frame.",
          enum: ["center", "upper-left", "upper-right", "lower-left", "lower-right"]
        },
        steps: {
          type: "ARRAY",
          description: "Optional ordered walkthrough of 2 to 5 low-risk, visible, user-verifiable steps. Each step has the same fields as the top-level cue. Do not include for hazardous or uncertain tasks.",
          items: {
            type: "OBJECT",
            properties: {
              text_to_display: { type: "STRING", description: "Short label for this step, under 50 characters." },
              instruction: { type: "STRING", description: "One safe action the user can inspect and confirm, under 160 characters." },
              target_hint: { type: "STRING", description: "Short description of this step's visible target." },
              screen_region: {
                type: "STRING",
                description: "Approximate screen region for this step's target.",
                enum: ["center", "upper-left", "upper-right", "lower-left", "lower-right"]
              }
            },
            required: ["text_to_display", "instruction", "target_hint", "screen_region"]
          }
        }
      },
      required: ["text_to_display", "instruction", "target_hint", "screen_region"]
    }
  }]
};

const json = (data: unknown, status = 200, extraHeaders?: HeadersInit): Response => {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (extraHeaders) new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  return Response.json(data, { status, headers });
};

function positiveInt(value: string | undefined, fallback: number, maximum: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function hasVertexCredentials(env: Env): boolean {
  const hasJson = Boolean(env.GCP_SERVICE_ACCOUNT_JSON?.trim());
  const hasSplitSecrets = Boolean(env.GCP_CLIENT_EMAIL?.trim() && env.GCP_PRIVATE_KEY?.trim());
  return Boolean(env.GCP_PROJECT_ID?.trim() && (hasJson || hasSplitSecrets));
}

async function hasAdminDailyQuotaBypass(request: Request, env: Env): Promise<boolean> {
  return env.ADMIN_VOICE_DAILY_QUOTA_BYPASS?.trim().toLowerCase() === "true" &&
    await isAdmin(request, env);
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
  userObjectName: string;
  globalObjectName: string;
  maxDurationSeconds: number;
}

async function reserveVoiceSession(
  request: Request,
  env: Env,
  adminDailyQuotaBypassed = false,
): Promise<VoiceReservation | null> {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) return null;

  const ipHash = await sha256(ip);
  const visitorId = adminDailyQuotaBypassed ? null : await visitorIdFromRequest(request);
  const userObjectName = adminDailyQuotaBypassed
    ? `voice-admin-ip:v2:${ipHash}`
    : `voice-visitor:v2:${visitorId ?? `ip:${ipHash}`}`;
  const rateObjectName = `voice-ip-rate:v1:${ipHash}`;
  const globalObjectName = adminDailyQuotaBypassed ? "voice-admin-global-budget:v2" : "voice-global-budget";
  const sessionId = crypto.randomUUID();
  const now = Date.now();
  const maxSessionSeconds = positiveInt(env.MAX_LIVE_SESSION_SECONDS, 540, 540);

  let userResult: { ok: boolean; allowed?: boolean; reservedSeconds?: number };
  if (adminDailyQuotaBypassed) {
    // Keep the admin audition path isolated from public limits and usage.
    userResult = await callGuard(env, userObjectName, "/session/acquire", {
      sessionId,
      now,
      maxSessionSeconds,
      maxDailySeconds: positiveInt(env.MAX_DAILY_SESSION_SECONDS, 1_800, 1_800),
      maxConcurrentSessions: positiveInt(env.MAX_CONCURRENT_SESSIONS_PER_USER, 1, 1),
      enforceRateLimit: true,
      enforceDailyLimit: false,
    });
  } else {
    // Protect against rapid connection attempts from one IP without treating a
    // school, hostel, or family Wi-Fi as a single person for daily voice usage.
    const rateResult = await callGuard(env, rateObjectName, "/session/acquire", {
      sessionId,
      now,
      maxSessionSeconds,
      maxDailySeconds: positiveInt(env.MAX_DAILY_SESSION_SECONDS, 1_800, 1_800),
      maxConcurrentSessions: 1,
      enforceRateLimit: true,
      enforceDailyLimit: false,
      rateLimitOnly: true,
    });
    if (!rateResult.ok || !rateResult.allowed) return null;

    userResult = await callGuard(env, userObjectName, "/session/acquire", {
      sessionId,
      now,
      maxSessionSeconds,
      maxDailySeconds: positiveInt(env.MAX_DAILY_SESSION_SECONDS, 1_800, 1_800),
      maxConcurrentSessions: positiveInt(env.MAX_CONCURRENT_SESSIONS_PER_USER, 1, 1),
      enforceRateLimit: false,
      enforceDailyLimit: true,
    });
  }

  if (!userResult.ok || !userResult.allowed) return null;

  const globalResult = await callGuard(env, globalObjectName, "/session/acquire", {
    sessionId,
    now,
    maxSessionSeconds,
    maxDailySeconds: positiveInt(env.MAX_GLOBAL_DAILY_SESSION_SECONDS, 36_000, 36_000),
    maxConcurrentSessions: positiveInt(env.MAX_GLOBAL_CONCURRENT_SESSIONS, 25, 100),
    enforceRateLimit: false,
    enforceDailyLimit: !adminDailyQuotaBypassed,
  });

  if (!globalResult.ok || !globalResult.allowed) {
    await callGuard(env, userObjectName, "/session/release", { sessionId, now: Date.now() });
    return null;
  }

  const maxDurationSeconds = Math.max(
    1,
    Math.min(
      maxSessionSeconds,
      userResult.reservedSeconds ?? maxSessionSeconds,
      globalResult.reservedSeconds ?? maxSessionSeconds,
    ),
  );
  return { sessionId, userObjectName, globalObjectName, maxDurationSeconds };
}

async function releaseVoiceSession(
  env: Env,
  reservation: VoiceReservation,
): Promise<void> {
  await Promise.all([
    callGuard(env, reservation.userObjectName, "/session/release", {
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
    enforceDailyLimit: boolean;
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
  const adminDailyQuotaBypassed = await hasAdminDailyQuotaBypass(request, env);
  let publicVisitorId: string | null = null;
  let responseHeaders: HeadersInit | undefined;
  if (!adminDailyQuotaBypassed) {
    publicVisitorId = await visitorIdFromRequest(request);
    if (!publicVisitorId) {
      const visitor = await ensureVisitor(request, env);
      publicVisitorId = visitor.visitorId;
      if (visitor.cookie) {
        responseHeaders = { "Set-Cookie": visitor.cookie };
        await visitor.touch;
      }
    }
  }
  const ipHash = await sha256(ip);
  const ipObjectName = `${adminDailyQuotaBypassed ? "voice-admin-ip:v2:" : "voice-ip-rate:v1:"}${ipHash}`;
  const userObjectName = adminDailyQuotaBypassed
    ? ipObjectName
    : `voice-visitor:v2:${publicVisitorId ?? `ip:${ipHash}`}`;
  const globalObjectName = adminDailyQuotaBypassed ? "voice-admin-global-budget:v2" : "voice-global-budget";
  const maxSessionSeconds = positiveInt(env.MAX_LIVE_SESSION_SECONDS, 540, 540);
  const maxDailySeconds = positiveInt(env.MAX_DAILY_SESSION_SECONDS, 1_800, 1_800);
  const maxGlobalDailySeconds = positiveInt(env.MAX_GLOBAL_DAILY_SESSION_SECONDS, 36_000, 36_000);

  const identityStatus = await readGuardStatus(env, userObjectName, {
    now,
    maxDailySeconds,
    maxConcurrentSessions: positiveInt(env.MAX_CONCURRENT_SESSIONS_PER_USER, 1, 1),
    enforceRateLimit: adminDailyQuotaBypassed,
    enforceDailyLimit: !adminDailyQuotaBypassed,
  });
  const rateStatus = adminDailyQuotaBypassed ? identityStatus : await readGuardStatus(env, ipObjectName, {
    now,
    maxDailySeconds,
    maxConcurrentSessions: 1,
    enforceRateLimit: true,
    enforceDailyLimit: false,
  });
  const globalStatus = await readGuardStatus(env, globalObjectName, {
    now,
    maxDailySeconds: maxGlobalDailySeconds,
    maxConcurrentSessions: positiveInt(env.MAX_GLOBAL_CONCURRENT_SESSIONS, 25, 100),
    enforceRateLimit: false,
    enforceDailyLimit: !adminDailyQuotaBypassed,
  });

  if (!identityStatus || !rateStatus || !globalStatus) {
    return json({
      available: false,
      reason: "status_unavailable",
      message: "Could not check voice availability right now. Please try again shortly.",
      maxSessionSeconds: 0,
      dailyRemainingSeconds: null,
    }, 503, responseHeaders);
  }

  let reason = "available";
  let message = "Current limits allow a new voice conversation.";
  if (rateStatus.rateLimited) {
    reason = "rate_limited";
    message = "Too many connection attempts from this network just now. Please wait about " +
      Math.max(1, rateStatus.retryAfterSeconds) + " seconds before trying again.";
  } else if (identityStatus.concurrencyLimited) {
    reason = "already_active";
    message = "A voice conversation is already active for this browser. End it in the other tab before starting a new one.";
  } else if (!adminDailyQuotaBypassed && identityStatus.dailyLimitReached) {
    reason = "daily_limit";
    message = "Today's voice allowance for this browser has been used. It resets at midnight India time.";
  } else if (globalStatus.concurrencyLimited) {
    reason = "app_busy";
    message = "AskMoina is busy right now. Please wait a little and try again.";
  } else if (!adminDailyQuotaBypassed && globalStatus.dailyLimitReached) {
    reason = "app_daily_limit";
    message = "AskMoina has reached its overall voice allowance for today. Please try again after midnight India time.";
  }

  const dailyRemainingSeconds = Math.min(
    identityStatus.dailySecondsRemaining,
    globalStatus.dailySecondsRemaining,
  );
  const allowedDurationSeconds = adminDailyQuotaBypassed
    ? maxSessionSeconds
    : Math.max(0, Math.min(maxSessionSeconds, identityStatus.dailySecondsRemaining, globalStatus.dailySecondsRemaining));
  return json({
    available: reason === "available",
    reason,
    message,
    maxSessionSeconds: allowedDurationSeconds,
    dailyRemainingSeconds: adminDailyQuotaBypassed || identityStatus.activeSessions > 0 ? null : dailyRemainingSeconds,
    adminDailyQuotaBypassed,
  }, 200, responseHeaders);
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
  const voicePreviewRequested = requestUrl.searchParams.get("voice_preview") === "1";
  const requestedPreviewVoice = requestUrl.searchParams.get("voice_name") || undefined;
  if (requestUrl.searchParams.has("voice_name") && !voicePreviewRequested) {
    return json({ error: "invalid_voice_preview_request" }, 400);
  }
  if (voicePreviewRequested) {
    if (!await isAdmin(request, env)) return json({ error: "admin_required" }, 401);
    if (!isPrebuiltLiveVoiceName(requestedPreviewVoice)) {
      return json({ error: "unsupported_prebuilt_voice" }, 400);
    }
  }
  if (!hasVertexCredentials(env)) return json({ error: "voice_not_configured" }, 503);

  const adminDailyQuotaBypassed = await hasAdminDailyQuotaBypass(request, env);
  const reservation = await reserveVoiceSession(request, env, adminDailyQuotaBypassed);
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
  let firstAudioFrameLogged = false;
  let setupForwarded = false;
  let setupInitializing = false;
  let setupCompleteReceived = false;
  let copilotMode = false;
  let lastVideoFrameAt = 0;
  let closed = false;
  let inputWindowStart = Date.now();
  let inputFrameCount = 0;
  let inputBytesInWindow = 0;
  const MAX_CLIENT_FRAME_CHARS = 16_384;
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

  workerSocket.addEventListener("message", async (event: MessageEvent) => {
    if (upstreamSocket.readyState !== WebSocket.OPEN) return;

    // This browser proxy accepts small JSON frames only. Raw/binary frames and arbitrary
    // client messages are not needed for the current audio-only UI and are rejected.
    if (typeof event.data !== "string" || event.data.length > MAX_CLIENT_FRAME_CHARS) {
      closeBoth(1008, "Invalid or oversized client frame");
      return;
    }

    if (!setupForwarded) {
      if (setupInitializing) {
        closeBoth(1008, "Duplicate setup message");
        return;
      }
      setupInitializing = true;
      try {
        const message = JSON.parse(event.data) as { setup?: unknown; memory_context?: unknown; copilot_mode?: unknown };
        const allowedKeys = ["setup", "memory_context", "copilot_mode"];
        const memoryContext = typeof message?.memory_context === "string" ? message.memory_context.trim().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, 3_000) : "";
        if (event.data.length > 4_096 || !message || typeof message !== "object" || !message.setup || Object.keys(message).some((key) => !allowedKeys.includes(key)) || (message.memory_context !== undefined && typeof message.memory_context !== "string") || (message.copilot_mode !== undefined && typeof message.copilot_mode !== "boolean")) {
          closeBoth(1008, "First message must be a small setup object");
          return;
        }
        const pronunciationGuidance = await buildAssamesePronunciationInstruction(env.DB);
const baseInstruction = pronunciationGuidance
  ? `${SYSTEM_INSTRUCTION}\n\n${pronunciationGuidance}`
  : SYSTEM_INSTRUCTION;
const enableCopilotForSetup = message.copilot_mode === true;
const systemInstruction = buildPersonalizedSystemInstruction(
  enableCopilotForSetup ? `${baseInstruction}\n\n${COPILOT_SYSTEM_INSTRUCTION}` : baseInstruction,
  memoryContext,
);
        copilotMode = enableCopilotForSetup;
        const securedSetup = {
          model: `projects/${projectId}/locations/${location}/publishers/google/models/${model}`,
          generationConfig: voicePreviewRequested
            ? buildVoiceGenerationConfig(requestedPreviewVoice)
            : buildVoiceGenerationConfig(env.LIVE_VOICE_NAME, env.LIVE_VOICE_ID),
          tools: enableCopilotForSetup ? [COPILOT_TOOL] : undefined,
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
      const message = JSON.parse(event.data) as unknown;
      const parsed = parseLiveClientInput(message, copilotMode);
      if (!parsed) {
        closeBoth(1008, "Invalid or unsupported live input");
        return;
      }

      if (parsed.kind === "tool_response") {
        upstreamSocket.send(JSON.stringify({
          toolResponse: {
            functionResponses: parsed.ids.map((id) => ({
              id,
              name: "display_screen_overlay",
              response: { result: "The approximate overlay label was displayed to the user." },
            })),
          },
        }));
        return;
      }
      if (parsed.kind === "audio_stream_end") {
        upstreamSocket.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
        return;
      }

      const isVideo = parsed.kind === "video";
      const now = Date.now();
      if (isVideo) {
        // Gemini Live consumes video as individual frames; keep camera input near 1 FPS.
        if (now - lastVideoFrameAt < 850) return;
        lastVideoFrameAt = now;
      }
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
        console.warn("[AskMoina] Live media input sustained rate limit exceeded", JSON.stringify({
          frameRateAllowed,
          byteRateAllowed,
          inputFrameCount,
          inputBytesInWindow,
          isVideo,
          frameBudgetRemaining: Math.round(inputFrameBucket.remaining),
          byteBudgetRemaining: Math.round(inputByteBucket.remaining),
          lifetimeMs: now - upstreamStartedAt,
        }));
        closeBoth(1008, "Audio input rate limit exceeded");
        return;
      }

      if (isVideo) {
        upstreamSocket.send(JSON.stringify({
          realtimeInput: { video: { data: parsed.data, mimeType: "image/jpeg" } },
        }));
      } else {
        upstreamSocket.send(JSON.stringify({
          realtimeInput: { audio: { data: parsed.data, mimeType: "audio/pcm;rate=16000" } },
        }));
      }
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

    // Capture first-audio latency without logging audio, transcript text, or parsing base64.
    if (!firstAudioFrameLogged && isProviderAudioFrame(frameText)) {
      firstAudioFrameLogged = true;
      const firstAudioAt = Date.now();
      console.info("[AskMoina] First assistant audio frame", JSON.stringify({
        frameNumber,
        requestToFirstAudioMs: firstAudioAt - analyticsStartedAt,
        upstreamConnectedToFirstAudioMs: firstAudioAt - upstreamStartedAt,
        setupComplete: setupCompleteReceived,
        frameBytes: frameSize,
      }));
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
      console.log("[AskMoina] Vertex Live setup completed", JSON.stringify({
        frameNumber,
        requestToSetupMs: Date.now() - analyticsStartedAt,
        upstreamConnectedToSetupMs: Date.now() - upstreamStartedAt,
      }));
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

    if (url.pathname === "/copilot" || url.pathname === "/copilot.html" ||
        url.pathname === "/copilot.js" || url.pathname === "/copilot.css") {
      const isScript = url.pathname === "/copilot.js";
      const isStyle = url.pathname === "/copilot.css";
      const body = isScript ? COPILOT_JS : isStyle ? COPILOT_CSS : COPILOT_HTML;
      const contentType = isScript ? "text/javascript; charset=utf-8" :
        isStyle ? "text/css; charset=utf-8" : "text/html; charset=utf-8";
      const headers = new Headers({
        "Content-Type": contentType,
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; connect-src 'self' wss:; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; media-src 'self' blob:",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "no-referrer",
        "Permissions-Policy": "microphone=(self), camera=(self), geolocation=(), payment=()",
        "Cross-Origin-Resource-Policy": "same-origin",
      });
      return new Response(body, { status: 200, headers });
    }

    if (url.pathname === "/voice-lab" || url.pathname === "/voice-lab.html") {
      if (!await isAdmin(request, env)) {
        return Response.redirect(new URL("/admin/login", request.url).toString(), 302);
      }
      const labUrl = new URL(request.url);
      // Keep the asset request on the canonical clean path. Cloudflare's
      // automatic HTML handling redirects .html back to this route.
      labUrl.pathname = "/voice-lab";
      const labRequest = new Request(labUrl.toString(), request);
      const labResponse = await env.ASSETS.fetch(labRequest);
      const headers = new Headers(labResponse.headers);
      headers.set("Content-Security-Policy", "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; connect-src 'self' wss:; img-src 'self' data:; style-src 'self'; script-src 'self'; media-src 'self' blob:");
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("X-Frame-Options", "DENY");
      headers.set("Referrer-Policy", "no-referrer");
      headers.set("Permissions-Policy", "microphone=(self), camera=(), geolocation=(), payment=()");
      headers.set("Cross-Origin-Resource-Policy", "same-origin");
      headers.set("Cache-Control", "no-store");
      return new Response(labResponse.body, {
        status: labResponse.status,
        statusText: labResponse.statusText,
        headers,
      });
    }

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        app: "askmoina-voice",
        version: env.APP_VERSION || "0.4.3",
        environment: env.ENVIRONMENT || "unknown",
        status: hasVertexCredentials(env)
          ? "vertex-live-proxy-configured"
          : "vertex-live-proxy-awaiting-secrets",
        model: env.GEMINI_MODEL || "gemini-3.8-live",
        location: env.GEMINI_LOCATION || "us-central1",
        liveVoice: env.LIVE_VOICE_ID?.trim() || env.LIVE_VOICE_NAME?.trim() || DEFAULT_LIVE_VOICE_NAME,
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
      if (!html.includes('href="/copilot"') && !html.includes("href=/copilot")) {
        html = html.replace('href="/vault">Memory Vault</a>', 'href="/vault">Memory Vault</a><a class="brand-location vault-link" href="/copilot">Live Co-Pilot</a>');
        html = html.replace("href=/vault>Memory Vault</a>", "href=/vault>Memory Vault</a><a class=brand-location href=/copilot>Live Co-Pilot</a>");
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

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runRetentionMaintenance(env).catch((error) => {
        console.error("[AskMoina] Scheduled retention maintenance failed", error instanceof Error ? error.name : "unknown");
      }),
    );
  },
};
