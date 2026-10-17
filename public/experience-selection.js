(() => {
  "use strict";

  const overlay = document.querySelector("#postAuthOnboarding");
  const availableCard = document.querySelector("#experienceMoinaOS1");
  const previewCard = document.querySelector("#experienceMoinaOS2");
  const previewNotice = document.querySelector("#experiencePreviewNotice");
  const cameraApp = document.querySelector(".camera-app");
  const cameraStart = document.querySelector("#showProblemButton");
  if (!overlay || !availableCard || !previewCard) return;

  document.body.classList.add("experience-selection-open");
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
    };
    if (reducedMotion) finishSelection();
    else window.setTimeout(finishSelection, 160);
  });
})();
