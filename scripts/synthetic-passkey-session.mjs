#!/usr/bin/env node
/**
 * Create an authenticated production synthetic session with the same passkey
 * signup API that normal users use, backed by Chromium's virtual authenticator.
 * Only the session cookie is written to stdout; it must be masked by the caller.
 */
import { chromium } from "playwright";

const baseUrl = (process.env.BASE_URL || "https://askmoina-voice.thenewtongs.workers.dev").replace(/\/$/, "");
if (!baseUrl.startsWith("https://")) {
  console.error("Synthetic passkey setup: HTTPS BASE_URL is required.");
  process.exit(1);
}
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(baseUrl + "/login", { waitUntil: "domcontentloaded", timeout: 30000 });

  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true
    }
  });

  const registration = await page.evaluate(async () => {
    const post = async (path, payload) => {
      const response = await fetch(path, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = await response.json().catch(() => ({}));
      return { response, body };
    };
    const decode = (value) => {
      const base64 = String(value).replace(/-/g, "+").replace(/_/g, "/");
      const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
      const raw = atob(padded);
      return Uint8Array.from(raw, ch => ch.charCodeAt(0)).buffer;
    };
    const encode = (value) => {
      const bytes = new Uint8Array(value);
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    };

    const optionsResult = await post("/api/auth/passkey/register/options", {});
    if (!optionsResult.response.ok || !optionsResult.body.challengeId || !optionsResult.body.challenge) {
      return { ok: false, stage: "registration-options", status: optionsResult.response.status };
    }
    const options = optionsResult.body;
    const publicKey = {
      ...options,
      challenge: decode(options.challenge),
      user: { ...options.user, id: decode(options.user.id) },
      excludeCredentials: (options.excludeCredentials || []).map(item => ({
        ...item,
        id: decode(item.id)
      }))
    };
    delete publicKey.challengeId;

    let credential;
    try {
      credential = await navigator.credentials.create({ publicKey });
    } catch {
      return { ok: false, stage: "virtual-authenticator-create", status: 0 };
    }
    if (!credential) return { ok: false, stage: "virtual-authenticator-empty", status: 0 };

    const serialized = {
      id: credential.id,
      rawId: encode(credential.rawId),
      type: credential.type,
      response: {
        attestationObject: encode(credential.response.attestationObject),
        clientDataJSON: encode(credential.response.clientDataJSON),
        transports: typeof credential.response.getTransports === "function"
          ? credential.response.getTransports()
          : ["internal"]
      },
      clientExtensionResults: credential.getClientExtensionResults()
    };
    const verified = await post("/api/auth/passkey/register/verify", {
      challengeId: options.challengeId,
      credential: serialized
    });
    if (!verified.response.ok || verified.body.ok !== true) {
      return { ok: false, stage: "registration-verification", status: verified.response.status };
    }
    const meResponse = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" });
    const me = await meResponse.json().catch(() => ({}));
    return { ok: meResponse.ok && me.authenticated === true, stage: "session-check", status: meResponse.status };
  });

  if (!registration.ok) {
    throw new Error("passkey setup failed at " + registration.stage + " (HTTP " + registration.status + ")");
  }
  const cookies = await context.cookies(baseUrl);
  const sessionCookie = cookies.find(cookie => cookie.name === "moina_session" && cookie.value);
  if (!sessionCookie || !/^[A-Za-z0-9_-]{43}$/.test(sessionCookie.value)) {
    throw new Error("verified account session cookie was not issued");
  }
  process.stdout.write("moina_session=" + sessionCookie.value);
} catch (error) {
  console.error("Synthetic authenticated session setup: FAIL (" +
    (error instanceof Error ? error.message.slice(0, 180) : "unknown error") + ")");
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => undefined);
}
