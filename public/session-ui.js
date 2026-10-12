(() => {
  "use strict";
  const buttons = Array.from(document.querySelectorAll("[data-logout]"));
  if (!buttons.length) return;
  let signingOut = false;
  for (const button of buttons) {
    button.addEventListener("click", async () => {
      if (signingOut) return;
      signingOut = true;
      const original = button.textContent || "Sign out";
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      button.textContent = "Signing out…";
      try {
        const response = await fetch("/api/auth/logout", {
          method: "POST", credentials: "same-origin", cache: "no-store",
          headers: { Accept: "application/json" }
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.ok !== true) throw new Error("Sign out was not confirmed.");
        window.location.replace("/login?reason=signed-out");
      } catch (_) {
        signingOut = false;
        button.disabled = false;
        button.removeAttribute("aria-busy");
        button.textContent = original;
        const status = document.querySelector("#status");
        if (status) { status.textContent = "Could not sign out securely. Check your connection and try again."; status.classList.add("error"); }
        else window.alert("Could not sign out securely. Check your connection and try again.");
      }
    });
  }
})();