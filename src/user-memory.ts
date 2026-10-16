import type { Env } from "./config/env";
import { getAuthenticatedUserId } from "./auth/accounts";

type MemoryKind = "communication" | "language" | "accessibility" | "interest" | "preference";
type MemoryRow = {
  memory_id: string;
  owner_id: string;
  kind: MemoryKind;
  content: string;
  source: "automatic" | "manual";
  created_at: string;
  updated_at: string;
};

const ROOT = "/api/memories";
const MAX_CONTENT_CHARS = 240;

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin || origin !== new URL(request.url).origin) return false;
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const length = Number(request.headers.get("Content-Length") || "0");
  if (Number.isFinite(length) && length > 8_192) return null;
  try {
    const value: unknown = await request.json();
    if (!isRecord(value) || new TextEncoder().encode(JSON.stringify(value)).byteLength > 8_192) return null;
    return value;
  } catch {
    return null;
  }
}

function cleanContent(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const content = value.trim().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  if (content.length < 2 || content.length > MAX_CONTENT_CHARS) return null;
  // Never turn credentials or verification codes into a reusable preference.
  if (/\b(password|passcode|one[- ]time password|\bOTP\b|secret key|recovery code|credit card number)\b/i.test(content)) return null;
  return content;
}

function preferenceKey(content: string): string {
  return content.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().slice(0, MAX_CONTENT_CHARS);
}

function inferKind(content: string): MemoryKind {
  if (/\b(language|speak|assamese|english|hindi|pronunciation|translate)\b/i.test(content)) return "language";
  if (/\b(font size|captions|subtitles|screen reader|accessibility|hearing|visual impairment)\b/i.test(content)) return "accessibility";
  if (/\b(i like|i love|i enjoy|favorite|favourite|interested in|hobby)\b/i.test(content)) return "interest";
  if (/\b(short|concise|detailed|bullet points|step by step|tone|formal|casual|examples|simple words|explain)\b/i.test(content)) return "communication";
  return "preference";
}

