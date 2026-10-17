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


/* Post-auth onboarding: account-created confirmation -> camera slider. */
(() => {
  "use strict";
  const overlay = document.querySelector("#postAuthOnboarding");
  if (!overlay) return;

  const successStage = document.querySelector("#postAuthAccountCreated");
  const slideStage = document.querySelector("#postAuthSlideStage");
  const getStarted = document.querySelector("#onboardingGetStarted");
  const sliderSlot = document.querySelector("#onboardingSliderSlot");
  const slider = document.querySelector("#showProblemButton");
  if (!successStage || !slideStage || !getStarted || !sliderSlot || !slider) return;

  overlay.hidden = false;
  const originalParent = slider.parentNode;
  const originalNextSibling = slider.nextSibling;
  const label = slider.querySelector("#visionSlideLabel");
  const screenReaderLabel = slider.querySelector(".sr-only");
  let completionObserver = null;
  let closeTimer = null;

  const setSliderCopy = () => {
    if (!label || slideStage.hidden) return;
    if (slider.classList.contains("is-complete")) {
      label.textContent = "Connecting…";
    } else if (slider.classList.contains("is-sliding") && Number(slider.dataset.progress || 0) >= 0.82) {
      label.textContent = "Release to start";
    } else {
      label.textContent = "Slide to show your problem";
    }
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

  const restoreSliderAndClose = () => {
    if (closeTimer) window.clearTimeout(closeTimer);
    completionObserver?.disconnect();
    completionObserver = null;
    if (originalParent && slider.parentNode !== originalParent) {
      if (originalNextSibling && originalNextSibling.parentNode === originalParent) originalParent.insertBefore(slider, originalNextSibling);
      else originalParent.appendChild(slider);
    }
    overlay.hidden = true;
    document.body.classList.remove("post-auth-onboarding-active");
  };

  const observeSliderCompletion = () => {
    completionObserver?.disconnect();
    completionObserver = new MutationObserver(() => {
      if (!slider.classList.contains("is-complete")) {
        setSliderCopy();
        return;
      }
      if (closeTimer) return;
      // Let the camera session begin under the frosted screen, then reveal the live camera.
      closeTimer = window.setTimeout(restoreSliderAndClose, 220);
    });
    completionObserver.observe(slider, { attributes: true, attributeFilter: ["class"] });
  };

  getStarted.addEventListener("click", () => {
    successStage.hidden = true;
    slideStage.hidden = false;
    document.body.classList.add("post-auth-onboarding-active");
    removeOnboardingFromAddress();
    sliderSlot.appendChild(slider);
    slider.dataset.progress = "0";
    slider.style.setProperty("--slide-distance", "0px");
    slider.classList.remove("is-sliding", "is-complete");
    setSliderCopy();
    observeSliderCompletion();
    slider.focus({ preventScroll: true });
  });

  const labelObserver = new MutationObserver(() => {
    if (slideStage.hidden || slider.classList.contains("is-complete")) return;
    // The shared camera slider resets its default label after a partial gesture.
    if (label && label.textContent === "Slide to start") setSliderCopy();
  });
  if (label) labelObserver.observe(label, { childList: true, characterData: true, subtree: true });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !slideStage.hidden && !overlay.hidden && !slider.classList.contains("is-complete")) {
      // Escape must not bypass the required "show your problem" slide.
      event.preventDefault();
    }
  });
})();
