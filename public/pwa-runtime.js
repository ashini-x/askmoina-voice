(() => {
  "use strict";

  // Track the browser's actually visible viewport. On Android, 100dvh can
  // briefly include area behind a transitioning browser toolbar; using
  // VisualViewport avoids the black strip and keeps the portrait artwork flush.
  const syncInstallViewport = () => {
    const visual = window.visualViewport;
    const width = Math.max(1, visual?.width || document.documentElement.clientWidth || window.innerWidth);
    const height = Math.max(1, visual?.height || document.documentElement.clientHeight || window.innerHeight);
    const left = visual?.offsetLeft || 0;
    const top = visual?.offsetTop || 0;
    document.documentElement.style.setProperty("--install-viewport-width", width + "px");
    document.documentElement.style.setProperty("--install-viewport-height", height + "px");
    document.documentElement.style.setProperty("--install-viewport-left", left + "px");
    document.documentElement.style.setProperty("--install-viewport-top", top + "px");
    document.documentElement.style.setProperty("--install-artboard-width", (height * 9 / 16) + "px");
  };
  let viewportSyncScheduled = false;
  const scheduleInstallViewportSync = () => {
    if (viewportSyncScheduled) return;
    viewportSyncScheduled = true;
    window.requestAnimationFrame(() => {
      viewportSyncScheduled = false;
      syncInstallViewport();
    });
  };
  syncInstallViewport();
  window.addEventListener("resize", scheduleInstallViewportSync, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", scheduleInstallViewportSync, { passive: true });
    window.visualViewport.addEventListener("scroll", scheduleInstallViewportSync, { passive: true });
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("/service-worker.js", { scope: "/", updateViaCache: "none" })
        .then((registration) => registration.update().catch(() => {}))
        .catch(() => {
          // AskMoina remains available in the browser without a service worker.
        });
    }, { once: true });
  }

  let installPrompt = null;
  const iosButton = document.getElementById("install-ios-button");
  const androidButton = document.getElementById("install-android-button");
  const installStatus = document.getElementById("install-status");
  const installHelp = document.getElementById("install-help");
  const helpTitle = document.getElementById("install-help-title");
  const helpCopy = document.getElementById("install-help-copy");
  const helpSteps = document.getElementById("install-help-steps");
  const closeHelp = document.getElementById("close-install-help");

  // The fixed-ratio artboard and clickable card hit areas are positioned entirely in CSS.
  // This keeps first paint fast and avoids resize-time layout work.

  const showHelp = (platform) => {
    if (!installHelp || !helpTitle || !helpCopy || !helpSteps) return;
    const isIOS = platform === "ios";
    helpTitle.textContent = isIOS ? "Add askmoina to your iPhone" : "Install askmoina on Android";
    helpCopy.textContent = isIOS
      ? "Open this page in Safari to add askmoina to your Home Screen."
      : "Use the installation option provided by your browser to keep askmoina close at hand.";
    helpSteps.textContent = isIOS
      ? "Tap Share, choose Add to Home Screen, turn on Open as Web App if shown, then tap Add."
      : "In Chrome, open the browser menu and choose Install app or Add to Home screen. If an install icon appears in the address bar, you can use that instead.";
    installHelp.hidden = false;
    if (installStatus) installStatus.hidden = true;
    // The install page is a fixed viewport canvas; keep the guidance in place without scrolling.
  };

  const setStatus = (message) => {
    if (!installStatus) return;
    installStatus.textContent = message;
    installStatus.hidden = false;
  };

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    if (androidButton) androidButton.classList.add("is-installable");
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    if (installHelp) installHelp.hidden = true;
    setStatus("askmoina has been installed on this device.");
  });

  if (iosButton) iosButton.addEventListener("click", () => showHelp("ios"));

  if (androidButton) {
    androidButton.addEventListener("click", async () => {
      if (!installPrompt) {
        showHelp("android");
        return;
      }
      const promptEvent = installPrompt;
      installPrompt = null;
      try {
        await promptEvent.prompt();
        const choice = await promptEvent.userChoice;
        if (choice && choice.outcome === "accepted") {
          if (installHelp) installHelp.hidden = true;
          setStatus("askmoina is being installed on your device.");
        } else {
          showHelp("android");
        }
      } catch {
        showHelp("android");
      }
    });
  }

  if (closeHelp) {
    closeHelp.addEventListener("click", () => {
      if (installHelp) installHelp.hidden = true;
    });
  }
})();
