(() => {
  "use strict";
  const overlay = document.querySelector("#postAuthOnboarding");
  const availableCard = document.querySelector("#experienceMoinaOS1");
  const previewCard = document.querySelector("#experienceMoinaOS2");
  const previewNotice = document.querySelector("#experiencePreviewNotice");
  const cameraApp = document.querySelector(".camera-app");
  if (!overlay || !availableCard || !previewCard) return;

  document.body.classList.add("experience-selection-open");

  if (cameraApp) {
    cameraApp.setAttribute("aria-hidden", "true");
    cameraApp.inert = true;
  }

  let previewNoticeTimer = 0;

  const engine = () => window.__askmoinaFluidMotion;
  const selectionItems = () => [
    overlay.querySelector(".experience-selection-eyebrow"),
    availableCard,
    previewCard
  ].filter(el => el instanceof HTMLElement);

  function animateSelectionArrival(initial = false) {
    const motion = engine();
    if (!motion || overlay.hidden) return;
    const items = selectionItems();
    items.forEach((el, index) => {
      const opts = initial
        ? { from: { y: 14 + index * 4, opacity: 0 }, persistTarget: true }
        : { persistTarget: true };
      motion.animate(el, { y: 0, opacity: 1 }, motion.profiles.expand, opts);
    });
  }

  function showExperienceSelection() {
    overlay.hidden = false;
    overlay.classList.remove("is-leaving");
    overlay.style.opacity = "";
    overlay.style.translate = "";
    overlay.style.scale = "";
    document.body.classList.add("experience-selection-open");
    if (previewNoticeTimer) window.clearTimeout(previewNoticeTimer);
    previewNoticeTimer = 0;
    if (previewNotice) previewNotice.hidden = true;
    if (cameraApp) {
      cameraApp.setAttribute("aria-hidden", "true");
      cameraApp.inert = true;
      cameraApp.style.zIndex = "";
    }
    const motion = engine();
    if (motion) {
      motion.animate(overlay, { opacity: 1 }, motion.profiles.sheet, { from: { opacity: 0.01 }, persistTarget: true });
      animateSelectionArrival(false);
    }
    availableCard.focus({ preventScroll: true });
  }

  window.addEventListener("askmoina:user-disconnected", showExperienceSelection);

  previewCard.addEventListener("click", () => {
    if (!previewNotice) return;
    previewNotice.hidden = false;
    if (previewNoticeTimer) window.clearTimeout(previewNoticeTimer);
    previewNoticeTimer = window.setTimeout(() => {
      previewNotice.hidden = true;
      previewNoticeTimer = 0;
    }, 2400);
  });

  if (document.readyState === "complete") animateSelectionArrival(true);
  else window.addEventListener("load", () => animateSelectionArrival(true), { once: true });

  let leaving = false;
  let originalCameraZIndex = cameraApp instanceof HTMLElement ? cameraApp.style.zIndex : "";
  availableCard.addEventListener("click", () => {
    if (leaving) return;
    leaving = true;
    const finishSelection = () => {
      overlay.hidden = true;
      overlay.classList.remove("is-leaving");
      overlay.style.opacity = "";
      overlay.style.translate = "";
      overlay.style.scale = "";
      document.body.classList.remove("experience-selection-open");
      if (cameraApp) {
        cameraApp.removeAttribute("aria-hidden");
        cameraApp.inert = false;
        cameraApp.style.zIndex = originalCameraZIndex;
      }
      if (cameraStart instanceof HTMLElement) cameraStart.focus({ preventScroll: true });
      window.dispatchEvent(new Event("askmoina:experience-selected"));
      leaving = false;
    };
    const motion = engine();
    if (!motion) { finishSelection(); return; }

    const sourceRect = availableCard.getBoundingClientRect();
    if (cameraApp instanceof HTMLElement) {
      originalCameraZIndex = cameraApp.style.zIndex;
      cameraApp.removeAttribute("aria-hidden");
      cameraApp.inert = false;
      cameraApp.style.zIndex = "100000";
      motion.flip(cameraApp, sourceRect, motion.profiles.expand, { onComplete: finishSelection });
      motion.animate(overlay, { opacity: 0 }, motion.profiles.exit, { persistTarget: true });
    } else {
      motion.animate(overlay, { y: -12, opacity: 0 }, motion.profiles.exit, { onComplete: finishSelection });
    }
  });
