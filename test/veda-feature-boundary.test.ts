import { describe, expect, it } from "vitest";
import {
  handleVedaBoundaryRequest,
  isVedaEnabled,
  isVedaRoutePath,
  VEDA_PHASE,
} from "../src/veda/feature-boundary";

const env = (VEDA_ENABLED?: string) => ({ VEDA_ENABLED });

describe("Veda Phase 1 feature boundary", () => {
  it("recognizes only the reserved app and API route families", () => {
    expect(isVedaRoutePath("/veda")).toBe(true);
    expect(isVedaRoutePath("/veda/")).toBe(true);
    expect(isVedaRoutePath("/veda/assets/app.js")).toBe(true);
    expect(isVedaRoutePath("/api/veda/status")).toBe(true);
    expect(isVedaRoutePath("/api/veda")).toBe(true);
    expect(isVedaRoutePath("/vedas")).toBe(false);
    expect(isVedaRoutePath("/api/vedas/status")).toBe(false);
    expect(isVedaRoutePath("/admin")).toBe(false);
  });

  it("requires an explicit true feature flag", () => {
    expect(isVedaEnabled(env(undefined))).toBe(false);
    expect(isVedaEnabled(env("false"))).toBe(false);
    expect(isVedaEnabled(env("yes"))).toBe(false);
    expect(isVedaEnabled(env(" TRUE "))).toBe(true);
  });

  it("returns an uncacheable not-found response while disabled, even for admin", async () => {
    const response = handleVedaBoundaryRequest(
      new Request("https://example.test/api/veda/status"),
      env("false"),
      true,
    );
    expect(response?.status).toBe(404);
    expect(response?.headers.get("Cache-Control")).toBe("no-store");
    expect(await response?.json()).toEqual({ error: "not_found" });
  });

  it("does not expose app or API capability to a non-admin when enabled", () => {
    const api = handleVedaBoundaryRequest(
      new Request("https://example.test/api/veda/status"),
      env("true"),
      false,
    );
    expect(api?.status).toBe(401);

    const page = handleVedaBoundaryRequest(
      new Request("https://example.test/veda", { method: "GET" }),
      env("true"),
      false,
    );
    expect(page?.status).toBe(302);
    expect(page?.headers.get("Location")).toBe("https://example.test/admin/login");
  });

  it("exposes only a diagnostic status to an authorized admin while in Phase 1", async () => {
    const response = handleVedaBoundaryRequest(
      new Request("https://example.test/api/veda/status"),
      env("true"),
      true,
    );
    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({
      ok: true,
      feature: "veda",
      phase: VEDA_PHASE,
      enabled: true,
      runtimeReady: false,
      message: "Veda is isolated, but its installation UI, device pairing, and Live runtime are not implemented in Phase 1.",
    });
  });

  it("rejects unsupported methods and does not publish other routes", () => {
    const wrongMethod = handleVedaBoundaryRequest(
      new Request("https://example.test/api/veda/status", { method: "POST" }),
      env("true"),
      true,
    );
    expect(wrongMethod?.status).toBe(405);

    const unimplementedApi = handleVedaBoundaryRequest(
      new Request("https://example.test/api/veda/devices"),
      env("true"),
      true,
    );
    expect(unimplementedApi?.status).toBe(404);

    const unimplementedPage = handleVedaBoundaryRequest(
      new Request("https://example.test/veda"),
      env("true"),
      true,
    );
    expect(unimplementedPage?.status).toBe(404);
  });

  it("allows unrelated routes to fall through to AskMoina's existing router", () => {
    expect(
      handleVedaBoundaryRequest(
        new Request("https://example.test/api/voice/status"),
        env("true"),
        true,
      ),
    ).toBeNull();
  });
});
