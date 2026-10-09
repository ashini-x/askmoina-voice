import type { Env } from "./config/env";
import { allowIpRequest } from "./rate-limit";

const MAX_BODY_BYTES = 256 * 1024;
const MAX_CIPHERTEXT_CHARS = 220_000;
const TOKEN_RE = /^[A-Za-z0-9_-]{40,64}$/;
const VAULT_ID_RE = /^[a-f0-9]{32}$/;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const EXPECTED_KDF = "PBKDF2-SHA-256";
const EXPECTED_ITERATIONS = 600000;

interface Envelope {
  version: 1;
  kdf: typeof EXPECTED_KDF;
  iterations: typeof EXPECTED_ITERATIONS;
  salt: string;
  iv: string;
  ciphertext: string;
}
interface VaultPayload extends Envelope {
  vaultId: string;
  token: string;
  expectedRevision: number;
}

const response = (data: unknown, status = 200): Response =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

function originIsSame(request: Request): boolean {
  const origin = request.headers.get("Origin");
  return Boolean(origin && origin === new URL(request.url).origin);
}

async function readJsonLimited(request: Request): Promise<Record<string, unknown> | null> {
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(result.value);
    }
  } catch {
    return null;
  }
  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(buffer));
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (item) => item.toString(16).padStart(2, "0")).join("");
}

function constantTimeStringEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i += 1) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}

function validEnvelope(value: Record<string, unknown>): value is Record<string, unknown> & Envelope {
  return value.version === 1 &&
    value.kdf === EXPECTED_KDF &&
    value.iterations === EXPECTED_ITERATIONS &&
    typeof value.salt === "string" && /^[A-Za-z0-9_-]{22}$/.test(value.salt) &&
    typeof value.iv === "string" && /^[A-Za-z0-9_-]{16}$/.test(value.iv) &&
    typeof value.ciphertext === "string" && value.ciphertext.length >= 22 &&
    value.ciphertext.length <= MAX_CIPHERTEXT_CHARS && BASE64URL_RE.test(value.ciphertext);
}

function validPayload(value: Record<string, unknown>): value is Record<string, unknown> & VaultPayload {
  return typeof value.vaultId === "string" && VAULT_ID_RE.test(value.vaultId) &&
    typeof value.token === "string" && TOKEN_RE.test(value.token) &&
    validEnvelope(value) &&
    Number.isSafeInteger(value.expectedRevision) && Number(value.expectedRevision) >= 0;
}

async function authorise(env: Env, vaultId: string, token: string): Promise<{ tokenHash: string; row: Record<string, unknown> | null } | null> {
  const tokenHash = await digest(token);
  const row = await env.DB.prepare(
    "SELECT token_hash, revision, version, kdf, iterations, salt, iv, ciphertext, created_at, updated_at FROM vault_backups WHERE vault_id = ?",
  ).bind(vaultId).first<Record<string, unknown>>();
  if (!row || typeof row.token_hash !== "string" || !constantTimeStringEqual(row.token_hash, tokenHash)) return null;
  return { tokenHash, row };
}

export async function handleVaultRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "POST" || !originIsSame(request)) return response({ error: "forbidden" }, 403);
  const input = await readJsonLimited(request);
  if (!input) return response({ error: "invalid_request" }, 400);

  if (url.pathname === "/api/vault/backup") {
    if (!validPayload(input)) return response({ error: "invalid_vault_envelope" }, 400);
    const allowed = await allowIpRequest(env, request, "vault", 30);
    if (allowed === false) return response({ error: "rate_limited" }, 429);
    if (allowed === null) return response({ error: "rate_limit_unavailable" }, 503);
    const existing = await env.DB.prepare("SELECT token_hash, revision FROM vault_backups WHERE vault_id = ?")
      .bind(input.vaultId).first<{ token_hash: string; revision: number }>();
    const tokenHash = await digest(input.token);
    if (!existing) {
      if (input.expectedRevision !== 0) return response({ error: "revision_conflict", code: "REVISION_CONFLICT" }, 409);
      try {
        await env.DB.prepare(
          "INSERT INTO vault_backups (vault_id, token_hash, version, kdf, iterations, salt, iv, ciphertext, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
        ).bind(input.vaultId, tokenHash, input.version, input.kdf, input.iterations, input.salt, input.iv, input.ciphertext).run();
        return response({ ok: true, revision: 1 });
      } catch (error) {
        console.error("[AskMoina] vault backup create failed", error instanceof Error ? error.message : "unknown");
        return response({ error: "backup_unavailable" }, 503);
      }
    }
    if (!constantTimeStringEqual(existing.token_hash, tokenHash)) return response({ error: "not_found" }, 404);
    const expectedRevision = Number(input.expectedRevision);
    if (expectedRevision !== Number(existing.revision)) {
      return response({ error: "revision_conflict", code: "REVISION_CONFLICT", revision: Number(existing.revision) }, 409);
    }
    const result = await env.DB.prepare(
      "UPDATE vault_backups SET version=?, kdf=?, iterations=?, salt=?, iv=?, ciphertext=?, revision=revision+1, updated_at=CURRENT_TIMESTAMP WHERE vault_id=? AND token_hash=? AND revision=?",
    ).bind(input.version, input.kdf, input.iterations, input.salt, input.iv, input.ciphertext,
      input.vaultId, tokenHash, expectedRevision).run();
    if (!result.success || (result.meta?.changes ?? 0) !== 1) {
      return response({ error: "revision_conflict", code: "REVISION_CONFLICT" }, 409);
    }
    return response({ ok: true, revision: expectedRevision + 1 });
  }

  if (url.pathname === "/api/vault/restore") {
    const vaultId = typeof input.vaultId === "string" ? input.vaultId : "";
    const token = typeof input.token === "string" ? input.token : "";
    if (!VAULT_ID_RE.test(vaultId) || !TOKEN_RE.test(token)) return response({ error: "invalid_request" }, 400);
    const allowed = await allowIpRequest(env, request, "vault", 30);
    if (allowed === false) return response({ error: "rate_limited" }, 429);
    if (allowed === null) return response({ error: "rate_limit_unavailable" }, 503);
    const authorised = await authorise(env, vaultId, token);
    if (!authorised?.row) return response({ error: "not_found" }, 404);
    const row = authorised.row;
    return response({
      ok: true,
      revision: Number(row.revision),
      envelope: { version: Number(row.version), kdf: row.kdf, iterations: Number(row.iterations),
        salt: row.salt, iv: row.iv, ciphertext: row.ciphertext },
    });
  }

  if (url.pathname === "/api/vault/delete") {
    const vaultId = typeof input.vaultId === "string" ? input.vaultId : "";
    const token = typeof input.token === "string" ? input.token : "";
    if (!VAULT_ID_RE.test(vaultId) || !TOKEN_RE.test(token)) return response({ error: "invalid_request" }, 400);
    const authorised = await authorise(env, vaultId, token);
    if (!authorised) return response({ error: "not_found" }, 404);
    await env.DB.prepare("DELETE FROM vault_backups WHERE vault_id=? AND token_hash=?")
      .bind(vaultId, authorised.tokenHash).run();
    return response({ ok: true });
  }
  return response({ error: "not_found" }, 404);
}
