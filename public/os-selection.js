(() => {
  "use strict";
  const selector = document.querySelector("#osModelPicker");
  const tryButton = document.querySelector("#tryMoinaOS1");
  const conversation = document.querySelector(".conversation");
  const composer = document.querySelector(".composer-wrap");
  const listenButton = document.querySelector("#toggleVoice");
  if (!selector || !tryButton || !conversation || !composer) return;

  tryButton.addEventListener("click", () => {
    selector.hidden = true;
    conversation.hidden = false;
    composer.hidden = false;
    document.body.classList.add("moinaos-1-selected");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    composer.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "end" });
    if (listenButton && !listenButton.disabled) listenButton.focus({ preventScroll: true });
  });
})();
