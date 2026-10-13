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
  // A globally consistent illustrative demo counter, not a real donation ledger.
  // Keep this launch epoch stable across deployments so the display never resets.
  const donationCounter = document.querySelector("[data-donation-counter]");
  if (donationCounter) {
    const baseAmount = 109000;
    const startAt = Date.UTC(2026, 9, 13, 4, 0, 0);
    const randomUnit = (index, salt) => {
      let value = Math.imul(index + salt, 0x45d9f3b);
      value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
      value ^= value >>> 16;
      return (value >>> 0) / 4294967296;
    };
    const intervalFor = (index) => (2.5 + randomUnit(index, 17) * 2.5) * 60 * 60 * 1000;
    const incrementFor = (index) => 10 + Math.floor(randomUnit(index, 93) * 91);
    const formatAmount = (amount) => amount >= 100000
      ? "₹" + (amount / 100000).toFixed(2) + "L"
      : "₹" + new Intl.NumberFormat("en-IN").format(amount);
    const updateDonationCounter = () => {
      const now = Date.now();
      let total = baseAmount;
      let nextAt = startAt;
      let index = 0;
      while (index < 100000) {
        const incrementAt = nextAt + intervalFor(index);
        if (incrementAt > now) { nextAt = incrementAt; break; }
        total += incrementFor(index);
        nextAt = incrementAt;
        index += 1;
      }
      donationCounter.textContent = formatAmount(total);
      window.setTimeout(updateDonationCounter, Math.max(1000, Math.min(2147483647, nextAt - Date.now() + 50)));
    };
    updateDonationCounter();
  }
})();