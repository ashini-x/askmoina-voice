(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const statusNode = $("#status");
  const sheet = $("#authSheet");
  let pendingChallengeId = null;
  let pendingPhone = null;
  let currentMode = document.body.dataset.page === "account" ? "account" : "create";
  let busy = false;
  let activeCredentialAbort = null;

  const SERVER_MESSAGES = {
    phone_otp_not_configured: "Phone verification is not enabled on this server yet. The SMS verification provider must be configured before phone sign-in can work.",
    otp_delivery_unavailable: "The SMS service could not send a code. Please try again later.",
    otp_resend_cooldown: "Please wait before requesting another code.",
    invalid_phone: "Enter your number with its country code, such as +91…",
    invalid_otp: "That code could not be verified. Check it and try again.",
    verification_expired: "That verification request expired. Request a new code.",
    authentication_expired: "That passkey request expired. Please try again.",
    registration_expired: "That signup request expired. Please try again.",
    passkey_not_found: "No account has this passkey yet. Create an account first, or use a passkey already registered with AskMoina.",
    passkey_verification_failed: "Your device could not verify this passkey. Try again or use another device.",
    passkey_already_registered: "This passkey is already linked to an account. Switch to Sign in.",
    phone_already_linked: "That phone number is already linked to a different account.",
    sign_in_required: "Please sign in again, then retry this action."
  };

  function say(message, kind = "") {
    if (!statusNode) return;
    statusNode.textContent = message;
    statusNode.classList.toggle("error", kind === "error");
    statusNode.classList.toggle("success", kind === "success");
  }

  function setBusy(value) {
    busy = value;
    document.querySelectorAll("button").forEach((button) => {
      if (button.id === "cancelAuth") return;
      if (button.id === "modeCreate" || button.id === "modeSignin" ||
          button.id === "passkeyAction" || button.id === "addPasskey" ||
          button.id === "sendOtp" || button.id === "verifyOtp") {
        button.disabled = value;
      }
    });
  }

  function showSheet(title, message) {
    if (!sheet) return;
    const heading = $("#sheetTitle");
    const copy = $("#sheetCopy");
    if (heading) heading.textContent = title;
    if (copy) copy.textContent = message;
    sheet.hidden = false;
  }

  function hideSheet() {
    if (sheet) sheet.hidden = true;
  }

  function encode(value) {
    const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : value;
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function decode(value) {
    const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function post(path, payload = {}, signal) {
    const options = {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      credentials: "same-origin"
    };
    if (signal) options.signal = signal;
    const response = await fetch("/api/auth/" + path, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.message || SERVER_MESSAGES[data.error] || "The request could not be completed. Please try again.");
      error.code = data.error || "request_failed";
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function assertPasskeySupport() {
    if (!window.isSecureContext) {
      throw new Error("Passkeys require a secure HTTPS connection. Open AskMoina using its official secure address.");
    }
    if (!navigator.credentials || !window.PublicKeyCredential) {
      throw new Error("This browser cannot use passkeys. Update Safari or Chrome, or use phone number + OTP.");
    }
  }

  function explainPasskeyError(error, action) {
    if (error && error.code && SERVER_MESSAGES[error.code]) return SERVER_MESSAGES[error.code];
    if (error && error.name === "NotAllowedError") {
      return action === "create"
        ? "Your device prompt was cancelled or timed out. Unlock your device and try again. Your browser may offer Windows Hello, Touch ID, Face ID or a passkey on your phone."
        : "No passkey was selected, or the prompt was cancelled or timed out. Use a passkey already registered with AskMoina, or choose Create account if this is your first time.";
    }
    if (error && error.name === "SecurityError") {
      return "This web address cannot use that passkey. Open AskMoina on its official HTTPS address and use the same address each time.";
    }
    if (error && error.name === "NotSupportedError") {
      return "This device cannot complete that passkey method. Try an updated browser, another device, or phone number + OTP.";
    }
    if (error && error.name === "InvalidStateError") {
      return "This device already has a passkey for this account. Switch to Sign in instead.";
    }
    if (error && error.name === "AbortError") {
      return "The secure prompt was cancelled. You can try again whenever you are ready.";
    }
    if (error && typeof error.message === "string" && error.message) return error.message;
    return "Secure sign-in could not be completed. Please try again.";
  }

  function registration(credential) {
    return {
      id: credential.id,
      rawId: encode(credential.rawId),
      type: credential.type,
      authenticatorAttachment: credential.authenticatorAttachment || undefined,
      response: {
        clientDataJSON: encode(credential.response.clientDataJSON),
        attestationObject: encode(credential.response.attestationObject),
        transports: typeof credential.response.getTransports === "function" ? credential.response.getTransports() : []
      },
      clientExtensionResults: credential.getClientExtensionResults()
    };
  }

  function authentication(credential) {
    return {
      id: credential.id,
      rawId: encode(credential.rawId),
      type: credential.type,
      authenticatorAttachment: credential.authenticatorAttachment || undefined,
      response: {
        clientDataJSON: encode(credential.response.clientDataJSON),
        authenticatorData: encode(credential.response.authenticatorData),
        signature: encode(credential.response.signature),
        userHandle: credential.response.userHandle ? encode(credential.response.userHandle) : null
      },
      clientExtensionResults: credential.getClientExtensionResults()
    };
  }

  async function register(method = "device passkey") {
    if (busy) return;
    try { assertPasskeySupport(); }
    catch (error) { say(explainPasskeyError(error, "create"), "error"); return; }

    const controller = new AbortController();
    activeCredentialAbort = controller;
    setBusy(true);
    say("Preparing secure signup…");
    try {
      const options = await post("passkey/register/options", {}, controller.signal);
      const publicKey = {
        ...options,
        challenge: decode(options.challenge),
        user: { ...options.user, id: decode(options.user.id) },
        excludeCredentials: (options.excludeCredentials || []).map((item) => ({ ...item, id: decode(item.id) }))
      };
      delete publicKey.challengeId;
      showSheet("Confirm on your device", "Use your device’s secure prompt to create a passkey. Your face or fingerprint never leaves the device.");
      const credential = await navigator.credentials.create({ publicKey, signal: controller.signal });
      if (!credential) throw new Error("The device cancelled passkey creation.");
      hideSheet();
      say("Finishing your secure account…");
      await post("passkey/register/verify", {
        challengeId: options.challengeId,
        credential: registration(credential)
      });
      say("Your account is ready. Opening AskMoina…", "success");
      location.assign(document.body.dataset.page === "account" ? "/account" : "/");
    } catch (error) {
      hideSheet();
      if (error && error.name !== "AbortError") console.warn("[AskMoina] Passkey signup failed", error.name || "Error", error.code || "");
      say(explainPasskeyError(error, "create"), "error");
    } finally {
      activeCredentialAbort = null;
      setBusy(false);
    }
  }

  async function login() {
    if (busy) return;
    try { assertPasskeySupport(); }
    catch (error) { say(explainPasskeyError(error, "login"), "error"); return; }

    const controller = new AbortController();
    activeCredentialAbort = controller;
    setBusy(true);
    say("Preparing secure sign-in…");
    try {
      const options = await post("passkey/login/options", {}, controller.signal);
      const publicKey = {
        ...options,
        challenge: decode(options.challenge),
        allowCredentials: (options.allowCredentials || []).map((item) => ({ ...item, id: decode(item.id) }))
      };
      delete publicKey.challengeId;
      showSheet("Confirm your identity", "Choose the passkey saved for AskMoina. Your browser may use Face ID, Touch ID, Windows Hello or another device.");
      const credential = await navigator.credentials.get({ publicKey, signal: controller.signal });
      if (!credential) throw new Error("The device cancelled sign-in.");
      hideSheet();
      say("Verifying your passkey…");
      await post("passkey/login/verify", {
        challengeId: options.challengeId,
        credential: authentication(credential)
      });
      say("You’re signed in. Welcome back…", "success");
      location.assign("/");
    } catch (error) {
      hideSheet();
      if (error && error.name !== "AbortError") console.warn("[AskMoina] Passkey sign-in failed", error.name || "Error", error.code || "");
      say(explainPasskeyError(error, "login"), "error");
    } finally {
      activeCredentialAbort = null;
      setBusy(false);
    }
  }

  function setMode(mode) {
    currentMode = mode;
    const create = mode === "create";
    const createButton = $("#modeCreate");
    const signInButton = $("#modeSignin");
    const actionButton = $("#passkeyAction");
    const headline = $("#headline");
    const intro = $("#intro");
    const title = $("#passkeyTitle");
    const subtitle = $("#passkeySubtitle");
    if (createButton) createButton.setAttribute("aria-pressed", String(create));
    if (signInButton) signInButton.setAttribute("aria-pressed", String(!create));
    if (actionButton) actionButton.dataset.passkey = create ? "register" : "login";
    if (headline) headline.textContent = create ? "Create your private account." : "Welcome back.";
    if (intro) intro.textContent = create
      ? "One secure account for your conversations, preferences and memories. No guest access."
      : "Sign in securely to return to your conversations, preferences and saved memories.";
    if (title) title.textContent = "Continue with Face ID or Touch ID";
    if (subtitle) subtitle.textContent = create ? "Create a passkey on this device or another one" : "Use a passkey already saved for AskMoina";
    say("");
  }

  async function sendOtp() {
    if (busy) return;
    const rawPhone = $("#phone")?.value.trim() || "";
    const countryPrefix = $("#phoneCountry")?.textContent.trim();
    const phone = countryPrefix ? countryPrefix + rawPhone.replace(/\D/g, "") : rawPhone;
    if (!phone || (countryPrefix && rawPhone.replace(/\D/g, "").length < 8)) {
      say("Enter your phone number with country code, for example +91…", "error");
      $("#phone")?.focus();
      return;
    }
    setBusy(true);
    say("Requesting a secure verification code…");
    try {
      const result = await post("phone/start", { phone });
      pendingPhone = phone;
      pendingChallengeId = result.challengeId;
      const section = $("#otpSection");
      if (section) section.hidden = false;
      say("Enter the SMS code sent to " + phone + ".");
      $("#otpCode")?.focus();
    } catch (error) {
      say(explainPasskeyError(error, currentMode), "error");
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp() {
    if (busy) return;
    const code = $("#otpCode")?.value.trim() || "";
    if (!pendingChallengeId || !pendingPhone) {
      say("Request a verification code first.", "error");
      return;
    }
    if (!/^\d{4,10}$/.test(code)) {
      say("Enter the numeric verification code from your SMS.", "error");
      $("#otpCode")?.focus();
      return;
    }
    setBusy(true);
    say("Verifying your phone number…");
    try {
      await post("phone/verify", { challengeId: pendingChallengeId, phone: pendingPhone, code });
      pendingChallengeId = null;
      say("Phone verified. Opening AskMoina…", "success");
      location.assign(document.body.dataset.page === "account" ? "/account" : "/");
    } catch (error) {
      say(explainPasskeyError(error, currentMode), "error");
    } finally {
      setBusy(false);
    }
  }

  document.querySelectorAll("[data-passkey]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.passkey === "register") register(button.dataset.method || "device passkey");
      else if (button.dataset.passkey === "login") login();
    });
  });
  $("#modeCreate")?.addEventListener("click", () => setMode("create"));
  $("#modeSignin")?.addEventListener("click", () => setMode("signin"));
  $("#sendOtp")?.addEventListener("click", sendOtp);
  $("#verifyOtp")?.addEventListener("click", verifyOtp);
  $("#cancelAuth")?.addEventListener("click", () => {
    activeCredentialAbort?.abort();
    hideSheet();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && sheet && !sheet.hidden) {
      activeCredentialAbort?.abort();
      hideSheet();
    }
  });

  if (document.body.dataset.page === "account") {
    fetch("/api/auth/me", { cache: "no-store", credentials: "same-origin" })
      .then((response) => response.json())
      .then((data) => {
        if (!data.authenticated) {
          location.assign("/login");
          return;
        }
        const accountId = $("#accountId");
        if (accountId) accountId.textContent = data.userId;
      })
      .catch(() => say("Could not load your account. Please refresh the page.", "error"));
  } else {
    setMode("create");
    if (new URLSearchParams(window.location.search).get("reason") === "signed-out") say("You have signed out securely.", "success");
  }
})();