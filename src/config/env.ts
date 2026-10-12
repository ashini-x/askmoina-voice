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
  GCP_PROJECT_ID: string;
  ANALYTICS_RAW_RETENTION_DAYS: string;

  GCP_SERVICE_ACCOUNT_JSON?: string;
  // Optional split-secret compatibility; never place these in vars.
  GCP_CLIENT_EMAIL?: string;
  GCP_PRIVATE_KEY?: string;
  GCP_PRIVATE_KEY_ID?: string;
  ADMIN_DASHBOARD_USER?: string;
  ADMIN_DASHBOARD_PASSWORD?: string;
  ADMIN_SESSION_SECRET?: string;
  WEBAUTHN_RP_ID?: string;
  WEBAUTHN_ORIGIN?: string;
  AUTH_IDENTITY_PEPPER?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_VERIFY_SERVICE_SID?: string;
  // Optional model-specific prices in USD per million provider-reported tokens. Never guessed.
  LIVE_INPUT_USD_PER_MILLION_TOKENS?: string;
  LIVE_OUTPUT_USD_PER_MILLION_TOKENS?: string;
}
