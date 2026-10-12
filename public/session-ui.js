(() => {
  "use strict";
  const buttons = Array.from(document.querySelectorAll("[data-logout]"));
  let signingOut = false;
  for (const button of buttons) {
    button.addEventListener("click", async () => {
      if (signingOut) return;
      signingOut = true;
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      button.setAttribute("aria-label", "Signing out");
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
        button.setAttribute("aria-label", "Sign out");
        const status = document.querySelector("#status");
        if (status) { status.textContent = "Could not sign out securely. Check your connection and try again."; }
        else window.alert("Could not sign out securely. Check your connection and try again.");
      }
    });
  }
  const captions = document.querySelector("#toggleHomeCaptions");
  const panel = document.querySelector("#conversationPanel");
  if (captions && panel) captions.addEventListener("click", () => {
    const shown = !panel.classList.contains("is-visible");
    panel.classList.toggle("is-visible", shown);
    captions.setAttribute("aria-expanded", String(shown));
    captions.setAttribute("aria-label", shown ? "Hide captions" : "Show captions");
    panel.setAttribute("aria-hidden", String(!shown));
  });
})();