import { describe, expect, it } from "vitest";
import { handleScorpioPreviewRequest, isScorpioPreviewRootRequest, isScorpioPreviewRoute } from "../src/scorpio-preview";

const url = (path: string) => `https://askmoina.test${path}`;
const sameOriginHeaders = { Origin: "https://askmoina.test", "Content-Type": "application/json" };

describe("Scorpio-N command preview boundary", () => {
  it("recognizes only the reserved preview and API route families", () => {
    expect(isScorpioPreviewRoute("/scorpio-preview")).toBe(true);
    expect(isScorpioPreviewRoute("/scorpio-preview.css")).toBe(true);
    expect(isScorpioPreviewRoute("/api/scorpio-preview/status")).toBe(true);
    expect(isScorpioPreviewRoute("/api/scorpio-preview/command")).toBe(true);
    expect(isScorpioPreviewRoute("/scorpio-preview-public")).toBe(false);
    expect(isScorpioPreviewRoute("/api/scorpio/status")).toBe(false);
  });

  it("redirects anonymous page access and rejects anonymous API access", async () => {
    const page = await handleScorpioPreviewRequest(new Request(url("/scorpio-preview")), false);
    const api = await handleScorpioPreviewRequest(new Request(url("/api/scorpio-preview/status")), false);
    expect(page?.status).toBe(302);
    expect(page?.headers.get("Location")).toBe(url("/"));
    expect(api?.status).toBe(401);
    expect(await api?.json()).toMatchObject({ error: "authentication_required" });
  });

  it("serves the command tester at the isolated preview website root without login", async () => {
    const host = "https://feature-scorpio-n-button-preview-askmoina-voice.thenewtongs.workers.dev";
    const request = new Request(host + "/");
    expect(isScorpioPreviewRootRequest(request)).toBe(true);
    const response = await handleScorpioPreviewRequest(request, false);
    expect(response?.status).toBe(200);
    expect(await response?.text()).toContain("Scorpio-N");
  });

  it("permits only simulation commands on the isolated preview host without login", async () => {
    const host = "https://feature-scorpio-n-button-preview-askmoina-voice.thenewtongs.workers.dev";
    const response = await handleScorpioPreviewRequest(new Request(host + "/api/scorpio-preview/command", {
      method: "POST",
      headers: { Origin: host, "Content-Type": "application/json" },
      body: JSON.stringify({ command: "windows_open", mode: "simulation" }),
    }), false);
    expect(response?.status).toBe(200);
    expect(await response?.json()).toMatchObject({ simulated: true, commandSent: false, mode: "simulation" });
  });

  it("states explicitly that no real connector is configured", async () => {
    const response = await handleScorpioPreviewRequest(new Request(url("/api/scorpio-preview/status")), true);
    expect(response?.status).toBe(200);
    expect(await response?.json()).toMatchObject({
      mode: "simulation",
      liveConnector: "not_configured",
      liveCommandsEnabled: false,
    });
  });

  it("runs a command through simulation without sending it to the vehicle", async () => {
    const response = await handleScorpioPreviewRequest(new Request(url("/api/scorpio-preview/command"), {
      method: "POST",
      headers: sameOriginHeaders,
      body: JSON.stringify({ command: "windows_open", mode: "simulation" }),
    }), true);
    expect(response?.status).toBe(200);
    expect(await response?.json()).toMatchObject({
      ok: true,
      mode: "simulation",
      simulated: true,
      commandSent: false,
      command: "windows_open",
    });
  });

  it("fails closed for live commands and makes no outbound vehicle call", async () => {
    const response = await handleScorpioPreviewRequest(new Request(url("/api/scorpio-preview/command"), {
      method: "POST",
      headers: sameOriginHeaders,
      body: JSON.stringify({ command: "windows_open", mode: "live" }),
    }), true);
    expect(response?.status).toBe(409);
    expect(await response?.json()).toMatchObject({ error: "live_connector_unavailable", commandSent: false });
  });

  it("refuses a cross-origin connection test", async () => {
    const response = await handleScorpioPreviewRequest(new Request(url("/api/scorpio-preview/connection-test"), {
      method: "POST",
      headers: { Origin: "https://attacker.test", "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "live" }),
    }), true);
    expect(response?.status).toBe(403);
    expect(await response?.json()).toMatchObject({ error: "same_origin_required", commandSent: false });
  });

  it("does not accept an unknown command", async () => {
    const response = await handleScorpioPreviewRequest(new Request(url("/api/scorpio-preview/command"), {
      method: "POST",
      headers: sameOriginHeaders,
      body: JSON.stringify({ command: "unlock_vehicle", mode: "simulation" }),
    }), true);
    expect(response?.status).toBe(400);
    expect(await response?.json()).toMatchObject({ error: "unsupported_command", commandSent: false });
  });
});
