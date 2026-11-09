import type { BrvinV2RpcBinding } from "../brvin-connector";

export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  // Veda data must never fall back to AskMoina's DB binding.
  VEDA_DB: D1Database;
  USER_STATE: DurableObjectNamespace;
  VEDA_SESSION_STATE: DurableObjectNamespace;
  LIVE_SESSION_RELAY: DurableObjectNamespace;
  BACKGROUND_QUEUE: Queue;
  /** Private server-side BRVIN Service Binding; intentionally absent from Worker Previews. */
  BRVIN_SERVICE?: BrvinV2RpcBinding;
  /** Trusted application default. Never read from browser/request input. */
  BRVIN_DEFAULT_PROJECT_ID?: string;
  BRVIN_CONNECTOR_TIMEOUT_MS?: string;

  APP_VERSION: string;
  // Explicit opt-in; Veda remains unavailable until its private app and runtime exist.
  VEDA_ENABLED?: string;
  // Controls the admin-only installation portal independently of Veda runtime enablement.
  VEDA_PORTAL_ENABLED?: string;
  ENVIRONMENT: string;
  GEMINI_MODEL: string;
  GEMINI_LOCATION: string;
  LIVE_VOICE_NAME?: string;
  // Temporary, authenticated per-session native voice comparison; false outside the audition.
  VOICE_AUDITION_ENABLED?: string;
  VOICE_AUDITION_EXPIRES_AT?: string;
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
  // Server-only DhanHQ token. The Dhan historical-data endpoint authenticates with access-token.
  // Explicit opt-in after Dhan data entitlements and single-/multi-user terms are verified.
}
