import { describe, expect, it } from "vitest";
import {
  handleVedaBoundaryRequest,
  isVedaEnabled,
  isVedaPortalEnabled,
  isVedaRoutePath,
  VEDA_PHASE,
} from "../src/veda/feature-boundary";

const env = (VEDA_ENABLED?: string, VEDA_PORTAL_ENABLED?: string) => ({ VEDA_ENABLED, VEDA_PORTAL_ENABLED });

describe("Veda Phase 3 private installation portal", () => {
  it("enables the portal separately without enabling the listening runtime", () => {
    expect(isVedaEnabled(env("false", "true"))).toBe(false);
    expect(isVedaPortalEnabled(env("false", "true"))).toBe(true);
    expect(VEDA_PHASE).toBe("phase-3-private-install-portal");
  });

  it("denies anonymous access to every portal document, asset and API", () => {
    const paths = [
      "/veda", "/veda/", "/veda/install", "/veda/manifest.webmanifest",
      "/veda/service-worker.js", "/veda/icon.svg", "/veda/app.css", "/veda/app.js",
      "/api/veda/status",
    ];
    for (const path of paths) {
      const response = handleVedaBoundaryRequest(
        new Request("https://example.test" + path),
        env("false", "true"),
        false,
      )!;
      expect([302, 401]).toContain(response.status);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      if (path === "/api/veda/status" || (path.startsWith("/veda/") && !["/veda/", "/veda/install"].includes(path))) {
        expect(response.status).toBe(401);
      }
    }
  });

  it("serves the private portal and manifest after server-side admin authorization", async () => {
    const page = handleVedaBoundaryRequest(
      new Request("https://example.test/veda/"),
      env("false", "true"),
      true,
    )!;
    expect(page.status).toBe(200);
    expect(page.headers.get("Content-Type")).toContain("text/html");
    expect(page.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(await page.text()).toContain("Install Veda");

    const manifestResponse = handleVedaBoundaryRequest(
      new Request("https://example.test/veda/manifest.webmanifest"),
      env("false", "true"),
      true,
    )!;
    expect(manifestResponse.status).toBe(200);
    const manifest = await manifestResponse.json() as {
      start_url: string;
      scope: string;
      icons: Array<{ src: string }>;
    };
    expect(manifest.start_url).toBe("/veda/?source=pwa");
    expect(manifest.scope).toBe("/veda/");
    expect(manifest.icons[0].src).toBe("/veda/icon.svg");
  });

  it("reports portal availability without enabling listening or device commands", async () => {
    const response = handleVedaBoundaryRequest(
      new Request("https://example.test/api/veda/status"),
      env("false", "true"),
      true,
    )!;
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      phase: VEDA_PHASE,
      portalEnabled: true,
      enabled: false,
      runtimeReady: false,
      state: "runtime_disabled",
    });
    expect(handleVedaBoundaryRequest(
      new Request("https://example.test/api/veda/devices", { method: "POST" }),
      env("false", "true"),
      true,
    )?.status).toBe(404);
  });

  it("keeps all routes hidden if both Veda flags are disabled", () => {
    expect(handleVedaBoundaryRequest(
      new Request("https://example.test/api/veda/status"),
      env("false", "false"),
      true,
    )?.status).toBe(404);
  });

  it("preserves unrelated AskMoina routing", () => {
    expect(handleVedaBoundaryRequest(
      new Request("https://example.test/api/voice/status"),
      env("false", "true"),
      true,
    )).toBeNull();
    expect(isVedaRoutePath("/admin")).toBe(false);
  });
});
