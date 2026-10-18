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
      if (button.matches("[data-passkey], #modeCreate, #modeSignin, #modeToggleButton, #phoneOptionButton, #phoneBackButton, #addPasskey, #sendOtp, #verifyOtp")) {
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

  // Fixed vector paths; a single SVG element prevents two biometric marks showing together.
  const BIOMETRIC_FACE_ICON_MARKUP = '<path d="M29 12H21a9 9 0 0 0-9 9v8M67 12h8a9 9 0 0 1 9 9v8M84 67v8a9 9 0 0 1-9 9h-8M29 84h-8a9 9 0 0 1-9-9v-8"/><path d="M34 36v8M62 36v8M39 59c5.3 4.2 12.7 4.2 18 0M48 43v7"/>';
  const BIOMETRIC_FINGERPRINT_ICON_MARKUP = '<path d="M48 12c-20 0-36 15.9-36 35.5M48 21c-15 0-27 12-27 26.5"/><path d="M48 30c-10 0-18 8-18 17.5 0 14-2.5 23-8 31M48 39c-5 0-9 4-9 8.5 0 17-1.4 28-5.5 38M48 48c0 20-1 30-4 38M57 49c0 16.2-.7 27.8-4.2 37M57 31c10.5 3.8 18 14 18 26.5 0 10.8-1.4 19.6-4.1 28M66 21c11 7.4 18 19.6 18 33.5 0 9-1.5 18.7-4.5 27"/>';
  function showBiometricStage(kind) {
    const overlay = $(".entry-overlay");
    const panel = $(".entry-auth-panel");
    const stage = $("#biometricAuthStage");
    const title = $("#biometricTitle");
    const instruction = $("#biometricInstruction");
    const symbol = $("#biometricSymbol");
    if (!overlay || !panel || !stage) return;
    if (!kind) {
      overlay.classList.remove("is-biometric");
      panel.hidden = false;
      stage.hidden = true;
      return;
    }
    const isFace = kind === "face";
    if (title) title.textContent = isFace ? "Face ID" : "Fingerprint";
    if (instruction) instruction.textContent = isFace
      ? "Look at the camera"
      : "Place your finger on the sensor";
    if (symbol) {
      // Replace paths inside one SVG. The two marks never coexist in the DOM.
      symbol.innerHTML = isFace ? BIOMETRIC_FACE_ICON_MARKUP : BIOMETRIC_FINGERPRINT_ICON_MARKUP;
      symbol.classList.toggle("biometric-face-symbol", isFace);
      symbol.classList.toggle("biometric-fingerprint-symbol", !isFace);
      symbol.style.setProperty("display", "block", "important");
    }
    panel.hidden = true;
    stage.hidden = false;
    stage.dataset.kind = isFace ? "face" : "fingerprint";
    overlay.classList.add("is-biometric");
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
        : "No passkey was used. Try again, set one up on this device, or use your phone number.";
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
    catch (error) { showBiometricStage(null); say(explainPasskeyError(error, "create"), "error"); return; }

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
      // Let the browser show its native passkey prompt directly; no app modal/flash.
      const credential = await navigator.credentials.create({ publicKey, signal: controller.signal });
      if (!credential) throw new Error("The device cancelled passkey creation.");
      hideSheet();
      say("Finishing your secure account…");
      await post("passkey/register/verify", {
        challengeId: options.challengeId,
        credential: registration(credential)
      });
      say("Your account is ready. Opening AskMoina…", "success");
      await navigateAfterAuth(document.body.dataset.page === "account" ? "/account" : "/");
    } catch (error) {
      hideSheet();
      showBiometricStage(null);
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
    catch (error) { showBiometricStage(null); say(explainPasskeyError(error, "login"), "error"); return; }

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
      // Let the browser show its native passkey prompt directly; no app modal/flash.
      const credential = await navigator.credentials.get({ publicKey, signal: controller.signal });
      if (!credential) throw new Error("The device cancelled sign-in.");
      hideSheet();
      say("Verifying your passkey…");
      await post("passkey/login/verify", {
        challengeId: options.challengeId,
        credential: authentication(credential)
      });
      say("You’re signed in. Welcome back…", "success");
      await navigateAfterAuth("/");
    } catch (error) {
      hideSheet();
      showBiometricStage(null);
      if (error && error.name !== "AbortError") console.warn("[AskMoina] Passkey sign-in failed", error.name || "Error", error.code || "");
      if (error && (error.code === "passkey_not_found" || error.name === "NotAllowedError")) {
        const createAlternative = $("#createPasskeyAlternative");
        if (createAlternative) createAlternative.hidden = false;
        say(error.code === "passkey_not_found"
          ? "No passkey is registered yet. Set one up on this device, or use your phone number."
          : "Passkey sign-in was cancelled or no saved passkey was available. Try again, set one up on this device, or use your phone number.", "normal");
      } else {
        say(explainPasskeyError(error, "login"), "error");
      }
    } finally {
      activeCredentialAbort = null;
      setBusy(false);
    }
  }

  async function navigateAfterAuth(destination) {
    // Navigate as soon as authentication succeeds; do not cover the screen with a launch interstitial.
    const next = destination;
    window.location.replace(next);
  }

  function setMode(mode) {
    currentMode = mode === "signin" ? "signin" : "create";
    const create = currentMode === "create";
    const createButton = $("#modeCreate");
    const signInButton = $("#modeSignin");
    const headline = $("#authTitle") || $("#headline");
    const intro = $("#authSubtitle") || $("#intro");
    const legacyTitle = $("#passkeyTitle");
    const subtitle = $("#passkeySubtitle");
    const toggleCopy = $("#modeSwitchCopy");
    const toggleButton = $("#modeToggleButton");

    if (createButton) createButton.setAttribute("aria-pressed", String(create));
    if (signInButton) signInButton.setAttribute("aria-pressed", String(!create));
    document.querySelectorAll("[data-passkey]").forEach((button) => {
      if (button.id === "createPasskeyAlternative") {
        button.dataset.passkey = "register";
        button.hidden = true;
        return;
      }
      button.dataset.passkey = create ? "register" : "login";
    });
    if (headline) headline.textContent = create ? "Welcome to askmoina" : "Welcome back";
    if (intro) intro.textContent = create
      ? "Your live camera & video co-pilot for real-world problems."
      : "Sign in to continue to your camera, conversations and Key Memories.";
    if (legacyTitle && !$("#authTitle")) legacyTitle.textContent = "Continue with Face ID or Touch ID";
    if (subtitle) subtitle.textContent = create ? "Create a passkey on this device or another one" : "Use a passkey already saved for askmoina";
    if (toggleCopy) toggleCopy.textContent = create ? "Already have an account?" : "New to askmoina?";
    if (toggleButton) toggleButton.textContent = create ? "Sign in" : "Create account";
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
      const panel = $(".entry-auth-panel");
      const phoneInput = $("#phone");
      if (panel) panel.classList.add("is-otp-flow");
      if (phoneInput) phoneInput.readOnly = true;
      const section = $("#otpSection");
      if (section) section.hidden = false;
      const title = $("#authTitle");
      const intro = $("#authSubtitle");
      if (title) title.textContent = "Enter code";
      if (intro) intro.textContent = "Sent to " + phone + ".";
      say("Code sent.");
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
      await navigateAfterAuth(document.body.dataset.page === "account" ? "/account" : "/");
    } catch (error) {
      say(explainPasskeyError(error, currentMode), "error");
    } finally {
      setBusy(false);
    }
  }

  document.querySelectorAll("[data-passkey]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.id === "passkeyAction") showBiometricStage("face");
      else if (button.id === "touchIdAction") showBiometricStage("fingerprint");
      if (button.dataset.passkey === "register") register(button.dataset.method || "device passkey");
      else if (button.dataset.passkey === "login") login();
    });
  });
  $("#biometricCancel")?.addEventListener("click", () => {
    activeCredentialAbort?.abort();
    showBiometricStage(null);
  });
  $("#modeCreate")?.addEventListener("click", () => setMode("create"));
  $("#modeSignin")?.addEventListener("click", () => setMode("signin"));
  $("#phoneOptionButton")?.addEventListener("click", () => {
    const panel = $(".entry-auth-panel");
    if (panel) {
      panel.classList.add("is-phone-flow");
      panel.classList.remove("is-otp-flow");
    }
    const phoneInput = $("#phone");
    if (phoneInput) phoneInput.readOnly = false;
    const options = $("#authOptions");
    const phoneSection = $("#phoneEntrySection");
    const divider = $("#entryAuthDivider");
    if (options) options.hidden = true;
    if (phoneSection) phoneSection.hidden = false;
    if (divider) divider.hidden = true;
    const title = $("#authTitle");
    const intro = $("#authSubtitle");
    if (title) title.textContent = "Phone number";
    if (intro) intro.textContent = "We'll text you a code.";
    say("");
    // Let the user tap the field intentionally; avoids popping mobile autofill UI over the page.
  });
  $("#phoneBackButton")?.addEventListener("click", () => {
    const panel = $(".entry-auth-panel");
    if (panel) {
      panel.classList.remove("is-phone-flow", "is-otp-flow");
    }
    const phoneInput = $("#phone");
    if (phoneInput) phoneInput.readOnly = false;
    const options = $("#authOptions");
    const phoneSection = $("#phoneEntrySection");
    const divider = $("#entryAuthDivider");
    const otp = $("#otpSection");
    if (options) options.hidden = false;
    if (phoneSection) phoneSection.hidden = true;
    if (divider) divider.hidden = false;
    if (otp) otp.hidden = true;
    pendingChallengeId = null;
    pendingPhone = null;
    if ($("#otpCode")) $("#otpCode").value = "";
    setMode(currentMode);
  });
  $("#modeToggleButton")?.addEventListener("click", () => {
    const panel = $(".entry-auth-panel");
    if (panel) {
      panel.classList.remove("is-phone-flow", "is-otp-flow");
    }
    const phoneInput = $("#phone");
    if (phoneInput) phoneInput.readOnly = false;
    const options = $("#authOptions");
    const phoneSection = $("#phoneEntrySection");
    const divider = $("#entryAuthDivider");
    const otp = $("#otpSection");
    if (options) options.hidden = false;
    if (phoneSection) phoneSection.hidden = true;
    if (divider) divider.hidden = false;
    if (otp) otp.hidden = true;
    pendingChallengeId = null;
    pendingPhone = null;
    if ($("#otpCode")) $("#otpCode").value = "";
    setMode(currentMode === "create" ? "signin" : "create");
  });
  $("#sendOtp")?.addEventListener("click", sendOtp);
  $("#verifyOtp")?.addEventListener("click", verifyOtp);
  $("#phone")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (!busy) sendOtp();
    }
  });
  $("#otpCode")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (!busy) verifyOtp();
    }
  });
  $("#cancelAuth")?.addEventListener("click", () => {
    activeCredentialAbort?.abort();
    hideSheet();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const biometricStage = $("#biometricAuthStage");
    if (biometricStage && !biometricStage.hidden) {
      activeCredentialAbort?.abort();
      showBiometricStage(null);
      return;
    }
    if (sheet && !sheet.hidden) {
      activeCredentialAbort?.abort();
      hideSheet();
    }
  });

  if (document.body.dataset.page === "launch") {
    window.setTimeout(() => window.location.replace("/"), 720);
  } else if (document.body.dataset.page === "account") {
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
    const params = new URLSearchParams(window.location.search);
    const signedOut = params.get("reason") === "signed-out";
    const isWelcomeOverlay = Boolean(document.querySelector(".entry-overlay"));
    const requestedMode = params.get("mode");
    setMode(isWelcomeOverlay && !signedOut && requestedMode !== "signin" ? "create" : "signin");
    if (signedOut) say("You have signed out securely.", "success");
  }
})();