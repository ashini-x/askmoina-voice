(() => {
  "use strict";

  const root = document.documentElement;
  let standalone = false;

  try {
    standalone =
      (typeof window.matchMedia === "function" &&
        window.matchMedia("(display-mode: standalone)").matches) ||
      window.navigator.standalone === true;
  } catch {
    standalone = window.navigator.standalone === true;
  }

  if (standalone) {
    root.removeAttribute("data-askmoina-pwa-gate");
    return;
  }

  // Deliberately do not trust ?source=pwa: a URL parameter is not proof that
  // the page was launched from an installed standalone app.
  window.location.replace("/install.html");
})();
