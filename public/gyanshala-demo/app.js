(() => {
  "use strict";
  const API = "/api/gyanshala";
  const APP = "/gyanshala-demo/";
  const root = document.getElementById("app");
  const state = { screen: "splash", mode: "signup", email: "", challengeId: "", user: null, setup: null, message: "", messageType: "info", busy: false, installPrompt: null, resources: [], activeResource: null, selectedResourceId: "", search: "", category: "All", resourcesLoading: false, resourcesError: "", detailLoading: false, workspaceMessage: "" };
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
    if (!s) return "";
    if (s.previewTestMode) {
      return '<div class="setup-panel"><div class="setup-title"><span class="setup-pill"></span>Preview-only verification</div><p>No email is sent in this testing environment. Verification codes are shown on screen. Test accounts are stored only in the separate preview database; real student email verification is not configured.</p></div>';
    }
    if (s.signupReady) return "";
    const labels = [
      ["databaseBinding", "Create and bind Gyanshala D1 database"],
      ["databaseSchema", "Apply the Gyanshala database schema"],
      ["emailProvider", "Connect Resend email verification"],
      ["collegeDomainPolicy", "Set approved institutional email domains"],
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
    return '<label class="field"><span>' + esc(label) + '</span><input name="' + esc(name) + '" type="' + esc(type || "text") + '" placeholder="' + esc(placeholder || "") + '" value="' + esc(value || "") + '"' + (required === false ? "" : " required") + ' autocomplete="' + esc(name === "email" ? "email" : name === "fullName" ? "name" : "off") + '">' + (note ? '<small>' + esc(note) + '</small>' : "") + '</label>';
  }
  function splash() {
    const art = '<div class="hero-art"><div class="orbit-card"><div class="orbit-mark"><svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M5 8.5 15.8 4l11.2 4.5-11.2 4.7L5 8.5Z" fill="white"/><path d="M8 12v7.2c4.8 3.6 11.2 3.6 16 0V12l-8.2 3.4L8 12Z" fill="white"/><path d="M27 9v10" stroke="white" stroke-width="1.8" stroke-linecap="round"/></svg></div><h3>Your campus has more to offer.</h3><p>Borrow, lend and discover useful resources from your student community.</p><div class="resource-mini"><div class="mini-icon">B</div><div><strong>Books & course materials</strong><span>Find resources for this semester</span></div></div><div class="resource-mini"><div class="mini-icon">↗</div><div><strong>Nearby pickup points</strong><span>Know where to go next</span></div></div></div><div class="float-label"><b>✓</b>Verified college email</div></div>';
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
    const intro = signin ? "Enter the verified college email address linked to your account." : "Gyanshala accepts NIT Silchar email addresses, including department subdomains. We’ll email you a one-time code.";
    shell('<section class="screen"><div class="form-layout"><div class="form-card"><div class="back-row"><button class="back" data-action="back">← Back</button></div><p class="step-kicker">' + (signin ? "Student sign in" : "Step 1 of 3 · Your college email") + '</p><h1>' + title + '</h1><p class="form-intro">' + intro + '</p><div id="form-message">' + messageBox() + '</div><form id="auth-form">' + field("College email ID", "email", "email", "you@college.ac.in", state.email, "Use your NIT Silchar email; department subdomains under nits.ac.in are accepted.") + '<label class="consent"><input type="checkbox" name="consent" required><span>I agree to the campus community terms and understand my college email must be verified.</span></label>' + button((signin ? "Send sign-in codes" : "Continue") + ' <span class="arrow">→</span>', "", "btn-primary full", "submit") + '</form><div class="form-bottom">' + (signin ? 'New to Gyanshala? <button class="btn btn-quiet" data-action="signup">Create an account</button>' : 'Already registered? <button class="btn btn-quiet" data-action="signin">Sign in</button>') + '</div>' + setupBox() + dots(1) + '</div></div></section>');
  }
  function emailVerify() {
    const preview = Boolean(state.setup && state.setup.previewTestMode);
    const title = preview ? "Test your verification." : "Check your college email.";
    const intro = preview
      ? "Preview-only test mode is active. No email will be sent; the code appears on screen."
      : 'We sent a 6-digit verification code to<br><span class="verify-email">' + esc(state.email) + '</span>';
    shell('<section class="screen"><div class="form-layout"><div class="form-card center"><div class="back-row left"><button class="back" data-action="back">← Back</button></div><div class="verify-icon">✉</div><p class="step-kicker">Step 2 of 3 · Email verification</p><h1>' + title + '</h1><p class="form-intro">' + intro + '</p><div id="form-message">' + messageBox() + '</div><form id="email-code-form">' + field("6-digit email code", "code", "text", "000000", "", "The code expires after 10 minutes.", true).replace('type="text"', 'type="text" inputmode="numeric" maxlength="6" autocapitalize="off"') + button('Verify email <span class="arrow">→</span>', "", "btn-primary full", "submit") + '</form><div class="resend-row">Didn&#39;t receive it? <button class="btn btn-quiet" data-action="resend-email">Resend code</button></div><button class="btn btn-quiet" data-action="change-details">Change email</button>' + dots(2) + '</div></div></section>');
  }
  function profile() {
    const u = state.user || {};
    shell('<section class="screen"><div class="form-layout"><div class="form-card"><div class="back-row"><button class="back" data-action="logout">← Sign out</button></div><p class="step-kicker">Step 3 of 3 · Your campus profile</p><h1>Tell us about yourself.</h1><p class="form-intro">Your verified student account is created. Complete your profile so other students know who they’re exchanging with.</p><div id="form-message">' + messageBox() + '</div><form id="profile-form">' + field("Full name", "fullName", "text", "Your name", u.fullName || "", "Use the name you use on campus.") + field("Branch / Department", "branch", "text", "e.g. Computer Science", u.branch || "") + '<div class="field-row"><label class="field"><span>Year of study</span><select name="yearOfStudy" required><option value="">Select year</option>' + ["1st Year","2nd Year","3rd Year","4th Year","5th Year","Postgraduate","Research Scholar","Other"].map(x => '<option' + ((u.yearOfStudy || "") === x ? " selected" : "") + '>' + x + '</option>').join("") + '</select></label>' + field("Hostel / Residence", "residence", "text", "e.g. Hostel A, Block 2", u.residence || "") + '</div>' + button('Complete profile <span class="arrow">→</span>', "", "btn-primary full", "submit") + '</form><div class="bottom-note">Your college email has been verified. Your profile details are saved to Gyanshala’s dedicated student database.</div>' + dots(4) + '</div></div></section>');
  }
  function complete() {
    const u = state.user || {};
    shell('<section class="screen"><div class="form-layout"><div class="form-card center"><div class="success-mark">✓</div><p class="step-kicker">Student account ready</p><h1>You&#39;re in, ' + esc((u.fullName || "").split(" ")[0] || "student") + '.</h1><p class="form-intro">Your Gyanshala account is ready. Your college email is verified, and your profile is saved.</p><div class="account-summary"><div><span>College email</span><strong>' + esc(u.email || state.email) + '</strong></div><div><span>Department</span><strong>' + esc(u.branch || "—") + '</strong></div><div><span>Year</span><strong>' + esc(u.yearOfStudy || "—") + '</strong></div><div><span>Residence</span><strong>' + esc(u.residence || "—") + '</strong></div></div><div id="form-message">' + messageBox() + '</div>' + '<div class="message visible success">Your verified student account has been saved. Resource discovery is the next Gyanshala milestone.</div><div class="form-bottom"><button class="btn btn-quiet" data-action="logout">Sign out</button></div><div class="bottom-note">This account is unique within Gyanshala, separate from AskMoina account access.</div></div></div></section>');
  }

  const resourceCategories = ["All", "Books", "Lab Equipment", "Electronics", "Stationery"];
  function categoryIcon(category) {
    return ({ "Books": "▤", "Lab Equipment": "◒", "Electronics": "▦", "Stationery": "✎" })[category] || "⌘";
  }
  function priceLabel(resource) {
    return Number(resource.priceAmount || 0) <= 0 || resource.lendingType === "free"
      ? "Free to borrow" : "₹" + Number(resource.priceAmount).toLocaleString("en-IN") + " / semester";
  }
  function resourceCard(resource) {
    const cat = ({ "Books": "books", "Lab Equipment": "lab", "Electronics": "electronics", "Stationery": "stationery" })[resource.category] || "other";
    return '<button type="button" class="resource-card" data-action="resource" data-id="' + esc(resource.id) + '"><span class="resource-cover cover-' + cat + '"><span class="resource-symbol">' + esc(resource.icon || categoryIcon(resource.category)) + '</span><span class="cover-caption">' + esc(resource.category) + '</span></span><span class="resource-card-body"><span class="resource-title">' + esc(resource.title) + '</span><span class="resource-meta"><span class="availability-dot"></span>Available <span class="meta-separator">·</span> ' + esc(resource.distanceLabel || "On campus") + '</span><span class="resource-price">' + esc(priceLabel(resource)) + '</span><span class="resource-owner">' + esc(resource.ownerName || "Student community") + '</span></span><span class="card-chevron" aria-hidden="true">↗</span></button>';
  }
  function resourceCards(items) {
    if (state.resourcesLoading) return '<div class="resource-state"><span class="spinner"></span><strong>Finding resources</strong><p>Searching your campus community…</p></div>';
    if (state.resourcesError) return '<div class="resource-state"><strong>We couldn’t load resources.</strong><p>' + esc(state.resourcesError) + '</p><button type="button" class="btn btn-outline" data-action="refresh-resources">Try again</button></div>';
    if (!items.length) return '<div class="resource-state"><div class="empty-mark">⌕</div><strong>No resources found</strong><p>Try another search or choose a different category.</p><button type="button" class="btn btn-outline" data-action="clear-filters">Clear filters</button></div>';
    return '<div class="resource-grid">' + items.map(resourceCard).join("") + '</div>';
  }
  function categoryChips(active, compact) {
    return '<div class="category-chips' + (compact ? ' compact' : '') + '">' + resourceCategories.map(function (category) {
      return '<button type="button" class="category-chip' + (category === active ? ' active' : '') + '" data-action="category" data-id="' + esc(category) + '">' + (category === "All" ? '<span class="chip-dot"></span>' : '<span class="chip-icon">' + categoryIcon(category) + '</span>') + esc(category) + '</button>';
    }).join("") + '</div>';
  }
  function appShell(content, active) {
    const user = state.user || {};
    const name = user.fullName || "Student";
    const initials = name.split(/\\s+/).filter(Boolean).slice(0, 2).map(function (x) { return x.charAt(0).toUpperCase(); }).join("") || "S";
    root.innerHTML = '<div class="campus-app"><header class="campus-header"><a class="campus-brand" href="/gyanshala-demo/" data-action="home">' + logo + '<span>Gyanshala<small>Campus, together</small></span></a><form class="campus-search" id="search-form"><span class="search-glyph" aria-hidden="true">⌕</span><input type="search" name="q" value="' + esc(state.search) + '" placeholder="Search books, equipment, and more…" aria-label="Search campus resources"><button type="submit" aria-label="Submit search">Search</button></form><div class="campus-user"><span class="campus-avatar">' + esc(initials) + '</span><span class="campus-user-copy"><strong>' + esc(name) + '</strong><small>' + esc(user.branch || "Verified student") + '</small></span><button class="signout-link" type="button" data-action="logout">Sign out</button></div></header><div class="campus-layout"><aside class="campus-sidebar"><p class="sidebar-label">WORKSPACE</p><button type="button" class="sidebar-link' + (active === "home" ? " selected" : "") + '" data-action="home"><span>⌂</span>Home</button><button type="button" class="sidebar-link' + (active === "explore" ? " selected" : "") + '" data-action="explore"><span>⌕</span>Explore resources</button><div class="sidebar-spacer"></div><div class="sidebar-note"><span class="sidebar-note-icon">✳</span><strong>Share more. Waste less.</strong><p>Good resources deserve more than one life.</p></div><div class="sidebar-account"><span class="account-check">✓</span><span><strong>Verified student</strong><small>' + esc(user.email || "") + '</small></span></div></aside><section class="campus-main"><div class="campus-content">' + (state.workspaceMessage ? '<div class="workspace-flash" role="status">' + esc(state.workspaceMessage) + '</div>' : '') + content + '</div></section></div><nav class="campus-mobile-nav"><button type="button" class="' + (active === "home" ? "selected" : "") + '" data-action="home"><span>⌂</span>Home</button><button type="button" class="' + (active === "explore" ? "selected" : "") + '" data-action="explore"><span>⌕</span>Explore</button><button type="button" data-action="logout"><span>↗</span>Sign out</button></nav><footer class="campus-footer"><span>Gyanshala <span class="footer-dot">·</span> Built for your campus</span><span>Preview experience <span class="footer-dot">·</span> Student access</span></footer></div>';
    root.querySelectorAll("form").forEach(function (form) { form.addEventListener("submit", onSubmit); });
  }
  function dashboard() {
    const firstName = (state.user && state.user.fullName ? state.user.fullName.split(/\\s+/)[0] : "there");
    const items = state.resources.slice(0, 4);
    const categories = [
      ["Books", "Books & notes", "Course materials shared by students"],
      ["Lab Equipment", "Lab equipment", "Useful kit for practicals"],
      ["Electronics", "Electronics", "Calculators and essentials"],
      ["Stationery", "Stationery", "Everyday study supplies"]
    ];
    const tiles = categories.map(function (item) {
      return '<button type="button" class="category-tile" data-action="category" data-id="' + esc(item[0]) + '"><span class="tile-icon">' + categoryIcon(item[0]) + '</span><span><strong>' + esc(item[1]) + '</strong><small>' + esc(item[2]) + '</small></span><span class="tile-arrow">↗</span></button>';
    }).join("");
    const content = '<section class="welcome-panel"><div class="welcome-copy"><p class="workspace-eyebrow">YOUR CAMPUS, CONNECTED</p><h1>What do you need today' + (firstName && firstName !== "there" ? ', ' + esc(firstName) : '') + '?</h1><p>Find useful things nearby, shared by students who know campus best.</p><form class="hero-search" id="hero-search-form"><span aria-hidden="true">⌕</span><input name="q" value="' + esc(state.search) + '" type="search" placeholder="Try “scientific calculator”" aria-label="Search resources"><button type="submit" aria-label="Search">→</button></form><div class="welcome-tags"><span>✓ Verified community</span><span>♧ Borrow and share</span><span>⌖ Pickup nearby</span></div></div><div class="welcome-art" aria-hidden="true"><div class="art-orbit orbit-one"></div><div class="art-orbit orbit-two"></div><div class="art-float float-book">▤<small>LEARN</small></div><div class="art-float float-calc">▦<small>TOOLS</small></div><div class="art-float float-lab">◒<small>LAB</small></div><div class="art-glass"><span>✳</span><strong>Shared by students.</strong><small>Ready when you are.</small></div></div></section><section class="dashboard-categories"><div class="section-heading"><div><p class="section-overline">FIND YOUR NEXT ESSENTIAL</p><h2>Browse by category</h2></div><button type="button" class="text-action" data-action="explore">View all resources <span>→</span></button></div><div class="category-tile-grid">' + tiles + '</div></section><section class="dashboard-resources"><div class="section-heading"><div><p class="section-overline">GOOD THINGS, CLOSE BY</p><h2>Nearby for you</h2><p class="section-subtitle">Campus essentials available to borrow or share.</p></div><button type="button" class="text-action" data-action="explore">Explore all <span>→</span></button></div>' + resourceCards(items) + '</section>';
    appShell(content, "home");
  }
  function browse() {
    const content = '<section class="browse-heading"><p class="workspace-eyebrow">THE CAMPUS SHELF</p><div class="browse-title-row"><div><h1>Explore resources</h1><p>Discover books, tools and essentials shared around campus.</p></div><span class="result-count">' + state.resources.length + ' ' + (state.resources.length === 1 ? "resource" : "resources") + '</span></div></section><section class="browse-controls"><div><p class="section-overline">FILTER BY</p>' + categoryChips(state.category, false) + '</div><div class="browse-toolbar"><span>' + (state.search ? 'Results for <strong>' + esc(state.search) + '</strong>' : 'All campus resources') + '</span><button type="button" class="subtle-action" data-action="clear-filters">Clear filters</button></div></section><section class="browse-results">' + resourceCards(state.resources) + '</section>';
    appShell(content, "explore");
  }
  function detail() {
    if (state.detailLoading) {
      appShell('<div class="detail-loading"><span class="spinner"></span><p>Opening resource details…</p></div>', "explore");
      return;
    }
    const r = state.activeResource;
    if (!r) {
      appShell('<div class="resource-state"><strong>Resource unavailable</strong><p>' + esc(state.resourcesError || "This listing may have been removed.") + '</p><button type="button" class="btn btn-outline" data-action="explore">Back to explore</button></div>', "explore");
      return;
    }
    const already = Boolean(r.requestStatus);
    const statusText = r.requestStatus === "pending" ? "Request sent" : r.requestStatus ? "Request " + r.requestStatus : "Request to borrow";
    const price = priceLabel(r);
    const cat = ({ "Books": "books", "Lab Equipment": "lab", "Electronics": "electronics", "Stationery": "stationery" })[r.category] || "other";
    const cta = already
      ? '<button class="btn btn-primary full" type="button" disabled><span>✓</span>' + esc(statusText) + '</button><p class="cta-note">This resource is already in your requests.</p>'
      : '<button class="btn btn-primary full request-button" type="button" data-action="request-resource" data-id="' + esc(r.id) + '">Request to borrow <span class="arrow">→</span></button><p class="cta-note">The owner can review your request. You can track its status in a later milestone.</p>';
    const content = '<div class="detail-back-row"><button type="button" class="back" data-action="explore">← Back to explore</button><span class="detail-breadcrumb">Explore <span> / </span>' + esc(r.category) + '</span></div><section class="detail-layout"><div class="detail-main"><div class="detail-visual cover-' + cat + '"><span class="detail-art-orbit"></span><span class="detail-visual-icon">' + esc(r.icon || categoryIcon(r.category)) + '</span><span class="detail-visual-label">' + esc(r.category) + '</span></div><div class="detail-description"><p class="section-overline">ABOUT THIS RESOURCE</p><h2>Made to be shared.</h2><p>' + esc(r.description) + '</p><div class="detail-facts"><div><span class="fact-icon">✧</span><span><small>Condition</small><strong>' + esc(r.condition || "Good") + '</strong></span></div><div><span class="fact-icon">⌖</span><span><small>Pickup location</small><strong>' + esc(r.pickupLocation) + '</strong></span></div><div><span class="fact-icon">◷</span><span><small>Distance</small><strong>' + esc(r.distanceLabel || "On campus") + '</strong></span></div></div></div></div><aside class="detail-side"><span class="availability-badge"><i></i>Available now</span><p class="detail-category">' + esc(r.category) + '</p><h1>' + esc(r.title) + '</h1><p class="detail-price">' + esc(price) + '</p><div class="owner-card"><span class="owner-avatar">' + esc((r.ownerName || "S").split(/\\s+/).map(function (x) { return x.charAt(0); }).slice(0, 2).join("").toUpperCase()) + '</span><span><small>Shared by</small><strong>' + esc(r.ownerName || "Student community") + '</strong><small>' + esc(r.ownerBranch || "Campus community") + '</small></span><span class="owner-check">✓</span></div>' + cta + '<div class="privacy-note"><span>♧</span><p>Student-to-student sharing, with campus email verification.</p></div></aside></section>';
    appShell(content, "explore");
  }
  async function refreshResources() {
    state.resourcesLoading = true;
    state.resourcesError = "";
    render();
    try {
      const params = new URLSearchParams();
      params.set("q", state.search || "");
      params.set("category", state.category || "All");
      const result = await api("/resources?" + params.toString(), null, "GET");
      state.resources = Array.isArray(result.resources) ? result.resources : [];
    } catch (e) {
      state.resourcesError = e.message || "Please try again.";
      state.resources = [];
    } finally {
      state.resourcesLoading = false;
      render();
    }
  }
  async function openResource(id) {
    state.selectedResourceId = id;
    state.resourcesError = "";
    state.activeResource = null;
    state.detailLoading = true;
    state.screen = "detail";
    render();
    try {
      const result = await api("/resources/" + encodeURIComponent(id), null, "GET");
      state.activeResource = result.resource || null;
    } catch (e) {
      state.resourcesError = e.message || "This resource is temporarily unavailable.";
    } finally {
      state.detailLoading = false;
      render();
    }
  }
  async function requestResource(id) {
    if (!id) return;
    try {
      const result = await api("/resources/" + encodeURIComponent(id) + "/request", {}, "POST");
      if (state.activeResource && state.activeResource.id === id) state.activeResource.requestStatus = result.requestStatus || "pending";
      state.resources = state.resources.map(function (item) {
        return item.id === id ? Object.assign({}, item, { requestStatus: result.requestStatus || "pending" }) : item;
      });
      state.workspaceMessage = result.alreadyRequested ? "You’ve already requested this resource." : "Request sent. You can track it in My Requests when that interface is ready.";
    } catch (e) {
      state.workspaceMessage = e.message || "We couldn’t send that request. Try again.";
    }
    render();
  }

  function render() {
    state.message = "";
    if (state.screen === "splash") return splash();
    if (state.screen === "onboarding") return onboarding();
    if (state.screen === "signup" || state.screen === "signin") return authForm(state.screen);
    if (state.screen === "email") return emailVerify();
    
    if (state.screen === "profile") return profile();
    if (state.screen === "home") return dashboard();
    if (state.screen === "explore") return browse();
    if (state.screen === "detail") return detail();
    if (state.screen === "complete") return dashboard();
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
    if (form.id === "search-form" || form.id === "hero-search-form") {
      state.search = String(fd.get("q") || "").trim().slice(0, 120);
      state.category = "All";
      state.screen = "explore";
      await refreshResources();
    } else if (form.id === "auth-form") {
      if (!fd.get("consent")) { setMessage("Please agree to the student community terms to continue.", "error"); return; }
      const email = String(fd.get("email") || "").trim().toLowerCase();
      state.email = email;
      busy(form, true);
      try {
        const r = await api("/auth/start", { email, mode: state.mode });
        state.challengeId = r.challengeId;
        state.screen = "email";
        render();
        setMessage(r.message || "Check your college email for a verification code.", "info");
      } catch (e) {
        setMessage(e.message, "error");
        if (e.detail && e.detail.setup) { state.setup = { signupReady: false, setup: e.detail.setup }; }
        if (e.detail && e.detail.error === "email_already_registered" && state.mode === "signup") {
          setMessage(e.message + " Use Sign in instead.", "error");
        }
        if (e.detail && e.detail.setup) { render(); setMessage(e.message, "error"); }
      } finally { busy(form, false); }
    } else if (form.id === "email-code-form") {
      busy(form, true);
      try {
        const r = await api("/auth/verify-email", { challengeId: state.challengeId, code: String(fd.get("code") || "").trim() });
        if (r.user) { state.user = r.user; state.screen = r.user.profileComplete ? "home" : "profile"; render(); if (state.screen === "home") refreshResources(); }
        else setMessage("Email verification was incomplete. Please request a new code.", "error");
      } catch (e) { setMessage(e.message, "error"); }
      finally { busy(form, false); }
    } else if (form.id === "profile-form") {
      const data = { fullName: fd.get("fullName"), branch: fd.get("branch"), yearOfStudy: fd.get("yearOfStudy"), residence: fd.get("residence") };
      busy(form, true);
      try {
        const r = await api("/profile", data);
        state.user = r.user; state.screen = "home"; state.category = "All"; state.search = ""; refreshResources();
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
  async function action(name, id) {
    if (name === "home") {
      if (state.user && state.user.profileComplete) { state.category = "All"; state.search = ""; state.screen = "home"; refreshResources(); return; }
      if (state.user) { navigate("profile"); return; }
      navigate("splash"); return;
    }
    if (name === "explore") { state.screen = "explore"; render(); refreshResources(); return; }
    if (name === "category") { state.search = ""; state.category = resourceCategories.includes(id) ? id : "All"; state.screen = "explore"; refreshResources(); return; }
    if (name === "resource") { await openResource(id); return; }
    if (name === "request-resource") { await requestResource(id); return; }
    if (name === "refresh-resources") { await refreshResources(); return; }
    if (name === "clear-filters") { state.category = "All"; state.search = ""; state.screen = "explore"; await refreshResources(); return; }
    if (name === "onboarding" || name === "signup" || name === "signin" || name === "back") {
      if (name === "back") {
        const order = { onboarding: "splash", signup: "onboarding", signin: "splash", email: state.mode, profile: "email" };
        navigate(order[state.screen] || "splash");
      } else navigate(name);
      return;
    }
    if (name === "change-details") { state.challengeId = ""; navigate(state.mode); return; }
    if (name === "resend-email") {
      try {
        const r = await api("/auth/resend-email", { challengeId: state.challengeId });
        setMessage(r.previewOnly
          ? "PREVIEW TEST MODE — no email was sent. Use code " + r.previewVerificationCode + "."
          : "A new email code has been sent.", "success");
      } catch (e) { setMessage(e.message, "error"); }
      return;
    }
    if (name === "logout") {
      try { await api("/auth/logout", {}); } catch {}
      state.user = null; state.challengeId = ""; state.email = ""; state.mode = "signup";
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
    const id = btn.getAttribute("data-id");
    if (btn.tagName === "A") e.preventDefault();
    action(name, id);
  });
  async function init() {
    try { state.setup = await api("/health", null, "GET"); } catch { state.setup = null; }
    try {
      const r = await api("/me", null, "GET");
      if (r.authenticated && r.user) {
        state.user = r.user;
        state.screen = r.user.profileComplete ? "home" : "profile";
      }
    } catch {}
    render();
    if (state.screen === "home") refreshResources();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register(APP + "sw.js", { scope: APP }).catch(() => {});
  }
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.installPrompt = event;
  });
  init();
})();