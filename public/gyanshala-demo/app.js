(() => {
  "use strict";
  const API = "/api/gyanshala";
  const APP = "/gyanshala-demo/";
  const root = document.getElementById("app");
  const state = { screen: "splash", mode: "signup", email: "", phone: "", challengeId: "", smsSent: false, user: null, setup: null, message: "", messageType: "info", busy: false, installPrompt: null };
  const esc = (value) => String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const logo = '<img src="/gyanshala-demo/icon.svg" alt="" width="36" height="36">';
  function button(label, action, cls, type) {
    return '<button class="btn ' + (cls || "btn-primary") + '" ' + (type ? 'type="' + type + '"' : 'type="button"') + ' data-action="' + esc(action || "") + '">' + label + '</button>';
  }
  function messageBox() {
    if (!state.message) return "";
    return '<div class="message visible ' + esc(state.messageType) + '" role="status" aria-live="polite">' + esc(state.message) + '</div>';
  }
  function setupBox() {
    const s = state.setup;
    if (!s || s.signupReady) return "";
    const labels = [
      ["databaseBinding", "Create and bind Gyanshala D1 database"],
      ["databaseSchema", "Apply the Gyanshala database schema"],
      ["emailProvider", "Connect Resend email verification"],
      ["phoneProvider", "Connect Twilio Verify SMS"],
      ["collegeDomainAllowlist", "Set approved college email domains"],
      ["otpSecret", "Add Gyanshala OTP/session secret"]
    ];
    const missing = labels.filter(x => !s.setup[x[0]]).map(x => "<li>" + esc(x[1]) + "</li>").join("");
    return '<div class="setup-panel"><div class="setup-title"><span class="setup-pill"></span>Student verification setup</div><p>Signup will open when the account and delivery services are configured. This check never exposes API keys.</p>' + (missing ? '<ul>' + missing + '</ul>' : "") + '</div>';
  }
  function shell(content) {
    const link = state.screen === "splash" || state.screen === "onboarding" || state.screen === "signup"
      ? '<button class="header-link" data-action="signin">Already a member? Sign in</button>'
      : (state.screen === "signin" ? '<button class="header-link" data-action="signup">Create account</button>' : "");
    root.innerHTML = '<header class="topbar"><a class="brand" href="/gyanshala-demo/" data-action="home">' + logo + '<span>Gyanshala<small>Campus, together</small></span></a>' + link + '</header><main>' + content + '</main><footer class="footer"><span><b>Gyanshala</b> · Find it. Share it.</span><span>Student access · Private by design</span></footer>';
    root.querySelectorAll("form").forEach((form) => form.addEventListener("submit", onSubmit));
  }
  function dots(active) {
    return '<div class="step-dots" aria-label="Setup step ' + active + ' of 4">' + [1,2,3,4].map(n => '<span class="' + (n <= active ? "active" : "") + '"></span>').join("") + '</div>';
  }
  function field(label, name, type, placeholder, value, note, required) {
    return '<label class="field"><span>' + esc(label) + '</span><input name="' + esc(name) + '" type="' + esc(type || "text") + '" placeholder="' + esc(placeholder || "") + '" value="' + esc(value || "") + '"' + (required === false ? "" : " required") + ' autocomplete="' + esc(name === "email" ? "email" : name === "phone" ? "tel" : name === "fullName" ? "name" : "off") + '">' + (note ? '<small>' + esc(note) + '</small>' : "") + '</label>';
  }
  function splash() {
    const art = '<div class="hero-art"><div class="orbit-card"><div class="orbit-mark"><svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M5 8.5 15.8 4l11.2 4.5-11.2 4.7L5 8.5Z" fill="white"/><path d="M8 12v7.2c4.8 3.6 11.2 3.6 16 0V12l-8.2 3.4L8 12Z" fill="white"/><path d="M27 9v10" stroke="white" stroke-width="1.8" stroke-linecap="round"/></svg></div><h3>Your campus has more to offer.</h3><p>Borrow, lend and discover useful resources from your student community.</p><div class="resource-mini"><div class="mini-icon">B</div><div><strong>Books & course materials</strong><span>Find resources for this semester</span></div></div><div class="resource-mini"><div class="mini-icon">↗</div><div><strong>Nearby pickup points</strong><span>Know where to go next</span></div></div></div><div class="float-label"><b>✓</b>College email + phone verification</div></div>';
    shell('<section class="screen"><div class="hero-layout"><div class="hero-copy"><p class="eyebrow">A smarter campus community</p><h1>Find it. Share it.<br><span class="blue">Grow together.</span></h1><p class="lead">The resources you need may already be on campus. Discover books, tools and essentials shared by students like you.</p><div class="hero-actions">' + button('Get started <span class="arrow">→</span>', "onboarding", "btn-dark") + button("I'm already a member", "signin", "btn-outline") + '</div><div class="value-row"><span><i class="value-dot"></i>Verified students</span><span><i class="value-dot"></i>Borrow & lend</span><span><i class="value-dot"></i>Less waste</span></div></div>' + art + '</div></section>');
  }
  function onboarding() {
    const features = [
      ["⌕","Find what you need","Search books, lab equipment and course essentials."],
      ["↗","Borrow or share","Request a resource or list one for another student."],
      ["⌖","Find the pickup","See the location and details before you head out."]
    ];
    const cards = features.map(f => '<article class="feature-card"><div class="feature-icon">' + f[0] + '</div><h3>' + f[1] + '</h3><p>' + f[2] + '</p></article>').join("");
    shell('<section class="screen"><div class="page-two"><p class="eyebrow">Made for student life</p><h1>Everything you need,<br>right on campus.</h1><p class="lead">One student community. More access to the things that help you learn.</p><div class="feature-grid">' + cards + '</div><div class="hero-actions centered">' + button('Create my account <span class="arrow">→</span>', "signup", "btn-primary") + button("I already have an account", "signin", "btn-quiet") + '</div>' + dots(1) + '</div></section>');
  }
  function authForm(mode) {
    const signin = mode === "signin";
    state.mode = mode;
    const title = signin ? "Welcome back." : "Create your account.";
    const intro = signin ? "Enter the same verified college email and phone number linked to your account." : "Gyanshala is for students with an approved college email. We’ll verify both details before creating your account.";
    shell('<section class="screen"><div class="form-layout"><div class="form-card"><div class="back-row"><button class="back" data-action="back">← Back</button></div><p class="step-kicker">' + (signin ? "Student sign in" : "Step 1 of 4 · Your details") + '</p><h1>' + title + '</h1><p class="form-intro">' + intro + '</p><div id="form-message">' + messageBox() + '</div><form id="auth-form">' + field("College email ID", "email", "email", "you@college.ac.in", state.email, "Use the exact domain approved by your college.") + field("Phone number", "phone", "tel", "+91 98765 43210", state.phone, "Include the country code. Example: +91 for India.") + '<label class="consent"><input type="checkbox" name="consent" required><span>I agree to the campus community terms and understand that my email and phone must be verified.</span></label>' + button((signin ? "Send sign-in codes" : "Continue") + ' <span class="arrow">→</span>', "", "btn-primary full", "submit") + '</form><div class="form-bottom">' + (signin ? 'New to Gyanshala? <button class="btn btn-quiet" data-action="signup">Create an account</button>' : 'Already registered? <button class="btn btn-quiet" data-action="signin">Sign in</button>') + '</div>' + setupBox() + dots(1) + '</div></div></section>');
  }
  function emailVerify() {
    shell('<section class="screen"><div class="form-layout"><div class="form-card center"><div class="back-row left"><button class="back" data-action="back">← Back</button></div><div class="verify-icon">✉</div><p class="step-kicker">Step 2 of 4 · Email verification</p><h1>Check your college email.</h1><p class="form-intro">We sent a 6-digit verification code to<br><span class="verify-email">' + esc(state.email) + '</span></p><div id="form-message">' + messageBox() + '</div><form id="email-code-form">' + field("6-digit email code", "code", "text", "000000", "", "The code expires after 10 minutes.", true).replace('type="text"', 'type="text" inputmode="numeric" maxlength="6" autocapitalize="off"') + button('Verify email <span class="arrow">→</span>', "", "btn-primary full", "submit") + '</form><div class="resend-row">Didn&#39;t receive it? <button class="btn btn-quiet" data-action="resend-email">Resend code</button></div><button class="btn btn-quiet" data-action="change-details">Change email or phone</button>' + dots(2) + '</div></div></section>');
  }
  function phoneVerify() {
    const note = state.smsSent ? "Enter the 6-digit code sent by SMS to your phone." : "Your email was sent, but the SMS didn't start. Retry sending the SMS below.";
    shell('<section class="screen"><div class="form-layout"><div class="form-card center"><div class="back-row left"><button class="back" data-action="back">← Back</button></div><div class="verify-icon">⌕</div><p class="step-kicker">Step 3 of 4 · Phone verification</p><h1>Verify your phone.</h1><p class="form-intro">' + esc(note) + '<br><span class="verify-email">' + esc(maskPhone(state.phone)) + '</span></p><div id="form-message">' + messageBox() + '</div><form id="phone-code-form">' + field("SMS verification code", "code", "text", "000000", "", "Use the code from your latest text message.", true).replace('type="text"', 'type="text" inputmode="numeric" maxlength="10" autocapitalize="off"') + button('Verify phone <span class="arrow">→</span>', "", "btn-primary full", "submit") + '</form><div class="resend-row">Didn&#39;t receive it? <button class="btn btn-quiet" data-action="resend-phone">Send SMS again</button></div><button class="btn btn-quiet" data-action="change-details">Change details</button>' + dots(3) + '</div></div></section>');
  }
  function profile() {
    const u = state.user || {};
    shell('<section class="screen"><div class="form-layout"><div class="form-card"><div class="back-row"><button class="back" data-action="back">← Back</button></div><p class="step-kicker">Step 4 of 4 · Your campus profile</p><h1>Tell us about yourself.</h1><p class="form-intro">Your verified student account is created. Complete your profile so other students know who they’re exchanging with.</p><div id="form-message">' + messageBox() + '</div><form id="profile-form">' + field("Full name", "fullName", "text", "Your name", u.fullName || "", "Use the name you use on campus.") + field("Branch / Department", "branch", "text", "e.g. Computer Science", u.branch || "") + '<div class="field-row"><label class="field"><span>Year of study</span><select name="yearOfStudy" required><option value="">Select year</option>' + ["1st Year","2nd Year","3rd Year","4th Year","5th Year","Postgraduate","Research Scholar","Other"].map(x => '<option' + ((u.yearOfStudy || "") === x ? " selected" : "") + '>' + x + '</option>').join("") + '</select></label>' + field("Hostel / Residence", "residence", "text", "e.g. Hostel A, Block 2", u.residence || "") + '</div>' + button('Complete profile <span class="arrow">→</span>', "", "btn-primary full", "submit") + '</form><div class="bottom-note">Your email and phone have been verified. Your profile details are saved to Gyanshala’s dedicated student database.</div>' + dots(4) + '</div></div></section>');
  }
  function maskPhone(phone) {
    if (!phone) return "";
    return "••••••" + phone.slice(-4);
  }
  function complete() {
    const u = state.user || {};
    shell('<section class="screen"><div class="form-layout"><div class="form-card center"><div class="success-mark">✓</div><p class="step-kicker">Student account ready</p><h1>You're in, ' + esc((u.fullName || "").split(" ")[0] || "student") + '.</h1><p class="form-intro">Your Gyanshala account is ready. Your college email and phone are verified, and your profile is saved.</p><div class="account-summary"><div><span>College email</span><strong>' + esc(u.email || state.email) + '</strong></div><div><span>Phone</span><strong>' + esc(u.phoneMasked || maskPhone(state.phone)) + '</strong></div><div><span>Department</span><strong>' + esc(u.branch || "—") + '</strong></div><div><span>Year</span><strong>' + esc(u.yearOfStudy || "—") + '</strong></div><div><span>Residence</span><strong>' + esc(u.residence || "—") + '</strong></div></div><div id="form-message">' + messageBox() + '</div>' + button("Finish", "home", "btn-primary full") + '<div class="form-bottom"><button class="btn btn-quiet" data-action="logout">Sign out</button></div><div class="bottom-note">This account is unique within Gyanshala, separate from AskMoina account access.</div></div></div></section>');
  }
  function render() {
    state.message = "";
    if (state.screen === "splash") return splash();
    if (state.screen === "onboarding") return onboarding();
    if (state.screen === "signup" || state.screen === "signin") return authForm(state.screen);
    if (state.screen === "email") return emailVerify();
    if (state.screen === "phone") return phoneVerify();
    if (state.screen === "profile") return profile();
    if (state.screen === "complete") return complete();
    return splash();
  }
  function setMessage(text, type) {
    state.message = text || "";
    state.messageType = type || "info";
    const slot = document.getElementById("form-message");
    if (slot) slot.innerHTML = messageBox();
  }
  async function api(path, data, method) {
    const response = await fetch(API + path, {
      method: method || (data ? "POST" : "GET"),
      credentials: "same-origin",
      cache: "no-store",
      headers: data ? { "Content-Type": "application/json" } : undefined,
      body: data ? JSON.stringify(data) : undefined
    });
    let result = {};
    try { result = await response.json(); } catch {}
    if (!response.ok) {
      const error = new Error(result.message || result.error || "Request failed. Please try again.");
      error.detail = result;
      error.status = response.status;
      throw error;
    }
    return result;
  }
  function busy(form, on) {
    const btn = form && form.querySelector('button[type="submit"]');
    if (btn) { btn.disabled = on; btn.textContent = on ? "Please wait…" : btn.getAttribute("data-idle-label") || "Continue"; }
  }
  async function onSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const fd = new FormData(form);
    if (form.id === "auth-form") {
      if (!fd.get("consent")) { setMessage("Please agree to the student community terms to continue.", "error"); return; }
      const email = String(fd.get("email") || "").trim().toLowerCase();
      const phone = String(fd.get("phone") || "").trim();
      state.email = email; state.phone = phone;
      busy(form, true);
      try {
        const r = await api("/auth/start", { email, phone, mode: state.mode });
        state.challengeId = r.challengeId; state.smsSent = Boolean(r.smsSent);
        state.screen = "email"; state.message = r.smsSent ? "" : r.message;
        state.messageType = r.smsSent ? "info" : "error";
        render();
        if (!r.smsSent) setMessage(r.message, "info");
      } catch (e) {
        setMessage(e.message, "error");
        if (e.detail && e.detail.setup) { state.setup = { signupReady: false, setup: e.detail.setup }; }
        if (e.detail && e.detail.error === "details_already_registered" && state.mode === "signup") {
          setMessage(e.message + " Use Sign in instead.", "error");
        }
        if (e.detail && e.detail.setup) { render(); setMessage(e.message, "error"); }
      } finally { busy(form, false); }
    } else if (form.id === "email-code-form") {
      busy(form, true);
      try {
        const r = await api("/auth/verify-email", { challengeId: state.challengeId, code: String(fd.get("code") || "").trim() });
        if (r.user) { state.user = r.user; state.screen = r.next === "complete" ? "complete" : "profile"; }
        else state.screen = "phone";
        render();
        if (!state.smsSent) setMessage("Your email is verified. Before continuing, resend the SMS code.", "info");
      } catch (e) { setMessage(e.message, "error"); }
      finally { busy(form, false); }
    } else if (form.id === "phone-code-form") {
      busy(form, true);
      try {
        const r = await api("/auth/verify-phone", { challengeId: state.challengeId, code: String(fd.get("code") || "").trim() });
        if (r.user) { state.user = r.user; state.screen = r.next === "complete" ? "complete" : "profile"; render(); }
        else setMessage("Phone verified. Continue with your email code if prompted.", "success");
      } catch (e) { setMessage(e.message, "error"); }
      finally { busy(form, false); }
    } else if (form.id === "profile-form") {
      const data = { fullName: fd.get("fullName"), branch: fd.get("branch"), yearOfStudy: fd.get("yearOfStudy"), residence: fd.get("residence") };
      busy(form, true);
      try {
        const r = await api("/profile", data);
        state.user = r.user; state.screen = "complete"; render();
      } catch (e) { setMessage(e.message, "error"); }
      finally { busy(form, false); }
    }
  }
  function navigate(screen) {
    state.message = "";
    if (screen === "signup" || screen === "signin") state.mode = screen;
    state.screen = screen;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function action(name) {
    if (name === "home") {
      if (state.user && state.user.profileComplete) { navigate("complete"); return; }
      if (state.user) { navigate("profile"); return; }
      navigate("splash"); return;
    }
    if (name === "onboarding" || name === "signup" || name === "signin" || name === "back") {
      if (name === "back") {
        const order = { onboarding: "splash", signup: "onboarding", signin: "splash", email: "signup", phone: "email", profile: "phone" };
        navigate(order[state.screen] || "splash");
      } else navigate(name);
      return;
    }
    if (name === "change-details") { state.challengeId = ""; navigate(state.mode); return; }
    if (name === "resend-email" || name === "resend-phone") {
      try {
        if (name === "resend-email") { await api("/auth/resend-email", { challengeId: state.challengeId }); setMessage("A new email code has been sent.", "success"); }
        else { await api("/auth/start-phone", { challengeId: state.challengeId }); state.smsSent = true; setMessage("A new SMS code has been sent.", "success"); }
      } catch (e) { setMessage(e.message, "error"); }
      return;
    }
    if (name === "logout") {
      try { await api("/auth/logout", {}); } catch {}
      state.user = null; state.challengeId = ""; state.email = ""; state.phone = ""; state.mode = "signup";
      navigate("splash"); return;
    }
    if (name === "install" && state.installPrompt) {
      state.installPrompt.prompt();
      await state.installPrompt.userChoice.catch(() => null);
      state.installPrompt = null;
      return;
    }
  }
  root.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const name = btn.getAttribute("data-action");
    if (btn.tagName === "A") e.preventDefault();
    action(name);
  });
  async function init() {
    try { state.setup = await api("/health", null, "GET"); } catch { state.setup = null; }
    try {
      const r = await api("/me", null, "GET");
      if (r.authenticated && r.user) {
        state.user = r.user;
        state.screen = r.user.profileComplete ? "complete" : "profile";
      }
    } catch {}
    render();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register(APP + "sw.js", { scope: APP }).catch(() => {});
  }
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.installPrompt = event;
  });
  init();
})();