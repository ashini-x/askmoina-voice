import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workerConfig = JSON.parse(
  readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
) as {
  vars: Record<string, string>;
  triggers?: { crons?: string[] };
  secrets?: { required?: string[] };
};

const workerSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");

describe("production architecture guardrails", () => {
  it("keeps the live voice route on Vertex AI", () => {
    expect(workerConfig.vars.GEMINI_MODEL).toBe("gemini-3.8-live");
    expect(workerConfig.vars.GEMINI_LOCATION).toBe("us-central1");
    expect(workerSource).toContain("aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent");
    expect(workerSource).not.toContain("generativelanguage.googleapis.com");
    expect(workerConfig.secrets?.required).toContain("GCP_SERVICE_ACCOUNT_JSON");
    expect(workerConfig.secrets?.required).not.toContain("GEMINI_API_KEY");
  });

  it("schedules retention maintenance hourly", () => {
    expect(workerConfig.triggers?.crons).toContain("17 * * * *");
    expect(workerSource).toContain("runRetentionMaintenance(env)");
  });
});
