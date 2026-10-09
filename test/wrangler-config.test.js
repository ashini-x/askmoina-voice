import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const config = JSON.parse(
  readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
);

describe("production Worker configuration", () => {
  it("declares the production credentials required by voice and admin routes", () => {
    expect(config.secrets?.required).toEqual(
      expect.arrayContaining([
        "GCP_SERVICE_ACCOUNT_JSON",
        "ADMIN_DASHBOARD_PASSWORD",
        "ADMIN_SESSION_SECRET",
      ]),
    );
  });
});
