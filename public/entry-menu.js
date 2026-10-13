(() => {
  "use strict";
  const menus = Array.from(document.querySelectorAll(".entry-site-menu"));
  for (const menu of menus) {
    const summary = menu.querySelector("summary");
    if (!summary) continue;
    const syncLabel = () => summary.setAttribute("aria-label", menu.open ? "Close navigation menu" : "Open navigation menu");
    menu.addEventListener("toggle", syncLabel);
    syncLabel();
    document.addEventListener("pointerdown", (event) => { if (menu.open && !menu.contains(event.target)) menu.open = false; });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && menu.open) { menu.open = false; summary.focus(); }
    });
    menu.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => { menu.open = false; }));
    const logout = menu.querySelector(".entry-menu-logout");
    if (logout) {
      logout.addEventListener("click", async () => {
        logout.disabled = true;
        try {
          const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}" });
          if (!response.ok) throw new Error("Could not sign out");
        } catch (_) { logout.disabled = false; return; }
        window.location.replace("/?reason=signed-out");
      });
    }
  }
})();