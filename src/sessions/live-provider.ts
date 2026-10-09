import type { Env } from "../config/env";

export type LiveProvider = "gemini-api" | "vertex-ai";

type VoiceAuthEnv = Pick<
  Env,
  "GEMINI_API_KEY" | "GCP_PROJECT_ID" | "GCP_SERVICE_ACCOUNT_JSON" | "GCP_CLIENT_EMAIL" | "GCP_PRIVATE_KEY"
>;

type LiveModelEnv = Pick<Env, "GCP_PROJECT_ID" | "GEMINI_LOCATION" | "GEMINI_MODEL">;
type LiveVoiceEnv = Pick<Env, "GEMINI_LIVE_VOICE">;

export function hasVertexCredentials(env: VoiceAuthEnv): boolean {
  const hasJson = Boolean(env.GCP_SERVICE_ACCOUNT_JSON?.trim());
  const hasSplitSecrets = Boolean(env.GCP_CLIENT_EMAIL?.trim() && env.GCP_PRIVATE_KEY?.trim());
  return Boolean(env.GCP_PROJECT_ID?.trim() && (hasJson || hasSplitSecrets));
}

/** Prefer the Gemini API Live endpoint when its API key is configured. */
export function isUsingGeminiDeveloperApi(env: Pick<Env, "GEMINI_API_KEY">): boolean {
  return Boolean(env.GEMINI_API_KEY?.trim());
}

export function hasVoiceCredentials(env: VoiceAuthEnv): boolean {
  return isUsingGeminiDeveloperApi(env) || hasVertexCredentials(env);
}

export function getLiveModelResource(env: LiveModelEnv, provider: LiveProvider): string {
  const model = env.GEMINI_MODEL?.trim() || "gemini-3.8-live";
  if (provider === "gemini-api") return `models/${model}`;

  const projectId = env.GCP_PROJECT_ID.trim();
  const location = env.GEMINI_LOCATION?.trim() || "us-central1";
  return `projects/${projectId}/locations/${location}/publishers/google/models/${model}`;
}

export function getLiveVoiceName(env: LiveVoiceEnv): string {
  return env.GEMINI_LIVE_VOICE?.trim() || "Aoede";
}
