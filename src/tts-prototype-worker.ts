import type { Env } from "./config/env";
import { getGoogleAccessToken } from "./auth/google";
import {
  generateTtsPrototypeTurn,
  normalizeTtsPrototypeInput,
  TtsPrototypeError,
} from "./sessions/tts-prototype";

const json = (data: unknown, status = 200): Response => Response.json(data, {
  status,
  headers: { "Cache-Control": "no-store" },
});

let requestWindowStartedAt = Date.now();
let requestCountInWindow = 0;
let activeGenerationCount = 0;
const REQUESTS_PER_MINUTE_PER_ISOLATE = 12;

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function tokenMatches(expected: string, provided: string): Promise<boolean> {
  if (!expected || !provided || provided.length > 512) return false;
  const [left, right] = await Promise.all([sha256(expected), sha256(provided)]);
  let difference = left.length ^ right.length;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function hasVertexCredentials(env: Env): boolean {
  return Boolean(
    env.GCP_PROJECT_ID?.trim() &&
    (env.GCP_SERVICE_ACCOUNT_JSON?.trim() ||
      (env.GCP_CLIENT_EMAIL?.trim() && env.GCP_PRIVATE_KEY?.trim())),
  );
}

async function handleTurn(request: Request, env: Env): Promise<Response> {
  if (env.TTS_PROTOTYPE_ENABLED?.trim().toLowerCase() !== "true") {
    return json({ error: "prototype_disabled" }, 404);
  }
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = new URL(request.url);
  if (request.headers.get("Origin") !== url.origin) return json({ error: "forbidden_origin" }, 403);

  const expectedToken = env.TTS_PROTOTYPE_ACCESS_TOKEN?.trim() || "";
  const authorization = request.headers.get("Authorization") || "";
  const providedToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!expectedToken) return json({ error: "prototype_unconfigured" }, 503);
  if (!await tokenMatches(expectedToken, providedToken)) return json({ error: "prototype_unauthorized" }, 401);
  if (!hasVertexCredentials(env)) return json({ error: "voice_not_configured" }, 503);
  if (!request.headers.get("Content-Type")?.toLowerCase().includes("application/json")) {
    return json({ error: "json_required" }, 415);
  }

  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > 1_300_000) return json({ error: "request_too_large" }, 413);

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  if (new TextEncoder().encode(raw).byteLength > 1_300_000) {
    return json({ error: "request_too_large" }, 413);
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "invalid_request" }, 400);
  }

  let input: ReturnType<typeof normalizeTtsPrototypeInput>;
  try {
    input = normalizeTtsPrototypeInput(body);
  } catch (error) {
    if (error instanceof TtsPrototypeError) return json({ error: error.code }, error.status || 400);
    return json({ error: "invalid_request" }, 400);
  }

  const now = Date.now();
  if (now - requestWindowStartedAt >= 60_000 || now < requestWindowStartedAt) {
    requestWindowStartedAt = now;
    requestCountInWindow = 0;
  }
  if (requestCountInWindow >= REQUESTS_PER_MINUTE_PER_ISOLATE || activeGenerationCount >= 1) {
    return json({ error: "prototype_busy_or_rate_limited" }, 429);
  }
  requestCountInWindow += 1;
  activeGenerationCount += 1;

  const startedAt = Date.now();
  try {
    const result = await generateTtsPrototypeTurn(env, input, { signal: request.signal });
    console.info("[AskMoina TTS prototype] Turn completed", JSON.stringify({
      totalMs: result.timings.totalMs,
      conversationMs: result.timings.conversationMs,
      speechSynthesisMs: result.timings.speechSynthesisMs,
      audioBytesBase64: result.audioWavBase64.length,
      elapsedMs: Date.now() - startedAt,
    }));
    return json({
      userTranscript: result.userTranscript,
      reply: result.reply,
      audio_wav_base64: result.audioWavBase64,
      audio_mime_type: result.audioMimeType,
      voiceId: result.voiceId,
      timings: result.timings,
    });
  } catch (error) {
    const prototypeError = error instanceof TtsPrototypeError
      ? error
      : new TtsPrototypeError("prototype_request_failed", 502);
    console.warn("[AskMoina TTS prototype] Turn failed", JSON.stringify({
      error: prototypeError.code,
      status: prototypeError.status || 502,
      elapsedMs: Date.now() - startedAt,
    }));
    const status = prototypeError.status && prototypeError.status >= 400 ? prototypeError.status : 502;
    return json({ error: prototypeError.code }, status);
  } finally {
    activeGenerationCount = Math.max(0, activeGenerationCount - 1);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/tts-prototype/turn") return handleTurn(request, env);

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        app: "askmoina-tts-prototype",
        version: env.APP_VERSION || "prototype-0.1.0",
        environment: "prototype",
        status: hasVertexCredentials(env) ? "tts-prototype-configured" : "tts-prototype-awaiting-secrets",
        conversationModel: "gemini-3.8-flash",
        speechModel: "gemini-3.8-flash-tts",
        voiceId: env.TTS_PROTOTYPE_VOICE_ID || "voice_6f4c602c-c79d-4a54-9bb1-c1549aab9c05",
      });
    }

    let assetRequest = request;
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/tts-prototype")) {
      const assetUrl = new URL("/tts-prototype.html", url);
      assetRequest = new Request(assetUrl, request);
    }
    const assetResponse = await env.ASSETS.fetch(assetRequest);
    const headers = new Headers(assetResponse.headers);
    headers.set(
      "Content-Security-Policy",
      "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; media-src 'self' blob:",
    );
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("X-Frame-Options", "DENY");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("Permissions-Policy", "microphone=(self), camera=(), geolocation=(), payment=()");
    headers.set("Cache-Control", "no-store");
    return new Response(assetResponse.body, {
      status: assetResponse.status,
      statusText: assetResponse.statusText,
      headers,
    });
  },
};
