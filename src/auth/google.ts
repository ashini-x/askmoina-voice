import type { Env } from "../config/env";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const TOKEN_REFRESH_SAFETY_MS = 90_000;
const TOKEN_TIMEOUT_MS = 8_000;

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;
let refreshInFlight: Promise<string> | null = null;

export async function getGoogleAccessToken(env: Env): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.accessToken;
  }
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = issueAccessToken(env).finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function issueAccessToken(env: Env): Promise<string> {
  const clientEmail = env.GCP_CLIENT_EMAIL?.trim();
  const privateKey = env.GCP_PRIVATE_KEY?.trim();
  const privateKeyId = env.GCP_PRIVATE_KEY_ID?.trim();

  if (!clientEmail || !privateKey) {
    throw new Error("Google Cloud service-account credentials are not configured.");
  }

  const assertion = await createServiceAccountAssertion({ clientEmail, privateKey, privateKeyId });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TOKEN_TIMEOUT_MS);

  try {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
      signal: controller.signal,
    });
    const result = (await response.json().catch(() => ({}))) as GoogleTokenResponse;

    if (!response.ok || !result.access_token) {
      throw new Error("Google Cloud authentication failed.");
    }

    const expiresIn =
      typeof result.expires_in === "number" && result.expires_in > 0
        ? result.expires_in * 1_000
        : 3_600_000;
    cachedToken = {
      accessToken: result.access_token,
      expiresAt: Date.now() + Math.max(1_000, expiresIn - TOKEN_REFRESH_SAFETY_MS),
    };
    return result.access_token;
  } finally {
    clearTimeout(timeout);
  }
}

async function createServiceAccountAssertion(input: {
  clientEmail: string;
  privateKey: string;
  privateKeyId?: string;
}): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1_000);
  const header: Record<string, string> = { alg: "RS256", typ: "JWT" };
  if (input.privateKeyId) header.kid = input.privateKeyId;
  const payload = {
    iss: input.clientEmail,
    scope: GOOGLE_CLOUD_PLATFORM_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: issuedAt,
    exp: issuedAt + 3_600,
  };

  const encodedHeader = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const encodedPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const key = await importPrivateKey(input.privateKey);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function importPrivateKey(privateKey: string): Promise<CryptoKey> {
  const normalized = privateKey.replace(/\\n/g, "\n").trim();
  const match = normalized.match(
    /-----BEGIN PRIVATE KEY-----([\s\S]+?)-----END PRIVATE KEY-----/,
  );
  if (!match) throw new Error("The configured Google Cloud private key is not valid PKCS#8 PEM.");

  const der = base64ToBytes(match[1].replace(/\s+/g, ""));
  return crypto.subtle.importKey(
    "pkcs8",
    der.slice().buffer as ArrayBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64ToBytes(value: string): Uint8Array {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
