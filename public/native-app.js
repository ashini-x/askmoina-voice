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