export function extractPreference(text: string): string | null {
  const value = text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!value || value.length > 20_000) return null;
  // Store only directly stated, reusable preferences—not inferred traits or general facts.
  const pattern = /(?:(?:please remember that\s+)?(?:i prefer(?: to)?|i would prefer|i'd prefer|i like|i love|i enjoy|i usually|i always|i never|i dislike|i hate|i do not like|i don't like|my favorite(?: thing)? is|my favourite(?: thing)? is|please always|please never|from now on|call me|refer to me as|answer me in|speak to me in|when you answer(?: me)?|i am more comfortable with|i'm more comfortable with)\s*[,;:]?\s+[^.!?\n]{2,220}|moi\s+[^.!?\n]{2,180}\s+(?:bhal pau|bhal pao|bhal lage|prefer koru|prefer koro)|mok\s+[^.!?\n]{2,180}\s+buli matiba)/i;
  const match = value.match(pattern);
  if (!match) return null;
  const candidate = cleanContent(match[0].replace(/[,;\s]+$/, ""));
  if (!candidate) return null;
  // Do not automatically persist sensitive personal disclosures.
  if (/\b(diagnos(?:ed|is)|medication|medical condition|health condition|religion|religious|hindu|muslim|christian|sikh|buddhist|dhormo|rajnoitik|politic(?:s|al)?|democrat|republican|liberal|conservative|sexual orientation|gender identity|transgender|sex life|ethnicity|race|caste|password|passcode|otp|credit card|bank account)\b/i.test(candidate)) return null;
  return candidate;
}

function memoryFromRow(row: MemoryRow) {
  return {
    id: row.memory_id,
    kind: row.kind,
    content: row.content,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function readEnabled(env: Env, ownerId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT enabled FROM user_memory_settings WHERE owner_id = ? LIMIT 1",
  ).bind(ownerId).first<{ enabled: number }>();
  return row ? row.enabled === 1 : true;
}

async function savePreference(
  env: Env,
  ownerId: string,
  content: string,
  source: "automatic" | "manual",
): Promise<MemoryRow | null> {
  const key = preferenceKey(content);
  if (key.length < 2) return null;
  const now = new Date().toISOString();
  const id = "mem_" + crypto.randomUUID().replace(/-/g, "");
  await env.DB.prepare(
    "INSERT INTO user_memories (memory_id, owner_id, kind, content, preference_key, source, created_at, updated_at) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT(owner_id, preference_key) DO UPDATE SET content = excluded.content, kind = excluded.kind, " +
    "source = CASE WHEN user_memories.source = 'manual' THEN 'manual' ELSE excluded.source END, updated_at = excluded.updated_at",
  ).bind(id, ownerId, inferKind(content), content, key, source, now, now).run();
  return env.DB.prepare(
    "SELECT memory_id, owner_id, kind, content, source, created_at, updated_at " +
    "FROM user_memories WHERE owner_id = ? AND preference_key = ? LIMIT 1",
  ).bind(ownerId, key).first<MemoryRow>();
}

/** Capture only explicit reusable preferences from finalized user turns. */
export async function observeUserPreferenceFromTurn(env: Env, ownerId: string, text: string): Promise<void> {
  if (!await readEnabled(env, ownerId)) return;
  const candidate = extractPreference(text);
  if (!candidate) return;
  await savePreference(env, ownerId, candidate, "automatic");
}

export async function handleUserMemoryRequest(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const pathname = url.pathname;
  if (pathname !== ROOT && pathname !== ROOT + "/settings" && !pathname.startsWith(ROOT + "/")) return null;

  if (!["GET", "POST", "PATCH", "DELETE"].includes(request.method)) {
    return json({ error: "method_not_allowed" }, 405);
  }
  const ownerId = await getAuthenticatedUserId(request, env);
  if (!ownerId) return json({ error: "authentication_required" }, 401);
  if (request.method !== "GET" && !sameOrigin(request)) return json({ error: "same_origin_required" }, 403);

  try {
    if (pathname === ROOT && request.method === "DELETE") {
      await env.DB.prepare("DELETE FROM user_memories WHERE owner_id = ?").bind(ownerId).run();
      return json({ deleted: true });
    }

    if (pathname === ROOT && request.method === "GET") {
      const [enabled, rows] = await Promise.all([
        readEnabled(env, ownerId),
        env.DB.prepare(
          "SELECT memory_id, owner_id, kind, content, source, created_at, updated_at " +
          "FROM user_memories WHERE owner_id = ? ORDER BY updated_at DESC, memory_id LIMIT 200",
        ).bind(ownerId).all<MemoryRow>(),
      ]);
      return json({ enabled, memories: (rows.results || []).map(memoryFromRow) });
    }

    if (pathname === ROOT + "/settings" && request.method === "PATCH") {
      const body = await readBody(request);
      if (!body || Object.keys(body).length !== 1 || typeof body.enabled !== "boolean") {
        return json({ error: "invalid_settings" }, 400);
      }
      const now = new Date().toISOString();
      await env.DB.prepare(
        "INSERT INTO user_memory_settings (owner_id, enabled, updated_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(owner_id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at",
      ).bind(ownerId, body.enabled ? 1 : 0, now).run();
      return json({ enabled: body.enabled });
    }

    if (pathname === ROOT && request.method === "POST") {
      const body = await readBody(request);
      if (!body || Object.keys(body).length !== 1) return json({ error: "invalid_memory" }, 400);
      if (!await readEnabled(env, ownerId)) return json({ error: "memory_disabled" }, 409);
      const content = cleanContent(body.content);
      if (!content) return json({ error: "invalid_memory_content" }, 400);
      const row = await savePreference(env, ownerId, content, "manual");
      if (!row) return json({ error: "memory_save_failed" }, 500);
      return json({ memory: memoryFromRow(row) }, 201);
    }

    const match = pathname.match(/^\/api\/memories\/([A-Za-z0-9_-]{1,100})$/);
    if (!match) return json({ error: "not_found" }, 404);
    const memoryId = match[1];
    if (request.method === "DELETE") {
      const result = await env.DB.prepare(
        "DELETE FROM user_memories WHERE memory_id = ? AND owner_id = ?",
      ).bind(memoryId, ownerId).run();
      if (Number(result.meta?.changes || 0) !== 1) return json({ error: "not_found" }, 404);
      return json({ deleted: true, id: memoryId });
    }
    if (request.method === "PATCH") {
      const body = await readBody(request);
      if (!body || Object.keys(body).length !== 1) return json({ error: "invalid_memory" }, 400);
      const content = cleanContent(body.content);
      if (!content) return json({ error: "invalid_memory_content" }, 400);
      const key = preferenceKey(content);
      const now = new Date().toISOString();
      const result = await env.DB.prepare(
        "UPDATE user_memories SET content = ?, kind = ?, preference_key = ?, source = 'manual', updated_at = ? " +
        "WHERE memory_id = ? AND owner_id = ?",
      ).bind(content, inferKind(content), key, now, memoryId, ownerId).run();
      if (Number(result.meta?.changes || 0) !== 1) return json({ error: "not_found_or_duplicate" }, 409);
      const row = await env.DB.prepare(
        "SELECT memory_id, owner_id, kind, content, source, created_at, updated_at FROM user_memories " +
        "WHERE memory_id = ? AND owner_id = ? LIMIT 1",
      ).bind(memoryId, ownerId).first<MemoryRow>();
      return row ? json({ memory: memoryFromRow(row) }) : json({ error: "not_found" }, 404);
    }
    return json({ error: "method_not_allowed" }, 405);
  } catch (error) {
    console.error("[AskMoina] User memory request failed", error instanceof Error ? error.name : "unknown");
    return json({ error: "user_memory_unavailable" }, 500);
  }
}
