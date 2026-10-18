(() => {
  "use strict";
  const overlay = document.querySelector("#postAuthOnboarding");
  const availableCard = document.querySelector("#experienceMoinaOS1");
  const previewCard = document.querySelector("#experienceMoinaOS2");
  const previewNotice = document.querySelector("#experiencePreviewNotice");
  const cameraApp = document.querySelector(".camera-app");
  const cameraStart = document.querySelector("#showProblemButton");
  const startupOverlay = document.querySelector("#moinaOSStartupOverlay");
  const startupScroll = overlay && overlay.querySelector(".experience-selection-scroll");
  const startupTitle = document.querySelector("#moinaOSStartupTitle");
  const startupMessage = document.querySelector("#moinaOSStartupMessage");
  const startupContinue = document.querySelector("#moinaOSStartupContinue");
  if (!overlay || !availableCard || !previewCard) return;

  document.body.classList.add("experience-selection-open");

  let startupFallbackTimer = 0;
  let startupDismissTimer = 0;

  function dismissStartupOverlay() {
    if (!startupOverlay || startupOverlay.hidden) return;
    if (startupFallbackTimer) window.clearTimeout(startupFallbackTimer);
    if (startupDismissTimer) window.clearTimeout(startupDismissTimer);
    const finish = () => {
      startupOverlay.hidden = true;
      startupOverlay.classList.remove("is-dismissing", "is-delayed");
      overlay.classList.remove("is-startup-pending");
      if (startupScroll) {
        startupScroll.inert = false;
        startupScroll.removeAttribute("aria-hidden");
      }
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finish();
    } else {
      startupOverlay.classList.add("is-dismissing");
      window.setTimeout(finish, 170);
    }
  }

  function finishStartupWhenReady() {
    if (!startupOverlay || startupOverlay.hidden) return;
    // Dismiss as soon as the browser finishes loading; do not impose a minimum wait.
    startupDismissTimer = window.setTimeout(dismissStartupOverlay, 0);
  }

  const startupRequested = new URLSearchParams(window.location.search).get("startup") === "1";
  if (startupRequested && startupOverlay) {
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete("startup");
    window.history.replaceState(window.history.state, "", cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
    startupOverlay.hidden = false;
    overlay.classList.add("is-startup-pending");
    if (startupScroll) {
      startupScroll.inert = true;
      startupScroll.setAttribute("aria-hidden", "true");
    }
    startupContinue?.addEventListener("click", (event) => {
      event.preventDefault();
      dismissStartupOverlay();
    });
    startupFallbackTimer = window.setTimeout(() => {
      if (!startupOverlay.hidden) {
        if (startupTitle) startupTitle.textContent = "Taking a little longer";
        if (startupMessage) startupMessage.textContent = "You can continue while the network catches up.";
        startupOverlay.classList.add("is-delayed");
      }
    }, 10000);
    if (document.readyState === "complete") finishStartupWhenReady();
    else window.addEventListener("load", finishStartupWhenReady, { once: true });
  }
  if (cameraApp) {
    cameraApp.setAttribute("aria-hidden", "true");
    cameraApp.inert = true;
  }

  let previewNoticeTimer = 0;
  previewCard.addEventListener("click", () => {
    if (!previewNotice) return;
    previewNotice.hidden = false;
    if (previewNoticeTimer) window.clearTimeout(previewNoticeTimer);
    previewNoticeTimer = window.setTimeout(() => {
      previewNotice.hidden = true;
      previewNoticeTimer = 0;
    }, 2400);
  });

  availableCard.addEventListener("click", () => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    overlay.classList.add("is-leaving");
    const finishSelection = () => {
      overlay.hidden = true;
      overlay.classList.remove("is-leaving");
      document.body.classList.remove("experience-selection-open");
      if (cameraApp) {
        cameraApp.removeAttribute("aria-hidden");
        cameraApp.inert = false;
      }
      if (cameraStart instanceof HTMLElement) cameraStart.focus({ preventScroll: true });
      window.dispatchEvent(new Event("askmoina:experience-selected"));
    };
    if (reducedMotion) finishSelection();
    else window.setTimeout(finishSelection, 160);
  });
})();
