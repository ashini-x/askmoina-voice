(() => {
  "use strict";
  const opener = document.querySelector("#openAppMenu");
  const sheet = document.querySelector("#nativeMenuSheet");
  const scrim = document.querySelector("#nativeMenuScrim");
  const closer = document.querySelector("#nativeMenuClose");
  if (!opener || !sheet) return;
  let returnFocus = null;
  const open = () => {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : opener;
    sheet.hidden = false;
    sheet.setAttribute("aria-hidden", "false");
    opener.setAttribute("aria-expanded", "true");
    document.body.classList.add("native-menu-open");
    closer?.focus({ preventScroll: true });
  };
  const close = () => {
    sheet.hidden = true;
    sheet.setAttribute("aria-hidden", "true");
    opener.setAttribute("aria-expanded", "false");
    document.body.classList.remove("native-menu-open");
    if (returnFocus instanceof HTMLElement) returnFocus.focus({ preventScroll: true });
  };
  opener.setAttribute("aria-haspopup", "dialog");
  opener.setAttribute("aria-expanded", "false");
  opener.addEventListener("click", open);
  scrim?.addEventListener("click", close);
  closer?.addEventListener("click", close);
  sheet.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => {
    opener.setAttribute("aria-expanded", "false");
  }));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !sheet.hidden) close();
    if (event.key === "Tab" && !sheet.hidden) {
      const focusable = Array.from(sheet.querySelectorAll('a[href], button:not([disabled])')).filter((el) => el instanceof HTMLElement);
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
})();



