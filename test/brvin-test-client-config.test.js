import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const config = JSON.parse(
  readFileSync(new URL("../wrangler.brvin-test-client.jsonc", import.meta.url), "utf8"),
);

describe("isolated BRVIN test-client Worker configuration", () => {
  it("uses a distinct Worker entrypoint and deployment name", () => {
    expect(config.name).toBe("brvin-test-client");
    expect(config.main).toBe("workers/brvin-test-client/src/index.ts");
  });

  it("does not inherit AskMoina Voice production resources or routes", () => {
    expect(config).not.toHaveProperty("d1_databases");
    expect(config).not.toHaveProperty("durable_objects");
    expect(config).not.toHaveProperty("queues");
    expect(config).not.toHaveProperty("routes");
    expect(config.services).toBeUndefined();
  });

  it("requires a private tester token but does not hard-code one", () => {
    expect(config.secrets?.required).toEqual(["BRVIN_TEST_ACCESS_TOKEN"]);
    expect(JSON.stringify(config)).not.toMatch(/Bearer\s+[A-Za-z0-9_-]{20,}/u);
  });
});
