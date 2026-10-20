(() => {
  "use strict";
  const API = "/api/gyanshala";
  const APP = "/gyanshala-demo/";
  const root = document.getElementById("app");
  const state = { screen: "splash", mode: "signup", email: "", challengeId: "", user: null, setup: null, message: "", messageType: "info", busy: false, installPrompt: null, resources: [], activeResource: null, selectedResourceId: "", search: "", category: "All", resourcesLoading: false, resourcesError: "", detailLoading: false, workspaceMessage: "", myRequests: [], requestsLoading: false, requestsError: "", requestFilter: "All", messageThreads: [], threadsLoading: false, threadsError: "", selectedThreadId: "", activeThread: null, threadMessages: [], threadLoading: false, messageSending: false, pickupPoints: [], pickupSelectedId: "", pickupsLoading: false, pickupsError: "", communityPosts: [], communityLoading: false, communityError: "", communityType: "All", communityCategory: "All", communitySearch: "", communityFormOpen: false, communitySubmitting: false, communityToast: "" };
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
    const amount = Number(resource.priceAmount || 0);
    if (resource.lendingType === "free" || (resource.lendingType === "lend" && amount <= 0)) return "Free to borrow";
    if (resource.lendingType === "sell") return "₹" + amount.toLocaleString("en-IN") + " · one-time";
    return "₹" + amount.toLocaleString("en-IN") + " / semester";
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
    const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(function (x) { return x.charAt(0).toUpperCase(); }).join("") || "S";
    root.innerHTML = '<div class="campus-app"><header class="campus-header"><a class="campus-brand" href="/gyanshala-demo/" data-action="home">' + logo + '<span>Gyanshala<small>Campus, together</small></span></a><form class="campus-search" id="search-form"><span class="search-glyph" aria-hidden="true">⌕</span><input type="search" name="q" value="' + esc(state.search) + '" placeholder="Search books, equipment, and more…" aria-label="Search campus resources"><button type="submit" aria-label="Submit search">Search</button></form><div class="campus-user"><span class="campus-avatar">' + esc(initials) + '</span><span class="campus-user-copy"><strong>' + esc(name) + '</strong><small>' + esc(user.branch || "Verified student") + '</small></span><button class="signout-link" type="button" data-action="logout">Sign out</button></div></header><div class="campus-layout"><aside class="campus-sidebar"><p class="sidebar-label">WORKSPACE</p><button type="button" class="sidebar-link' + (active === "home" ? " selected" : "") + '" data-action="home"><span>⌂</span>Home</button><button type="button" class="sidebar-link' + (active === "explore" ? " selected" : "") + '" data-action="explore"><span>⌕</span>Explore resources</button><button type="button" class="sidebar-link' + (active === "map" ? " selected" : "") + '" data-action="map"><span>⌖</span>Map & pickup</button><button type="button" class="sidebar-link' + (active === "community" ? " selected" : "") + '" data-action="community"><span>♧</span>Community</button><button type="button" class="sidebar-link' + (active === "list" ? " selected" : "") + '" data-action="add-resource"><span>＋</span>List a resource</button><button type="button" class="sidebar-link' + (active === "requests" ? " selected" : "") + '" data-action="my-requests"><span>▤</span>My Requests</button><button type="button" class="sidebar-link' + (active === "messages" ? " selected" : "") + '" data-action="messages"><span>◌</span>Messages</button><div class="sidebar-spacer"></div><div class="sidebar-note"><span class="sidebar-note-icon">✳</span><strong>Share more. Waste less.</strong><p>Good resources deserve more than one life.</p></div><div class="sidebar-account"><span class="account-check">✓</span><span><strong>Verified student</strong><small>' + esc(user.email || "") + '</small></span></div></aside><section class="campus-main"><div class="campus-content">' + (state.workspaceMessage ? '<div class="workspace-flash" role="status">' + esc(state.workspaceMessage) + '</div>' : '') + content + '</div></section></div><nav class="campus-mobile-nav"><button type="button" class="' + (active === "home" ? "selected" : "") + '" data-action="home"><span>⌂</span>Home</button><button type="button" class="' + (active === "explore" ? "selected" : "") + '" data-action="explore"><span>⌕</span>Explore</button><button type="button" class="' + (active === "map" ? "selected" : "") + '" data-action="map"><span>⌖</span>Map</button><button type="button" class="' + (active === "community" ? "selected" : "") + '" data-action="community"><span>♧</span>Community</button><button type="button" data-action="open-more" aria-expanded="false"><span>•••</span>More</button></nav><div class="mobile-more-menu" id="mobile-more-menu" aria-label="More navigation"><button type="button" data-action="add-resource"><span>＋</span><span><strong>List a resource</strong><small>Share an item with campus</small></span></button><button type="button" data-action="my-requests"><span>▤</span><span><strong>My Requests</strong><small>Follow your borrowing activity</small></span></button><button type="button" data-action="messages"><span>◌</span><span><strong>Messages</strong><small>Chat with another student</small></span></button><button type="button" data-action="close-more"><span>×</span><span><strong>Close menu</strong><small>Return to the current screen</small></span></button></div><footer class="campus-footer"><span>Gyanshala <span class="footer-dot">·</span> Built for your campus</span><span>Preview experience <span class="footer-dot">·</span> Student access</span></footer></div>';
    root.querySelectorAll("form").forEach(function (form) { form.addEventListener("submit", onSubmit); });
  }
  function dashboard() {
    const firstName = (state.user && state.user.fullName ? state.user.fullName.split(/\s+/)[0] : "there");
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
    const requestLabel = r.lendingType === "sell" ? "Ask about this item" : r.lendingType === "free" ? "Request this free item" : "Request to borrow";
    const cta = already
      ? '<button class="btn btn-primary full" type="button" disabled><span>✓</span>' + esc(statusText) + '</button><p class="cta-note">This resource is already in your requests.</p>'
      : '<button class="btn btn-primary full request-button" type="button" data-action="request-resource" data-id="' + esc(r.id) + '">' + esc(requestLabel) + ' <span class="arrow">→</span></button><p class="cta-note">The owner can review your request. You can track its status in My Requests.</p>';
    const content = '<div class="detail-back-row"><button type="button" class="back" data-action="explore">← Back to explore</button><span class="detail-breadcrumb">Explore <span> / </span>' + esc(r.category) + '</span></div><section class="detail-layout"><div class="detail-main"><div class="detail-visual cover-' + cat + '"><span class="detail-art-orbit"></span><span class="detail-visual-icon">' + esc(r.icon || categoryIcon(r.category)) + '</span><span class="detail-visual-label">' + esc(r.category) + '</span></div><div class="detail-description"><p class="section-overline">ABOUT THIS RESOURCE</p><h2>Made to be shared.</h2><p>' + esc(r.description) + '</p><div class="detail-facts"><div><span class="fact-icon">✧</span><span><small>Condition</small><strong>' + esc(r.condition || "Good") + '</strong></span></div><div><span class="fact-icon">⌖</span><span><small>Pickup location</small><strong>' + esc(r.pickupLocation) + '</strong></span></div><div><span class="fact-icon">◷</span><span><small>Distance</small><strong>' + esc(r.distanceLabel || "On campus") + '</strong></span></div></div></div></div><aside class="detail-side"><span class="availability-badge"><i></i>Available now</span><p class="detail-category">' + esc(r.category) + '</p><h1>' + esc(r.title) + '</h1><p class="detail-price">' + esc(price) + '</p><div class="owner-card"><span class="owner-avatar">' + esc((r.ownerName || "S").split(/\s+/).map(function (x) { return x.charAt(0); }).slice(0, 2).join("").toUpperCase()) + '</span><span><small>Shared by</small><strong>' + esc(r.ownerName || "Student community") + '</strong><small>' + esc(r.ownerBranch || "Campus community") + '</small></span><span class="owner-check">✓</span></div>' + cta + '<div class="privacy-note"><span>♧</span><p>Student-to-student sharing, with campus email verification.</p></div></aside></section>';
    appShell(content, "explore");
  }

  function addResourceScreen() {
    const content = '<section class="workspace-page-heading"><p class="workspace-eyebrow">GIVE GOOD THINGS ANOTHER LIFE</p><h1>List a resource</h1><p>Share something useful with your campus community. Students will see the details before requesting it.</p></section><section class="listing-layout"><div class="listing-intro-card"><span class="listing-art-icon">＋</span><h2>Someone nearby<br>might need this.</h2><p>Books, lab essentials and everyday study tools can go further when students share them.</p><div class="listing-tip"><span>✧</span><div><strong>A little detail goes a long way</strong><p>Add a clear description and a public campus pickup point.</p></div></div><div class="listing-tip"><span>⌖</span><div><strong>Keep exchanges safe</strong><p>Use a shared campus location. Never include passwords or sensitive personal details.</p></div></div></div><form class="listing-form" id="listing-form"><div class="listing-form-header"><div><p class="section-overline">RESOURCE DETAILS</p><h2>What are you sharing?</h2></div><span class="required-note">* Required</span></div><div id="listing-message"></div><label class="field"><span>Resource title *</span><input name="title" type="text" minlength="3" maxlength="100" placeholder="e.g. Engineering Drawing Kit" required></label><div class="field-row"><label class="field"><span>Category *</span><select name="category" required><option value="">Choose a category</option><option>Books</option><option>Lab Equipment</option><option>Electronics</option><option>Stationery</option></select></label><label class="field"><span>Condition *</span><select name="condition" required><option>Good</option><option>New</option><option>Very good</option><option>Fair</option></select></label></div><label class="field"><span>Description *</span><textarea name="description" minlength="8" maxlength="1500" rows="4" placeholder="What is included? What should a student know before requesting it?" required></textarea><small>8–1,500 characters.</small></label><div class="listing-form-divider"></div><p class="section-overline">SHARING PREFERENCES</p><label class="field"><span>How would you like to share it? *</span><select name="lendingType" id="listing-lending-type" required><option value="lend">Lend · return it later</option><option value="free">Give away · free</option><option value="sell">Sell · one-time price</option></select></label><div class="field-row"><label class="field"><span>Amount (₹)</span><input name="priceAmount" id="listing-price" type="number" min="0" max="1000000" step="1" value="0" required><small>Free items are saved at ₹0.</small></label><label class="field"><span>Campus pickup point *</span><input name="pickupLocation" type="text" maxlength="120" placeholder="e.g. Central Library entrance" required><small>Use a public campus meeting point.</small></label></div><label class="field"><span>Walking distance (optional)</span><input name="distanceLabel" type="text" maxlength="60" placeholder="e.g. 5 min walk"></label><div id="listing-message-bottom"></div><button class="btn btn-primary full" type="submit">Publish listing <span class="arrow">→</span></button><p class="form-footnote">Your listing will be linked to your Gyanshala account and stored in the campus resource catalogue.</p></form></section>';
    appShell(content, "list");
    const typeSelect = root.querySelector("#listing-lending-type");
    const priceInput = root.querySelector("#listing-price");
    if (typeSelect && priceInput) {
      const syncPrice = function () {
        if (typeSelect.value === "free") { priceInput.value = "0"; priceInput.disabled = true; }
        else priceInput.disabled = false;
      };
      typeSelect.addEventListener("change", syncPrice);
      syncPrice();
    }
  }

  function campusMapSvg(selected) {
    const x=selected?Math.round(Math.max(5,Math.min(95,Number(selected.mapX)||50))*10):500;
    const y=selected?Math.round(Math.max(5,Math.min(95,Number(selected.mapY)||50))*6.5):325;
    const route=selected?'<path class="map-walk-route" d="M 500 325 C 470 315 460 295 '+Math.round((500+x)/2)+' '+Math.round((325+y)/2)+' S '+x+' '+y+' '+x+' '+y+'" />':"";
    const pins=state.pickupPoints.map(function(p){
      const chosen=selected&&selected.id===p.id;
      const left=Math.max(3,Math.min(97,Number(p.mapX)||50));
      const top=Math.max(4,Math.min(96,Number(p.mapY)||50));
      return '<button type="button" class="map-pin'+(chosen?' selected':'')+'" style="left:'+left+'%;top:'+top+'%" data-action="select-pickup" data-id="'+esc(p.id)+'" aria-label="'+esc(p.name)+', '+Number(p.resourceCount||0)+' available resources"><span class="map-pin-dot">'+(chosen?'✓':'⌖')+'</span><span class="map-pin-label">'+esc(p.name)+'</span></button>';
    }).join("");
    return '<div class="pickup-map-canvas"><svg class="campus-schematic" viewBox="0 0 1000 650" role="img" aria-label="Illustrative campus schematic showing pickup points and a preview walking route" preserveAspectRatio="xMidYMid meet"><defs><pattern id="map-grid" width="36" height="36" patternUnits="userSpaceOnUse"><path d="M 36 0 L 0 0 0 36" fill="none" stroke="#dbe7e2" stroke-width="1"/></pattern></defs><rect width="1000" height="650" rx="26" fill="#eff6f0"/><rect width="1000" height="650" rx="26" fill="url(#map-grid)" opacity=".72"/><path class="map-road-wide" d="M -40 130 C 180 120 260 180 400 160 S 730 95 1040 140 M -30 470 C 180 440 320 500 480 455 S 800 425 1040 500 M 260 -40 C 310 100 250 210 340 330 S 450 530 430 700 M 760 -40 C 730 100 790 225 700 330 S 650 540 720 700"/><path class="map-road" d="M -40 130 C 180 120 260 180 400 160 S 730 95 1040 140 M -30 470 C 180 440 320 500 480 455 S 800 425 1040 500 M 260 -40 C 310 100 250 210 340 330 S 450 530 430 700 M 760 -40 C 730 100 790 225 700 330 S 650 540 720 700"/><path class="map-path" d="M 65 340 C 190 275 270 260 390 305 S 550 405 650 330 815 245 940 315 M 80 565 C 190 570 260 530 345 455 S 570 305 620 190 770 85 930 65 M 75 80 C 210 140 290 110 420 210 S 650 255 800 305 885 410 940 580"/>'+route+'<g class="map-building"><rect x="75" y="175" width="150" height="82" rx="12"/><rect x="420" y="82" width="142" height="76" rx="12"/><rect x="535" y="210" width="125" height="82" rx="12"/><rect x="770" y="185" width="145" height="84" rx="12"/><rect x="118" y="367" width="132" height="72" rx="12"/><rect x="465" y="505" width="152" height="71" rx="12"/><rect x="788" y="380" width="125" height="76" rx="12"/></g><g class="map-building-label"><text x="150" y="220">LIBRARY WING</text><text x="491" y="122">ACADEMIC BLOCK</text><text x="597" y="255">STUDENT HUB</text><text x="842" y="230">SCIENCE BLOCK</text><text x="184" y="405">CAMPUS SERVICES</text><text x="541" y="546">COMMON AREA</text><text x="850" y="420">RESIDENCES</text></g><g class="map-green"><circle cx="315" cy="185" r="39"/><circle cx="350" cy="205" r="22"/><circle cx="670" cy="100" r="35"/><circle cx="705" cy="117" r="19"/><circle cx="280" cy="420" r="30"/><circle cx="316" cy="431" r="20"/><circle cx="690" cy="510" r="40"/><circle cx="730" cy="490" r="19"/><circle cx="905" cy="540" r="31"/></g><g class="map-start"><circle cx="500" cy="325" r="19"/><circle cx="500" cy="325" r="7"/><text x="518" y="319">CAMPUS CENTRE</text></g></svg><div class="map-pin-layer">'+pins+'</div><div class="map-watermark">GYANSHALA CAMPUS GUIDE <span>PREVIEW</span></div></div>';
  }
  function pickupMapScreen() {
    const selected=state.pickupPoints.find(p=>p.id===state.pickupSelectedId)||state.pickupPoints[0]||null;
    let main;
    if(state.pickupsLoading) main='<div class="resource-state"><span class="spinner"></span><strong>Finding pickup points</strong><p>Loading the campus resource map…</p></div>';
    else if(state.pickupsError) main='<div class="resource-state"><strong>Campus map didn’t load.</strong><p>'+esc(state.pickupsError)+'</p><button type="button" class="btn btn-outline" data-action="refresh-pickups">Try again</button></div>';
    else if(!state.pickupPoints.length) main='<div class="resource-state"><strong>No pickup points yet</strong><p>Campus pickup locations will appear here when they are configured.</p></div>';
    else {
      const routeLabel="About "+Number(selected.walkMinutes||5)+" min from the campus centre";
      const pointList=state.pickupPoints.map(p=>'<button type="button" class="pickup-location-row'+(selected.id===p.id?' selected':'')+'" data-action="select-pickup" data-id="'+esc(p.id)+'"><span class="pickup-row-marker">⌖</span><span class="pickup-row-copy"><strong>'+esc(p.name)+'</strong><small>'+esc(p.area)+'</small><span>'+Number(p.resourceCount||0)+' available '+(Number(p.resourceCount)===1?'resource':'resources')+'</span></span><span class="pickup-row-time">'+Number(p.walkMinutes||5)+' min</span></button>').join("");
      const resources=selected.resources&&selected.resources.length?'<div class="pickup-item-grid">'+selected.resources.map(resourceCard).join("")+'</div>':'<div class="pickup-no-items"><span>⌕</span><strong>No listed resources at this point yet</strong><p>Students can use this location as a pickup point when creating a listing.</p></div>';
      main='<div class="pickup-layout"><div class="pickup-map-panel"><div class="pickup-map-header"><div><p class="section-overline">CAMPUS GUIDE</p><h2>Find your pickup point</h2></div><span class="map-preview-badge"><i></i>Preview map</span></div>'+campusMapSvg(selected)+'<div class="map-legend"><span><i class="legend-pin"></i>Pickup point</span><span><i class="legend-route"></i>Illustrative route</span><span><i class="legend-start"></i>Campus centre</span></div><p class="map-disclaimer">This is an illustrative campus schematic, not live GPS navigation. Walking times are preview estimates; confirm your route on campus.</p></div><aside class="pickup-locations-panel"><div class="pickup-list-heading"><div><p class="section-overline">PICKUP LOCATIONS</p><h2>Meet nearby</h2></div><span class="pickup-total">'+state.pickupPoints.length+'</span></div><div class="pickup-location-list">'+pointList+'</div></aside></div><section class="pickup-selected-panel"><div class="pickup-selected-heading"><span class="pickup-selected-icon">⌖</span><div><p class="section-overline">SELECTED MEETING POINT</p><h2>'+esc(selected.name)+'</h2><p>'+esc(selected.area)+' · '+esc(routeLabel)+'</p></div><button type="button" class="btn btn-outline" data-action="browse-pickup">View resources here <span class="arrow">→</span></button></div><p class="pickup-description">'+esc(selected.description)+'</p><div class="pickup-resources-heading"><div><p class="section-overline">AVAILABLE NEARBY</p><h3>Resources at this location</h3></div><span>'+Number(selected.resourceCount||0)+' available</span></div>'+resources+'</section>';
    }
    const content='<section class="workspace-page-heading"><p class="workspace-eyebrow">KNOW WHERE TO MEET</p><h1>Campus map & pickup points</h1><p>Choose a public campus meeting point and see which shared resources are listed there.</p></section>'+main;
    appShell(content,"map");
  }
  function communityCategoryChips(active) {
    const categories=["All","Books","Lab Equipment","Electronics","Stationery","Other"];
    return '<div class="community-category-chips">'+categories.map(c=>'<button type="button" class="community-category-chip'+(c===active?' active':'')+'" data-action="community-category" data-id="'+esc(c)+'">'+esc(c)+'</button>').join("")+'</div>';
  }
  function communityPostCard(post) {
    const isOffer=post.type==="offer";
    const status=post.status==="fulfilled"?'<span class="community-status fulfilled">Fulfilled</span>':"";
    const sample=post.sample?'<span class="community-sample">Preview sample</span>':"";
    const icon=categoryIcon(post.category);
    let action;
    if(post.isMine) action=post.status==="active"?'<button type="button" class="btn btn-outline" data-action="close-community-post" data-id="'+esc(post.id)+'">Mark fulfilled</button>':'<span class="community-complete-label">✓ Fulfilled</span>';
    else action='<button type="button" class="btn '+(post.interested?'btn-outline':'btn-primary')+' community-interest-button" data-action="community-interest" data-id="'+esc(post.id)+'"'+(post.interested?' disabled':'')+'>'+(post.interested?'✓ Interested':isOffer?'I’m interested':'I can help')+' <span class="interest-count">'+Number(post.interestedCount||0)+'</span></button>';
    return '<article class="community-post-card '+(isOffer?'offer-card':'need-card')+'"><div class="community-card-top"><span class="community-type-pill '+(isOffer?'offer':'need')+'">'+(isOffer?'↗ Offer':'⌕ Need')+'</span>'+status+sample+'</div><div class="community-post-icon">'+icon+'</div><p class="community-post-category">'+esc(post.category)+'</p><h3>'+esc(post.title)+'</h3><p class="community-post-description">'+esc(post.description)+'</p><div class="community-post-meta"><span class="community-avatar">'+esc((post.ownerName||"G").trim().split(/\s+/).map(x=>x.charAt(0)).slice(0,2).join("").toUpperCase())+'</span><span><strong>'+esc(post.ownerName||"Campus community")+'</strong><small>'+esc(post.ownerBranch||"Student community")+'</small></span></div><div class="community-post-location"><span>⌖</span>'+esc(post.pickupLocation||"Campus-wide")+'</div><div class="community-card-footer"><small>'+esc(new Date(post.createdAt).toLocaleDateString(undefined,{day:"numeric",month:"short"}))+'</small>'+action+'</div></article>';
  }
  function communityPostForm() {
    return '<form class="community-post-form" id="community-post-form"><div class="community-form-heading"><div><p class="section-overline">START A GOOD THING</p><h2>Create a community post</h2></div><button type="button" class="icon-close" data-action="community-cancel" aria-label="Close form">×</button></div><div id="community-form-message"></div><div class="field-row"><label class="field"><span>Post type *</span><select name="type" required><option value="offer">Offer something</option><option value="need">I need something</option></select></label><label class="field"><span>Category *</span><select name="category" required><option>Books</option><option>Lab Equipment</option><option>Electronics</option><option>Stationery</option><option>Other</option></select></label></div><label class="field"><span>Title *</span><input name="title" type="text" minlength="3" maxlength="100" placeholder="e.g. Looking for a lab coat" required></label><label class="field"><span>Details *</span><textarea name="description" rows="4" minlength="8" maxlength="1000" placeholder="Say what you’re offering or what would help you." required></textarea><small>8–1,000 characters.</small></label><label class="field"><span>Preferred campus location (optional)</span><input name="pickupLocation" maxlength="120" placeholder="e.g. Central Library"></label><div class="community-form-actions"><button type="button" class="btn btn-outline" data-action="community-cancel">Cancel</button><button type="submit" class="btn btn-primary">Publish post <span class="arrow">→</span></button></div><p class="form-footnote">Use a public campus location. Avoid posting private contact details.</p></form>';
  }
  function communityScreen() {
    const types=[["All","All posts"],["offer","Offers"],["need","Needs"],["mine","My posts"]];
    const tabs=types.map(t=>'<button type="button" class="community-type-tab'+(state.communityType===t[0]?' active':'')+'" data-action="community-type" data-id="'+esc(t[0])+'">'+esc(t[1])+(t[0]==="All"?'<span>'+state.communityPosts.length+'</span>':'')+'</button>').join("");
    let posts;
    if(state.communityLoading) posts='<div class="resource-state"><span class="spinner"></span><strong>Loading campus posts</strong><p>Checking what students can offer and what they need…</p></div>';
    else if(state.communityError) posts='<div class="resource-state"><strong>Community posts didn’t load.</strong><p>'+esc(state.communityError)+'</p><button type="button" class="btn btn-outline" data-action="community">Try again</button></div>';
    else if(!state.communityPosts.length) posts='<div class="resource-state"><div class="empty-mark">♧</div><strong>Nothing here just yet</strong><p>'+(state.communityType==="mine"?"Posts you publish will be saved here.":"Be the first to offer something useful or ask for help.")+'</p><button type="button" class="btn btn-primary" data-action="community-new-post">Create a post <span class="arrow">→</span></button></div>';
    else posts='<div class="community-post-grid">'+state.communityPosts.map(communityPostCard).join("")+'</div>';
    const content='<section class="community-hero"><div><p class="workspace-eyebrow">BETTER, TOGETHER</p><h1>Offers & needs</h1><p>Small acts of sharing make campus life easier. Offer something, ask for help, or help someone nearby.</p><div class="community-hero-tags"><span>✳ Peer-powered</span><span>♧ Campus-wide</span><span>✓ Verified community</span></div></div><div class="community-hero-art" aria-hidden="true"><span class="community-art-orbit"></span><span class="community-art-card art-one">↗<small>OFFER</small></span><span class="community-art-card art-two">⌕<small>NEED</small></span><div class="community-art-message"><span>✳</span><strong>What goes around,<br>helps someone learn.</strong></div></div></section>'+(state.communityToast?'<div class="workspace-flash community-toast" role="status">'+esc(state.communityToast)+'</div>':'')+(state.communityFormOpen?communityPostForm():'')+'<section class="community-board"><div class="community-board-heading"><div><p class="section-overline">THE STUDENT COMMUNITY</p><h2>What’s happening on campus?</h2></div><button type="button" class="btn btn-primary" data-action="community-new-post">＋ Create a post</button></div><form class="community-search-form" id="community-search-form"><span>⌕</span><input name="q" type="search" value="'+esc(state.communitySearch)+'" placeholder="Search offers, needs, and campus posts…" aria-label="Search community posts"><button type="submit">Search</button></form><div class="community-filter-row"><div class="community-type-tabs">'+tabs+'</div>'+communityCategoryChips(state.communityCategory)+'</div>'+posts+'</section>';
    appShell(content,"community");
  }
  async function loadPickupLocations() {
    state.screen="map";state.pickupsLoading=true;state.pickupsError="";state.workspaceMessage="";
    render();
    try {
      const result=await api("/pickup-locations",null,"GET");
      state.pickupPoints=Array.isArray(result.locations)?result.locations:[];
      if(!state.pickupPoints.some(p=>p.id===state.pickupSelectedId)) state.pickupSelectedId=state.pickupPoints[0]?state.pickupPoints[0].id:"";
    } catch(e) { state.pickupsError=e.message||"Please try again.";state.pickupPoints=[]; }
    finally { state.pickupsLoading=false;render(); }
  }
  async function loadCommunity() {
    state.screen="community";state.communityLoading=true;state.communityError="";state.workspaceMessage="";
    render();
    try {
      const params=new URLSearchParams();
      params.set("type",state.communityType);params.set("category",state.communityCategory);params.set("q",state.communitySearch);
      const result=await api("/community/posts?"+params.toString(),null,"GET");
      state.communityPosts=Array.isArray(result.posts)?result.posts:[];
    } catch(e) { state.communityError=e.message||"Please try again.";state.communityPosts=[]; }
    finally { state.communityLoading=false;render(); }
  }
  async function createCommunityPost(form) {
    const fd=new FormData(form);
    const payload={type:fd.get("type"),title:fd.get("title"),category:fd.get("category"),description:fd.get("description"),pickupLocation:fd.get("pickupLocation")};
    state.communitySubmitting=true;
    const submit=form.querySelector('button[type="submit"]');if(submit){submit.disabled=true;submit.textContent="Publishing…";}
    try {
      const result=await api("/community/posts",payload,"POST");
      state.communityType="mine";state.communityCategory="All";state.communitySearch="";
      state.communityFormOpen=false;state.communityToast=result.message||"Your post is on the community board.";
      await loadCommunity();
    } catch(e) {
      const slot=root.querySelector("#community-form-message");
      if(slot) slot.innerHTML='<div class="workspace-form-error" role="alert">'+esc(e.message||"We couldn’t publish your post.")+'</div>';
      if(submit){submit.disabled=false;submit.textContent="Publish post →";}
    } finally { state.communitySubmitting=false; }
  }
  async function communityInterest(id) {
    if(!id)return;
    try {
      const result=await api("/community/posts/"+encodeURIComponent(id)+"/interest",{},"POST");
      state.communityToast=result.alreadyInterested?"You’ve already expressed interest.":"Interest saved. Your interest is visible on this post.";
      await loadCommunity();
    } catch(e) { state.communityToast=e.message||"We couldn’t save your interest.";render(); }
  }
  async function closeCommunityPost(id) {
    if(!id)return;
    try {
      const result=await api("/community/posts/"+encodeURIComponent(id)+"/close",{},"POST");
      state.communityToast=result.message||"Post updated.";
      await loadCommunity();
    } catch(e) { state.communityToast=e.message||"We couldn’t update your post.";render(); }
  }

  function requestStatusLabel(status) {
    return ({ pending:"Pending", approved:"Approved", declined:"Declined", active:"In progress", completed:"Completed", cancelled:"Cancelled" })[status] || "Pending";
  }
  function requestListCard(item) {
    const resource = item.resource || {};
    const hasMessages = Boolean(item.messagesAvailable);
    const icon = resource.icon || categoryIcon(resource.category);
    const sampleNote = hasMessages ? "" : '<p class="request-sample-note">Preview sample listing · no live owner account</p>';
    return '<article class="request-card"><div class="request-art cover-' + esc(({Books:"books","Lab Equipment":"lab",Electronics:"electronics",Stationery:"stationery"})[resource.category] || "other") + '"><span>' + esc(icon) + '</span></div><div class="request-card-main"><div class="request-card-top"><span class="request-category">' + esc(resource.category || "Resource") + '</span><span class="request-status status-' + esc(item.status) + '">' + esc(requestStatusLabel(item.status)) + '</span></div><h3>' + esc(resource.title || "Campus resource") + '</h3><p>' + esc(resource.pickupLocation || "Campus pickup") + ' <span>·</span> ' + esc(priceLabel(resource)) + '</p><small>Requested ' + esc(new Date(item.createdAt).toLocaleDateString(undefined,{day:"numeric",month:"short",year:"numeric"})) + '</small>' + sampleNote + '</div><div class="request-card-actions">' + (hasMessages ? '<button type="button" class="btn btn-outline" data-action="open-thread" data-id="' + esc(item.requestId) + '">Message owner</button>' : '<button type="button" class="btn btn-outline" data-action="resource" data-id="' + esc(resource.id) + '">View item</button>') + '</div></article>';
  }
  function myRequestsScreen() {
    const filters=["All","pending","approved","active","completed","declined"];
    const items=state.requestFilter==="All" ? state.myRequests : state.myRequests.filter(x=>x.status===state.requestFilter);
    const filterLabels={All:"All",pending:"Pending",approved:"Approved",active:"Active",completed:"Completed",declined:"Declined"};
    const tabs=filters.map(function(f){return '<button type="button" class="request-filter' + (state.requestFilter===f ? ' active' : '') + '" data-action="request-filter" data-id="' + esc(f) + '">' + esc(filterLabels[f]||f) + (f==="All" ? '<span>' + state.myRequests.length + '</span>' : '') + '</button>';}).join("");
    let body;
    if(state.requestsLoading) body='<div class="resource-state"><span class="spinner"></span><strong>Loading your requests</strong><p>Checking your campus activity…</p></div>';
    else if(state.requestsError) body='<div class="resource-state"><strong>Your requests didn’t load.</strong><p>' + esc(state.requestsError) + '</p><button type="button" class="btn btn-outline" data-action="my-requests">Try again</button></div>';
    else if(!items.length) body='<div class="resource-state"><div class="empty-mark">▤</div><strong>' + (state.myRequests.length ? "No requests in this category" : "No requests yet") + '</strong><p>' + (state.myRequests.length ? "Choose another status to see your activity." : "When you request a campus resource, it will appear here with its latest status.") + '</p><button type="button" class="btn btn-primary" data-action="explore">Explore resources <span class="arrow">→</span></button></div>';
    else body='<div class="request-list">' + items.map(requestListCard).join("") + '</div>';
    const content='<section class="workspace-page-heading"><p class="workspace-eyebrow">YOUR CAMPUS ACTIVITY</p><div class="workspace-heading-row"><div><h1>My Requests</h1><p>Keep track of the resources you’ve asked to borrow or share.</p></div><span class="request-count">' + state.myRequests.length + '<small>Total</small></span></div></section><section class="request-panel"><div class="request-filters">' + tabs + '</div>' + body + '</section>';
    appShell(content,"requests");
  }
  function messageThreadCard(thread) {
    const initial=(thread.otherName || "S").trim().split(/\s+/).map(x=>x.charAt(0)).slice(0,2).join("").toUpperCase();
    const preview=thread.lastMessage || "Start the conversation";
    const when=thread.lastMessageAt ? new Date(thread.lastMessageAt).toLocaleDateString(undefined,{day:"numeric",month:"short"}) : requestStatusLabel(thread.status);
    return '<button type="button" class="message-thread-card' + (state.selectedThreadId===thread.requestId ? ' selected' : '') + '" data-action="open-thread" data-id="' + esc(thread.requestId) + '"><span class="thread-avatar">' + esc(initial) + '</span><span class="thread-card-copy"><strong>' + esc(thread.otherName) + '</strong><small>' + esc(thread.resourceTitle) + '</small><span>' + esc(preview) + '</span></span><span class="thread-card-meta">' + esc(when) + (thread.unreadCount ? '<i>' + esc(thread.unreadCount) + '</i>' : '') + '</span></button>';
  }
  function chatMessage(message) {
    const time=new Date(message.createdAt).toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"});
    return '<div class="chat-message-row ' + (message.isMine ? 'mine' : 'theirs') + '"><div class="chat-message"><p>' + esc(message.body) + '</p><small>' + (message.isMine ? 'You' : esc(message.senderName)) + ' · ' + esc(time) + '</small></div></div>';
  }
  function messagesScreen() {
    const threads=state.messageThreads;
    const thread=state.activeThread;
    let sidebar;
    if(state.threadsLoading) sidebar='<div class="thread-empty"><span class="spinner"></span><p>Loading conversations…</p></div>';
    else if(state.threadsError) sidebar='<div class="thread-empty"><p>' + esc(state.threadsError) + '</p><button class="btn btn-outline" data-action="messages">Try again</button></div>';
    else if(!threads.length) sidebar='<div class="thread-empty"><div class="empty-mark">◌</div><strong>No conversations yet</strong><p>Message threads appear when a student requests your listing or you request another student’s resource.</p><button type="button" class="btn btn-outline" data-action="add-resource">List a resource</button></div>';
    else sidebar='<div class="message-thread-list">' + threads.map(messageThreadCard).join("") + '</div>';
    let conversation;
    if(state.threadLoading) conversation='<div class="conversation-placeholder"><span class="spinner"></span><p>Opening conversation…</p></div>';
    else if(thread) {
      const history=state.threadMessages.length ? state.threadMessages.map(chatMessage).join("") : '<div class="chat-empty"><span>✳</span><strong>Start with a friendly hello.</strong><p>Keep exchange details clear and meet at a public campus pickup point.</p></div>';
      conversation='<div class="conversation-header"><button type="button" class="thread-back" data-action="close-thread">← All messages</button><span class="thread-avatar large">' + esc((thread.otherName||"S").trim().split(/\s+/).map(x=>x.charAt(0)).slice(0,2).join("").toUpperCase()) + '</span><div><strong>' + esc(thread.otherName || "Student") + '</strong><small>' + esc(thread.resourceTitle) + ' · ' + esc(requestStatusLabel(thread.status)) + '</small></div></div><div class="conversation-history" id="conversation-history">' + history + '</div><form class="message-compose" id="thread-message-form"><textarea name="body" rows="1" maxlength="1200" placeholder="Write a message…" required></textarea><button class="btn btn-primary" type="submit" ' + (state.messageSending ? 'disabled' : '') + ' aria-label="Send message">→</button></form>';
    } else conversation='<div class="conversation-placeholder"><div class="empty-mark">◌</div><strong>Your conversations, together.</strong><p>Choose a conversation to view messages, or list a resource to start an exchange with another student.</p></div>';
    const content='<section class="workspace-page-heading"><p class="workspace-eyebrow">STUDENT-TO-STUDENT</p><h1>Messages</h1><p>Coordinate the small details that make sharing simple.</p></section><section class="messages-layout"><aside class="messages-list-panel"><div class="messages-list-heading"><strong>Conversations</strong><span>' + threads.length + '</span></div>' + sidebar + '</aside><section class="conversation-panel">' + conversation + '</section></section>';
    appShell(content,"messages");
    const history=root.querySelector("#conversation-history");
    if(history) history.scrollTop=history.scrollHeight;
  }
  async function loadMyRequests() {
    state.screen="my-requests"; state.requestsLoading=true; state.requestsError=""; state.workspaceMessage="";
    render();
    try {
      const result=await api("/my-requests",null,"GET");
      state.myRequests=Array.isArray(result.requests)?result.requests:[];
    } catch(e) { state.requestsError=e.message || "Please try again."; state.myRequests=[]; }
    finally { state.requestsLoading=false; render(); }
  }
  async function loadMessages() {
    state.screen="messages"; state.threadsLoading=true; state.threadsError=""; state.workspaceMessage="";
    render();
    try {
      const result=await api("/messages",null,"GET");
      state.messageThreads=Array.isArray(result.threads)?result.threads:[];
      if(state.selectedThreadId && !state.messageThreads.some(t=>t.requestId===state.selectedThreadId)) {
        state.selectedThreadId=""; state.activeThread=null; state.threadMessages=[];
      }
    } catch(e) { state.threadsError=e.message || "Please try again."; state.messageThreads=[]; }
    finally { state.threadsLoading=false; render(); }
  }
  async function openMessageThread(requestId) {
    if(!requestId) return;
    state.screen="messages"; state.selectedThreadId=requestId; state.activeThread=null;
    state.threadMessages=[]; state.threadLoading=true; state.workspaceMessage="";
    render();
    try {
      if(!state.messageThreads.some(t=>t.requestId===requestId)) {
        const index=await api("/messages",null,"GET");
        state.messageThreads=Array.isArray(index.threads)?index.threads:[];
      }
      const result=await api("/messages/"+encodeURIComponent(requestId),null,"GET");
      state.activeThread=state.messageThreads.find(t=>t.requestId===requestId) || result.thread || null;
      if(state.activeThread && result.thread) Object.assign(state.activeThread,result.thread);
      state.threadMessages=Array.isArray(result.messages)?result.messages:[];
    } catch(e) { state.workspaceMessage=e.message || "This conversation is unavailable."; }
    finally { state.threadLoading=false; render(); }
  }
  async function publishResource(form) {
    const fd=new FormData(form);
    const payload={title:fd.get("title"),category:fd.get("category"),description:fd.get("description"),condition:fd.get("condition"),lendingType:fd.get("lendingType"),priceAmount:Number(fd.get("priceAmount")||0),pickupLocation:fd.get("pickupLocation"),distanceLabel:fd.get("distanceLabel")};
    const submit=form.querySelector('button[type="submit"]');
    if(submit){submit.disabled=true;submit.textContent="Publishing…";}
    try {
      const result=await api("/resources",payload,"POST");
      state.workspaceMessage=result.message || "Your resource is listed.";
      state.category="All";state.search="";
      await refreshResources();
      state.screen="home";render();
    } catch(e) {
      const slot=root.querySelector("#listing-message");
      if(slot) slot.innerHTML='<div class="workspace-form-error" role="alert">'+esc(e.message || "We couldn’t publish this listing.")+'</div>';
      if(submit){submit.disabled=false;submit.textContent="Publish listing →";}
    }
  }
  async function sendCurrentMessage(form) {
    if(!state.selectedThreadId || state.messageSending) return;
    const fd=new FormData(form);
    const textBody=String(fd.get("body")||"").trim();
    if(!textBody) return;
    state.messageSending=true;
    const submit=form.querySelector('button[type="submit"]'); if(submit)submit.disabled=true;
    let sendError="";
    try {
      const result=await api("/messages/"+encodeURIComponent(state.selectedThreadId),{body:textBody},"POST");
      if(result.message) state.threadMessages.push(result.message);
      if(state.activeThread) { state.activeThread.lastMessage=textBody; state.activeThread.lastMessageAt=result.message && result.message.createdAt; }
      state.workspaceMessage="";
    } catch(e) { sendError=e.message || "Your message couldn’t be sent."; }
    finally {
      state.messageSending=false;
      await loadMessages();
      if(state.selectedThreadId) await openMessageThread(state.selectedThreadId);
      if(sendError) { state.workspaceMessage=sendError; render(); }
    }
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
      state.workspaceMessage = result.alreadyRequested ? "You’ve already requested this resource." : "Request sent. Open My Requests to track its status.";
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
    if (state.screen === "map") return pickupMapScreen();
    if (state.screen === "community") return communityScreen();
    if (state.screen === "listing") return addResourceScreen();
    if (state.screen === "my-requests") return myRequestsScreen();
    if (state.screen === "messages") return messagesScreen();
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
    if (form.id === "community-post-form") {
      await createCommunityPost(form);
    } else if (form.id === "community-search-form") {
      state.communitySearch=String(fd.get("q")||"").trim().slice(0,100);
      await loadCommunity();
    } else if (form.id === "search-form" || form.id === "hero-search-form") {
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
    } else if (form.id === "listing-form") {
      await publishResource(form);
    } else if (form.id === "thread-message-form") {
      await sendCurrentMessage(form);
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

    if (name === "map") { await loadPickupLocations(); return; }
    if (name === "community") { state.communityFormOpen=false; await loadCommunity(); return; }
    if (name === "open-more") {
      const menu=root.querySelector("#mobile-more-menu"), control=root.querySelector('[data-action="open-more"]');
      if(menu) menu.classList.toggle("open");
      if(control) control.setAttribute("aria-expanded",menu&&menu.classList.contains("open")?"true":"false");
      return;
    }
    if (name === "close-more") {
      const menu=root.querySelector("#mobile-more-menu"), control=root.querySelector('[data-action="open-more"]');
      if(menu) menu.classList.remove("open");
      if(control) control.setAttribute("aria-expanded","false");
      return;
    }
    if (name === "refresh-pickups") { await loadPickupLocations(); return; }
    if (name === "select-pickup") { state.pickupSelectedId=id||"";render();return; }
    if (name === "browse-pickup") {
      const point=state.pickupPoints.find(p=>p.id===state.pickupSelectedId);
      if(point){state.search=point.name;state.category="All";state.screen="explore";refreshResources();}
      return;
    }
    if (name === "community-type") { state.communityType=id||"All";await loadCommunity();return; }
    if (name === "community-category") { state.communityCategory=id||"All";await loadCommunity();return; }
    if (name === "community-new-post") { state.communityFormOpen=!state.communityFormOpen;render();return; }
    if (name === "community-cancel") { state.communityFormOpen=false;render();return; }
    if (name === "community-interest") { await communityInterest(id);return; }
    if (name === "close-community-post") { await closeCommunityPost(id);return; }
    if (name === "explore") { state.screen = "explore"; render(); refreshResources(); return; }
    if (name === "add-resource") { state.workspaceMessage=""; navigate("listing"); return; }
    if (name === "my-requests") { await loadMyRequests(); return; }
    if (name === "messages") { await loadMessages(); return; }
    if (name === "request-filter") { state.requestFilter=id || "All"; render(); return; }
    if (name === "open-thread") { await openMessageThread(id); return; }
    if (name === "close-thread") { state.selectedThreadId=""; state.activeThread=null; state.threadMessages=[]; await loadMessages(); return; }
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