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

  it("connects only to the private BRVIN service without inheriting AskMoina Voice resources", () => {
    expect(config).not.toHaveProperty("d1_databases");
    expect(config).not.toHaveProperty("durable_objects");
    expect(config).not.toHaveProperty("queues");
    expect(config).not.toHaveProperty("routes");
    expect(config.services).toHaveLength(1);
    expect(config.services[0]).toMatchObject({
      binding: "BRVIN_SERVICE",
      service: "brvin-service",
      entrypoint: "BrvinRetrievalApi",
    });
    expect(config.services[0].props?.applicationEnvironmentId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
    );
  });

  it("keeps the runtime tester gate closed until the Connect wizard provisions its secret", () => {
    const workerSource = readFileSync(new URL("../workers/brvin-test-client/src/index.ts", import.meta.url), "utf8");
    expect(config.secrets?.required ?? []).not.toContain("BRVIN_TEST_ACCESS_TOKEN");
    expect(workerSource).toContain("BRVIN_TEST_ACCESS_TOKEN");
    expect(workerSource).toContain("TEST_ACCESS_NOT_CONFIGURED");
    expect(JSON.stringify(config)).not.toMatch(/Bearer\\s+[A-Za-z0-9_-]{20,}/u);
  });
});
