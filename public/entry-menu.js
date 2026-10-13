(() => {
  "use strict";
  const menus = Array.from(document.querySelectorAll(".entry-site-menu"));
  for (const menu of menus) {
    const summary = menu.querySelector("summary");
    if (!summary) continue;
    const syncLabel = () => {
      summary.setAttribute("aria-label", menu.open ? "Close navigation menu" : "Open navigation menu");
    };
    menu.addEventListener("toggle", syncLabel);
    syncLabel();
    document.addEventListener("pointerdown", (event) => {
      if (menu.open && !menu.contains(event.target)) menu.open = false;
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && menu.open) {
        menu.open = false;
        summary.focus();
      }
    });
    menu.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => { menu.open = false; });
    });
  }
})();