export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  USER_STATE: DurableObjectNamespace;
  BACKGROUND_QUEUE: Queue;

  APP_VERSION: string;
  ENVIRONMENT: string;
  GEMINI_MODEL: string;
  GEMINI_LOCATION: string;
  LIVE_VOICE_NAME?: string;
  LIVE_VOICE_ID?: string;
  TTS_PROTOTYPE_ENABLED?: string;
  TTS_PROTOTYPE_ACCESS_TOKEN?: string;
  TTS_PROTOTYPE_VOICE_ID?: string;
  GCP_PROJECT_ID: string;
  MAX_LIVE_SESSION_SECONDS: string;
  MAX_DAILY_SESSION_SECONDS: string;
  MAX_CONCURRENT_SESSIONS_PER_USER: string;
  MAX_GLOBAL_DAILY_SESSION_SECONDS: string;
  MAX_GLOBAL_CONCURRENT_SESSIONS: string;
  ANALYTICS_RAW_RETENTION_DAYS: string;

  GCP_SERVICE_ACCOUNT_JSON?: string;
  // Optional split-secret compatibility; never place these in vars.
  GCP_CLIENT_EMAIL?: string;
  GCP_PRIVATE_KEY?: string;
  GCP_PRIVATE_KEY_ID?: string;
  ADMIN_DASHBOARD_USER?: string;
  ADMIN_DASHBOARD_PASSWORD?: string;
  ADMIN_SESSION_SECRET?: string;
}