/* Post-auth onboarding: assistant selection -> moinaOS 1 details -> camera slider. */
(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const overlay = $("#postAuthOnboarding");
  const selectionStage = $("#assistantSelectionStage");
  const detailsStage = $("#moinaOS1DetailsStage");
  const slideStage = $("#postAuthSlideStage");
  const chooseMoinaOS1 = $("#selectMoinaOS1");
  const chooseMoinaOS2 = $("#selectMoinaOS2");
  const moinaOS2Notice = $("#moinaOS2Notice");
  const detailsBack = $("#assistantDetailsBack");
  const startMoinaOS1 = $("#startMoinaOS1");
  const sliderSlot = $("#onboardingSliderSlot");
  const slider = $("#showProblemButton");
  const nameNode = $("#assistantSelectionFirstName");
  if (!overlay || !selectionStage || !detailsStage || !slideStage || !chooseMoinaOS1 ||
      !chooseMoinaOS2 || !detailsBack || !startMoinaOS1 || !sliderSlot || !slider) return;

  const isAssistantSelectionJourney = new URLSearchParams(window.location.search).get("onboarding") === "1";
  const originalParent = slider.parentNode;
  const originalNextSibling = slider.nextSibling;
  const label = slider.querySelector("#visionSlideLabel");
  const screenReaderLabel = slider.querySelector(".sr-only");
  let completionObserver = null;
  let closeTimer = null;
  let releaseNoticeTimer = null;

  const loadSignedInName = async () => {
    if (!nameNode) return;
    try {
      const response = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
      if (!response.ok) return;
      const data = await response.json();
      const possibleName = [data.firstName, data.displayName, data.name]
        .find((value) => typeof value === "string" && value.trim().length > 0);
      if (possibleName) nameNode.textContent = possibleName.trim().split(/\s+/)[0];
    } catch (_) {
      // Keep the reference-friendly Newton fallback when a profile name is not available.
    }
  };

  const setSliderCopy = () => {
    if (!label || slideStage.hidden) return;
    if (slider.classList.contains("is-complete")) label.textContent = "Connecting…";
    else if (slider.classList.contains("is-sliding") && Number(slider.dataset.progress || 0) >= 0.82) label.textContent = "Release to start";
    else label.textContent = "Slide to show your problem";
    slider.setAttribute("aria-label", "Slide to show your problem");
    slider.title = "Slide to show your problem";
    if (screenReaderLabel) screenReaderLabel.textContent = "Slide to show your problem. Slide the control to the right to begin camera guidance.";
  };

  const removeOnboardingFromAddress = () => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("onboarding");
      url.searchParams.delete("launch");
      history.replaceState(history.state, "", url.pathname + url.search + url.hash);
    } catch (_) {}
  };

  const resetSlider = () => {
    slider.dataset.progress = "0";
    slider.style.setProperty("--slide-distance", "0px");
    slider.classList.remove("is-sliding", "is-complete");
  };

  const restoreSliderAndClose = () => {
    if (closeTimer) window.clearTimeout(closeTimer);
    closeTimer = null;
    completionObserver?.disconnect();
    completionObserver = null;
    if (originalParent && slider.parentNode !== originalParent) {
      if (originalNextSibling && originalNextSibling.parentNode === originalParent) originalParent.insertBefore(slider, originalNextSibling);
      else originalParent.appendChild(slider);
    }
    overlay.hidden = true;
    overlay.classList.remove("is-slide-mode");
    document.body.classList.remove("post-auth-onboarding-active");
  };

  const showSelectionStage = (focusCard = true) => {
    if (closeTimer) window.clearTimeout(closeTimer);
    closeTimer = null;
    completionObserver?.disconnect();
    completionObserver = null;
    selectionStage.hidden = false;
    detailsStage.hidden = true;
    slideStage.hidden = true;
    overlay.hidden = false;
    overlay.classList.remove("is-slide-mode");
    document.body.classList.add("post-auth-onboarding-active");
    if (focusCard) chooseMoinaOS1.focus({ preventScroll: true });
  };

  const showDetailsStage = () => {
    if (releaseNoticeTimer) window.clearTimeout(releaseNoticeTimer);
    if (moinaOS2Notice) moinaOS2Notice.hidden = true;
    selectionStage.hidden = true;
    detailsStage.hidden = false;
    slideStage.hidden = true;
    overlay.hidden = false;
    overlay.classList.remove("is-slide-mode");
    document.body.classList.add("post-auth-onboarding-active");
    startMoinaOS1.focus({ preventScroll: true });
  };

  const observeSliderCompletion = () => {
    completionObserver?.disconnect();
    completionObserver = new MutationObserver(() => {
      if (!slider.classList.contains("is-complete")) {
        setSliderCopy();
        return;
      }
      if (closeTimer) return;
      // Keep the slide visible while the real Live session opens, then reveal the camera.
      closeTimer = window.setTimeout(restoreSliderAndClose, 220);
    });
    completionObserver.observe(slider, { attributes: true, attributeFilter: ["class"] });
  };

  const showSlideStage = (focusSlider = true) => {
    if (closeTimer) window.clearTimeout(closeTimer);
    closeTimer = null;
    completionObserver?.disconnect();
    completionObserver = null;
    selectionStage.hidden = true;
    detailsStage.hidden = true;
    slideStage.hidden = false;
    overlay.hidden = false;
    overlay.classList.add("is-slide-mode");
    document.body.classList.add("post-auth-onboarding-active");
    removeOnboardingFromAddress();
    if (slider.parentNode !== sliderSlot) sliderSlot.appendChild(slider);
    resetSlider();
    setSliderCopy();
    observeSliderCompletion();
    if (focusSlider) slider.focus({ preventScroll: true });
  };

  chooseMoinaOS1.addEventListener("click", showDetailsStage);
  chooseMoinaOS2.addEventListener("click", () => {
    if (!moinaOS2Notice) return;
    moinaOS2Notice.hidden = false;
    if (releaseNoticeTimer) window.clearTimeout(releaseNoticeTimer);
    releaseNoticeTimer = window.setTimeout(() => { moinaOS2Notice.hidden = true; }, 3600);
  });
  detailsBack.addEventListener("click", () => showSelectionStage(true));
  startMoinaOS1.addEventListener("click", () => showSlideStage(true));
  document.addEventListener("askmoina:user-disconnected", () => showSlideStage(true));

  const labelObserver = new MutationObserver(() => {
    if (slideStage.hidden || slider.classList.contains("is-complete")) return;
    if (label && label.textContent === "Slide to start") setSliderCopy();
  });
  if (label) labelObserver.observe(label, { childList: true, characterData: true, subtree: true });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !overlay.hidden) {
      if (!detailsStage.hidden) {
        event.preventDefault();
        showSelectionStage(true);
      } else if (!selectionStage.hidden) {
        event.preventDefault();
      } else if (!slideStage.hidden && !slider.classList.contains("is-complete")) {
        event.preventDefault();
      }
    }
  });

  if (isAssistantSelectionJourney) {
    selectionStage.hidden = false;
    detailsStage.hidden = true;
    slideStage.hidden = true;
    overlay.classList.remove("is-slide-mode");
    overlay.hidden = false;
    document.body.classList.add("post-auth-onboarding-active");
    void loadSignedInName();
  } else {
    showSlideStage(false);
  }
})();
