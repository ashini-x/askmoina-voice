import { describe, expect, it } from "vitest";
import type { Env } from "../src/config/env";
import { VedaSessionState } from "../src/veda/session-state";

const makeState = () => new VedaSessionState(
  {} as DurableObjectState,
  { VEDA_ENABLED: "false" } as Env,
);

describe("Veda session-state namespace", () => {
  it("exposes only a no-store internal health diagnostic", async () => {
    const response = await makeState().fetch(
      new Request("https://internal.test/_internal/health"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      ok: true,
      feature: "veda",
      component: "session-state",
      featureEnabled: false,
      runtimeReady: false,
    });
  });

  it("does not publish session mutation methods in Phase 2", async () => {
    const response = await makeState().fetch(
      new Request("https://internal.test/session/start", { method: "POST" }),
    );
    expect(response.status).toBe(404);
  });
});
