import type { Env } from "./config/env";

async function sha256(value: string): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Uses a Durable Object keyed by a hash of Cloudflare's client IP; raw IPs are never stored. */
export async function allowIpRequest(
  env: Env,
  request: Request,
  scope: "identity" | "vault",
  maxPerMinute: number,
): Promise<boolean | null> {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) return null;
  try {
    const objectName = "request-limiter:" + scope + ":" + await sha256(ip);
    const id = env.USER_STATE.idFromName(objectName);
    const stub = env.USER_STATE.get(id);
    const response = await stub.fetch("https://user-state/internal/rate-limit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: maxPerMinute, windowMs: 60_000 }),
    });
    if (response.status === 429) return false;
    if (!response.ok) return null;
    const result = await response.json() as { allowed?: unknown };
    return result.allowed === true;
  } catch {
    return null;
  }
}
