(() => {
  "use strict";

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

  // Keep invisible install targets aligned with the reference artwork after every resize.
  const artboard = document.querySelector(".artboard");
  const referenceImage = document.querySelector(".reference-art");
  const alignInstallHotspots = () => {
    if (!artboard || !referenceImage || !iosButton || !androidButton) return;
    const isMobileArtwork = window.matchMedia("(max-width: 767px)").matches;
    const sourceWidth = referenceImage.naturalWidth || (isMobileArtwork ? 864 : 1536);
    const sourceHeight = referenceImage.naturalHeight || (isMobileArtwork ? 1536 : 864);
    const bounds = artboard.getBoundingClientRect();
    const scale = Math.max(bounds.width / sourceWidth, bounds.height / sourceHeight);
    const cropX = (bounds.width - sourceWidth * scale) / 2;
    const cropY = (bounds.height - sourceHeight * scale) / 2;
    const boxes = isMobileArtwork
      ? [
          { element: iosButton, x: 80, y: 1088, width: 704, height: 156 },
          { element: androidButton, x: 80, y: 1258, width: 704, height: 158 },
        ]
      : [
          { element: iosButton, x: 126, y: 485, width: 286, height: 130 },
          { element: androidButton, x: 429, y: 485, width: 309, height: 130 },
        ];
    for (const box of boxes) {
      box.element.style.left = (cropX + box.x * scale) + "px";
      box.element.style.top = (cropY + box.y * scale) + "px";
      box.element.style.width = (box.width * scale) + "px";
      box.element.style.height = (box.height * scale) + "px";
    }
  };
  if (referenceImage) {
    referenceImage.addEventListener("load", alignInstallHotspots);
    window.addEventListener("resize", alignInstallHotspots, { passive: true });
    alignInstallHotspots();
  }

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
