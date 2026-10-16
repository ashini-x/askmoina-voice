(() => {
  "use strict";

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("/service-worker.js", {
          scope: "/",
          updateViaCache: "none"
        })
        .then((registration) => registration.update().catch(() => {}))
        .catch(() => {
          // AskMoina remains online-capable without a service worker.
        });
    }, { once: true });
  }

  let installPrompt = null;
  const installButton = document.getElementById("install-button");
  const installStatus = document.getElementById("install-status");
  const installHelp = document.getElementById("install-help");

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    if (installButton) installButton.textContent = "Install AskMoina";
    if (installStatus) installStatus.textContent = "AskMoina is ready to install on this device.";
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    if (installButton) installButton.hidden = true;
    if (installStatus) installStatus.textContent = "AskMoina was added to this device.";
  });

  if (installButton) {
    installButton.addEventListener("click", async () => {
      if (installPrompt) {
        const promptEvent = installPrompt;
        installPrompt = null;
        try {
          await promptEvent.prompt();
          const choice = await promptEvent.userChoice;
          if (installStatus) {
            installStatus.textContent = choice && choice.outcome === "accepted"
              ? "AskMoina is being added to your device."
              : "Installation was not completed. You can try again from your browser menu.";
          }
        } catch {
          if (installStatus) installStatus.textContent = "Open your browser menu to install AskMoina.";
        }
        return;
      }

      if (installHelp) {
        installHelp.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      if (installStatus) {
        installStatus.textContent = isIOS
          ? "In Safari, tap Share, choose Add to Home Screen, enable Open as Web App if shown, then tap Add."
          : "Use your browser menu or address-bar install option. Installation availability depends on your browser.";
      }
    });
  }
})();
