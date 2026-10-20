(() => {
  "use strict";
  const API = "/api/gyanshala";
  const APP = "/gyanshala-demo/";
  const root = document.getElementById("app");
  const state = { screen: "splash", mode: "signup", email: "", challengeId: "", user: null, setup: null, message: "", messageType: "info", busy: false, installPrompt: null, resources: [], activeResource: null, selectedResourceId: "", search: "", category: "All", resourcesLoading: false, resourcesError: "", detailLoading: false, workspaceMessage: "", myRequests: [], requestsLoading: false, requestsError: "", requestFilter: "All", messageThreads: [], threadsLoading: false, threadsError: "", selectedThreadId: "", activeThread: null, threadMessages: [], threadLoading: false, messageSending: false, pickupPoints: [], pickupSelectedId: "", pickupsLoading: false, pickupsError: "", communityPosts: [], communityLoading: false, communityError: "", communityType: "All", communityCategory: "All", communitySearch: "", communityFormOpen: false, communitySubmitting: false, communityToast: "", mapSearch: "", mapFocusId: "", incomingRequests: [], requestScope: "sent", trackingRequestId: "", trackingLoading: false, trackingError: "", trackingInfo: null, trackingMapInstance: null, trackingMapMarkers: {}, trackingMapRequestId: "", googleMapsPromise: null, trackingPollTimer: null, locationWatchId: null, trackingShareEnabled: false, trackingLocationError: "", trackingLocationBusy: false, campusMapInstance: null, campusMapLib: null, campusMapStylesPromise: null, campusMapLibPromise: null, campusMapGeneration: 0, campusMapView: null, campusMapMarkers: [], map3dEnabled: false, map3dAvailable: false, mapBuildingLayerId: "", supplyQuery: "", supplyHostels: [], supplyHostelsLoading: false, supplyOriginHostelId: "", supplyLatitude: null, supplyLongitude: null, supplyUsingGps: false, supplyLoading: false, supplyError: "", supplyResults: null, supplySelectedId: "", supplyBusyId: "", supplyReservations: [], supplyToast: "" };
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
    root.innerHTML = '<div class="campus-app"><header class="campus-header"><a class="campus-brand" href="/gyanshala-demo/" data-action="home">' + logo + '<span>Gyanshala<small>Campus, together</small></span></a><form class="campus-search" id="search-form"><span class="search-glyph" aria-hidden="true">⌕</span><input type="search" name="q" value="' + esc(state.search) + '" placeholder="Search books, equipment, and more…" aria-label="Search campus resources"><button type="submit" aria-label="Submit search">Search</button></form><div class="campus-user"><span class="campus-avatar">' + esc(initials) + '</span><span class="campus-user-copy"><strong>' + esc(name) + '</strong><small>' + esc(user.branch || "Verified student") + '</small></span><button class="signout-link" type="button" data-action="logout">Sign out</button></div></header><div class="campus-layout"><aside class="campus-sidebar"><p class="sidebar-label">WORKSPACE</p><button type="button" class="sidebar-link' + (active === "home" ? " selected" : "") + '" data-action="home"><span>⌂</span>Home</button><button type="button" class="sidebar-link' + (active === "explore" ? " selected" : "") + '" data-action="explore"><span>⌕</span>Explore resources</button><button type="button" class="sidebar-link' + (active === "supply" ? " selected" : "") + '" data-action="supply-finder"><span>✦</span>AI Supply Finder</button><button type="button" class="sidebar-link' + (active === "map" ? " selected" : "") + '" data-action="map"><span>⌖</span>Track exchanges</button><button type="button" class="sidebar-link' + (active === "community" ? " selected" : "") + '" data-action="community"><span>♧</span>Community</button><button type="button" class="sidebar-link' + (active === "list" ? " selected" : "") + '" data-action="add-resource"><span>＋</span>List a resource</button><button type="button" class="sidebar-link' + (active === "requests" ? " selected" : "") + '" data-action="my-requests"><span>▤</span>My Requests</button><button type="button" class="sidebar-link' + (active === "messages" ? " selected" : "") + '" data-action="messages"><span>◌</span>Messages</button><div class="sidebar-spacer"></div><div class="sidebar-note"><span class="sidebar-note-icon">✳</span><strong>Share more. Waste less.</strong><p>Good resources deserve more than one life.</p></div><div class="sidebar-account"><span class="account-check">✓</span><span><strong>Verified student</strong><small>' + esc(user.email || "") + '</small></span></div></aside><section class="campus-main"><div class="campus-content">' + (state.workspaceMessage ? '<div class="workspace-flash" role="status">' + esc(state.workspaceMessage) + '</div>' : '') + content + '</div></section></div><nav class="campus-mobile-nav"><button type="button" class="' + (active === "home" ? "selected" : "") + '" data-action="home"><span>⌂</span>Home</button><button type="button" class="' + (active === "explore" ? "selected" : "") + '" data-action="explore"><span>⌕</span>Explore</button><button type="button" class="' + (active === "map" ? "selected" : "") + '" data-action="map"><span>⌖</span>Track</button><button type="button" class="' + (active === "community" ? "selected" : "") + '" data-action="community"><span>♧</span>Community</button><button type="button" data-action="open-more" aria-expanded="false"><span>•••</span>More</button></nav><div class="mobile-more-menu" id="mobile-more-menu" aria-label="More navigation"><button type="button" data-action="supply-finder"><span>✦</span><span><strong>AI Supply Finder</strong><small>Find the nearest available item</small></span></button><button type="button" data-action="add-resource"><span>＋</span><span><strong>List a resource</strong><small>Share an item with campus</small></span></button><button type="button" data-action="my-requests"><span>▤</span><span><strong>My Requests</strong><small>Follow your borrowing activity</small></span></button><button type="button" data-action="messages"><span>◌</span><span><strong>Messages</strong><small>Chat with another student</small></span></button><button type="button" data-action="close-more"><span>×</span><span><strong>Close menu</strong><small>Return to the current screen</small></span></button></div><footer class="campus-footer"><span>Gyanshala <span class="footer-dot">·</span> Built for your campus</span><span>Preview experience <span class="footer-dot">·</span> Student access</span></footer></div>';
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
    const content = '<section class="workspace-page-heading"><p class="workspace-eyebrow">GIVE GOOD THINGS ANOTHER LIFE</p><h1>List a resource</h1><p>Share something useful with your campus community. Students will see the details before requesting it.</p></section><section class="listing-layout"><div class="listing-intro-card"><span class="listing-art-icon">＋</span><h2>Someone nearby<br>might need this.</h2><p>Books, lab essentials and everyday study tools can go further when students share them.</p><div class="listing-tip"><span>✧</span><div><strong>A little detail goes a long way</strong><p>Add a clear description and a public campus pickup point.</p></div></div><div class="listing-tip"><span>⌖</span><div><strong>Keep exchanges safe</strong><p>Use a shared campus location. Never include passwords or sensitive personal details.</p></div></div></div><form class="listing-form" id="listing-form"><div class="listing-form-header"><div><p class="section-overline">RESOURCE DETAILS</p><h2>What are you sharing?</h2></div><span class="required-note">* Required</span></div><div id="listing-message"></div><label class="field"><span>Resource title *</span><input name="title" type="text" minlength="3" maxlength="100" placeholder="e.g. Engineering Drawing Kit" required></label><div class="field-row"><label class="field"><span>Category *</span><select name="category" required><option value="">Choose a category</option><option>Books</option><option>Lab Equipment</option><option>Electronics</option><option>Stationery</option></select></label><label class="field"><span>Condition *</span><select name="condition" required><option>Good</option><option>New</option><option>Very good</option><option>Fair</option></select></label></div><label class="field"><span>Description *</span><textarea name="description" minlength="8" maxlength="1500" rows="4" placeholder="What is included? What should a student know before requesting it?" required></textarea><small>8–1,500 characters.</small></label><div class="listing-form-divider"></div><p class="section-overline">SHARING PREFERENCES</p><label class="field"><span>How would you like to share it? *</span><select name="lendingType" id="listing-lending-type" required><option value="lend">Lend · return it later</option><option value="free">Give away · free</option><option value="sell">Sell · one-time price</option></select></label><div class="field-row"><label class="field"><span>Amount (₹)</span><input name="priceAmount" id="listing-price" type="number" min="0" max="1000000" step="1" value="0" required><small>Free items are saved at ₹0.</small></label><label class="field"><span>Campus pickup point *</span><select name="pickupLocation" required><option value="">Choose a mapped campus place</option><option>NIT Silchar Campus</option><option>NITS Cricket Playground</option><option>NITS Football Ground</option><option>Indie Lake</option><option>NITS Childrens Park</option><option>NITS Mini Park</option><option>Football Ground Lake</option></select><small>Choose a mapped landmark, then agree the exact public meeting spot with the other student.</small></label></div><div id="listing-message-bottom"></div><button class="btn btn-primary full" type="submit">Publish listing <span class="arrow">→</span></button><p class="form-footnote">Your listing will be linked to your Gyanshala account and stored in the campus resource catalogue.</p></form></section>';
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


  const CAMPUS_MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
  const CAMPUS_MAP_MODULE = "https://unpkg.com/maplibre-gl@6.9.1/dist/maplibre-gl.mjs";
  const CAMPUS_CENTER = [92.78682, 24.7551];
  function releaseCampusMap() {
    state.campusMapGeneration += 1;
    const oldMap=state.campusMapInstance;
    if(oldMap) {
      try {
        const c=oldMap.getCenter();
        state.campusMapView={center:[c.lng,c.lat],zoom:oldMap.getZoom(),pitch:oldMap.getPitch(),bearing:oldMap.getBearing()};
        oldMap.remove();
      } catch {}
    }
    state.campusMapInstance=null;
    state.campusMapMarkers=[];
  }
  function ensureMapLibreCss() {
    if(state.campusMapStylesPromise) return state.campusMapStylesPromise;
    state.campusMapStylesPromise=new Promise(function(resolve) {
      if(document.getElementById("gyanshala-maplibre-css")) { resolve(true); return; }
      const link=document.createElement("link");
      link.id="gyanshala-maplibre-css";
      link.rel="stylesheet";
      link.href="https://unpkg.com/maplibre-gl@6.9.1/dist/maplibre-gl.css";
      link.onload=function(){resolve(true);};
      link.onerror=function(){resolve(false);};
      document.head.appendChild(link);
    });
    return state.campusMapStylesPromise;
  }
  function loadMapLibre() {
    if(!state.campusMapLibPromise) state.campusMapLibPromise=import(CAMPUS_MAP_MODULE);
    return state.campusMapLibPromise;
  }
  function campusPointIcon(point) {
    const area=String(point.area||"").toLowerCase();
    if(area.includes("sport")) return "◇";
    if(area.includes("park")) return "✳";
    if(area.includes("lake")||area.includes("natural")) return "≈";
    return "⌖";
  }
  function pointPopupHtml(point) {
    return '<div class="campus-popup"><span class="campus-popup-type">'+esc(point.area||"Campus place")+'</span><strong>'+esc(point.name)+'</strong><p>'+esc(point.description)+'</p><small>'+Number(point.resourceCount||0)+' mapped Gyanshala '+(Number(point.resourceCount)===1?'resource':'resources')+'</small></div>';
  }
  function addCampusPointMarkers(map, lib) {
    state.campusMapMarkers.forEach(function(marker){try{marker.remove();}catch{}});
    state.campusMapMarkers=[];
    state.pickupPoints.forEach(function(point) {
      const lat=Number(point.latitude),lng=Number(point.longitude);
      if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180) return;
      const el=document.createElement("button");
      el.type="button";
      el.className="campus-map-marker"+(point.id===state.pickupSelectedId?" selected":"");
      el.setAttribute("aria-label",point.name);
      el.title=point.name;
      el.innerHTML='<span class="campus-marker-core">'+esc(campusPointIcon(point))+'</span><span class="campus-marker-label">'+esc(point.name)+'</span>';
      el.addEventListener("click",function(event) {
        event.preventDefault();event.stopPropagation();
        state.pickupSelectedId=point.id;state.mapFocusId=point.id;
        render();
      });
      const popup=new lib.Popup({offset:26,closeButton:true,maxWidth:"285px"}).setHTML(pointPopupHtml(point));
      const marker=new lib.Marker({element:el,anchor:"bottom"}).setLngLat([lng,lat]).setPopup(popup).addTo(map);
      state.campusMapMarkers.push(marker);
    });
  }
  function configureCampus3DBuildings(map) {
    const layers=(map.getStyle()&&map.getStyle().layers)||[];
    const existing=layers.find(function(layer){return layer.type==="fill-extrusion"&&/building/i.test(layer.id);});
    if(existing) {
      state.mapBuildingLayerId=existing.id;state.map3dAvailable=true;
      map.setLayoutProperty(existing.id,"visibility",state.map3dEnabled?"visible":"none");
      return true;
    }
    const building=layers.find(function(layer){return layer.source&&layer["source-layer"]&&String(layer["source-layer"]).toLowerCase()==="building"&&layer.type==="fill";});
    if(!building) { state.map3dAvailable=false;state.mapBuildingLayerId="";return false; }
    const before=(layers.find(function(layer){return layer.type==="symbol";})||{}).id;
    const id="gyanshala-campus-buildings-3d";
    try {
      map.addLayer({
        id:id,type:"fill-extrusion",source:building.source,"source-layer":building["source-layer"],
        filter:["all",["==",["geometry-type"],"Polygon"],["any",["has","render_height"],["has","height"]]],minzoom:15,
        paint:{
          "fill-extrusion-color":"#cbd9ea",
          "fill-extrusion-height":["coalesce",["to-number",["get","render_height"]],["to-number",["get","height"]]],
          "fill-extrusion-base":["coalesce",["to-number",["get","render_min_height"]],["to-number",["get","min_height"]],0],
          "fill-extrusion-opacity":0.84
        },
        layout:{"visibility":state.map3dEnabled?"visible":"none"}
      },before);
      state.mapBuildingLayerId=id;state.map3dAvailable=true;
      return true;
    } catch {
      state.map3dAvailable=false;state.mapBuildingLayerId="";
      return false;
    }
  }
  async function initializeCampusMap() {
    const container=root.querySelector("#campus-real-map");
    if(!container) return;
    const generation=state.campusMapGeneration;
    const status=root.querySelector("#campus-map-status");
    const setStatus=function(message,kind) {
      const el=root.querySelector("#campus-map-status");
      if(!el)return;
      el.className="campus-map-status"+(kind?" "+kind:"");
      el.textContent=message;
      el.hidden=!message;
    };
    let mapLoaded=false;
    let loadTimer=0;
    const showMapFallback=function(message) {
      if(generation!==state.campusMapGeneration||!root.contains(container)) return;
      setStatus(message,"error");
      const fallback=root.querySelector("#campus-map-fallback");
      if(fallback)fallback.hidden=false;
      const viewport=root.querySelector(".campus-map-viewport");
      if(viewport)viewport.classList.remove("maplibre-ready");
      const legend=root.querySelector(".map-loaded-indicator");
      if(legend)legend.innerHTML="<i></i>Standard map";
    };
    setStatus("Opening campus map…","loading");
    loadTimer=window.setTimeout(function() {
      if(!mapLoaded) showMapFallback("The enhanced map is taking too long. The standard OpenStreetMap view is available below.");
    },10000);
    try {
      const cssReady=await Promise.race([
        ensureMapLibreCss(),
        new Promise(function(_,reject){window.setTimeout(function(){reject(new Error("Map styles timed out"));},8000);})
      ]);
      const lib=await Promise.race([
        loadMapLibre(),
        new Promise(function(_,reject){window.setTimeout(function(){reject(new Error("Map library timed out"));},10000);})
      ]);
      if(generation!==state.campusMapGeneration||!root.contains(container)) return;
      if(!cssReady) setStatus("Map controls may look unstyled; loading the map…","loading");
      const view=state.campusMapView||{center:CAMPUS_CENTER,zoom:16.25,pitch:0,bearing:0};
      const map=new lib.Map({
        container:container,style:CAMPUS_MAP_STYLE,center:view.center||CAMPUS_CENTER,zoom:view.zoom||16.25,
        pitch:view.pitch||0,bearing:view.bearing||0,minZoom:12,maxZoom:21,
        attributionControl:false,dragRotate:true,renderWorldCopies:false
      });
      state.campusMapInstance=map;state.campusMapLib=lib;
      map.addControl(new lib.NavigationControl({showCompass:true,showZoom:true,visualizePitch:true}),"top-right");
      map.addControl(new lib.GeolocateControl({
        positionOptions:{enableHighAccuracy:true,timeout:10000},trackUserLocation:false,showUserHeading:true
      }),"top-right");
      map.addControl(new lib.AttributionControl({
        compact:true,customAttribution:'<a href="https://openfreemap.org/" target="_blank" rel="noopener noreferrer">OpenFreeMap</a>'
      }),"bottom-right");
      map.on("load",function() {
        if(generation!==state.campusMapGeneration||state.campusMapInstance!==map)return;
        mapLoaded=true;
        if(loadTimer)window.clearTimeout(loadTimer);
        const viewport=root.querySelector(".campus-map-viewport");
        if(viewport)viewport.classList.add("maplibre-ready");
        const fallback=root.querySelector("#campus-map-fallback");
        if(fallback)fallback.hidden=true;
        state.map3dAvailable=configureCampus3DBuildings(map);
        addCampusPointMarkers(map,lib);
        setStatus("","success");
        const selected=state.pickupPoints.find(function(point){return point.id===state.pickupSelectedId;});
        if(state.mapFocusId&&selected) {
          map.flyTo({center:[Number(selected.longitude),Number(selected.latitude)],zoom:Math.max(17.1,map.getZoom()),duration:650});
          state.mapFocusId="";
        }
        const legend=root.querySelector(".map-loaded-indicator");
        if(legend)legend.innerHTML="<i></i>Interactive map";
      });
      map.on("moveend",function() {
        if(state.campusMapInstance!==map)return;
        const c=map.getCenter();
        state.campusMapView={center:[c.lng,c.lat],zoom:map.getZoom(),pitch:map.getPitch(),bearing:map.getBearing()};
      });
      map.on("click",function(event) {
        if(generation!==state.campusMapGeneration||state.campusMapInstance!==map)return;
        const features=map.queryRenderedFeatures(event.point)||[];
        const feature=features.find(function(f){return f.properties&&(f.properties.name||f.properties["name:en"]||f.properties.ref);});
        if(!feature)return;
        const props=feature.properties||{};
        const name=props.name||props["name:en"]||props.ref;
        const extra=[props.class,props.subclass,props.amenity,props.shop].filter(Boolean).join(" · ");
        new lib.Popup({closeButton:true,maxWidth:"260px"})
          .setLngLat(event.lngLat)
          .setHTML('<div class="campus-popup"><span class="campus-popup-type">Mapped feature</span><strong>'+esc(name)+'</strong>'+(extra?'<small>'+esc(extra)+'</small>':"")+'<p>Feature label from OpenStreetMap-derived map data. Verify building entrances and access on campus.</p></div>')
          .addTo(map);
      });
      map.on("error",function() {
        if(!mapLoaded&&generation===state.campusMapGeneration)
          setStatus("Connecting to map tiles… the standard map remains available.","loading");
      });
    } catch {
      if(loadTimer)window.clearTimeout(loadTimer);
      if(generation!==state.campusMapGeneration||!root.contains(container)) return;
      showMapFallback("The enhanced map could not load. You can still use the standard OpenStreetMap view below.");
    }
  }
  function trackingHubScreen() {
    const all=state.myRequests.concat(state.incomingRequests);
    const live=all.filter(x=>x.status==="approved"||x.status==="active");
    const pendingReceived=state.incomingRequests.filter(x=>x.status==="pending");
    let content;
    if(state.requestsLoading) content='<div class="resource-state"><span class="spinner"></span><strong>Checking your exchanges…</strong><p>Tracking maps are available only for requests that the owner has accepted.</p></div>';
    else if(state.requestsError) content='<div class="resource-state"><strong>We couldn’t load your exchanges.</strong><p>'+esc(state.requestsError)+'</p><button type="button" class="btn btn-outline" data-action="map">Try again</button></div>';
    else if(!live.length) content='<div class="tracking-empty"><div class="tracking-empty-glyph">⌖</div><p class="section-overline">TRACK WHEN ACCEPTED</p><h2>No active exchange to track</h2><p>Request a resource or list one for other students. Once the owner accepts a request, this area will show its meetup point, live distance and any location updates the two participants choose to share.</p><button type="button" class="btn btn-primary" data-action="'+(pendingReceived.length?"my-requests":"explore")+'">'+(pendingReceived.length?"Review incoming requests":"Explore resources")+' <span class="arrow">→</span></button>'+(pendingReceived.length?'<p class="tracking-pending-note">'+pendingReceived.length+' request'+(pendingReceived.length===1?" is":"s are")+' waiting for your decision.</p>':"")+'</div>';
    else content='<div class="tracking-hub-list">'+live.map(function(item){const res=item.resource||{};return '<article class="tracking-hub-card"><span class="tracking-hub-icon">'+esc(res.icon||"⌖")+'</span><div class="tracking-hub-copy"><span class="request-status status-'+esc(item.status)+'">'+esc(requestStatusLabel(item.status))+'</span><h2>'+esc(res.title||"Campus resource")+'</h2><p>'+esc(res.pickupLocation||"Campus meetup")+' · '+esc(item.role==="owner"?"With "+(item.otherName||"requester"):"With "+(item.otherName||"owner"))+'</p></div><button type="button" class="btn btn-primary" data-action="track-request" data-id="'+esc(item.requestId)+'">Open tracking <span class="arrow">→</span></button></article>';}).join("")+'</div>';
    const contentHtml='<section class="workspace-page-heading"><p class="workspace-eyebrow">ONLY FOR ACCEPTED REQUESTS</p><h1>Track an exchange</h1><p>No generic location pins. Your map appears only for a request that has been accepted, and live locations are shared only by explicit choice.</p></section>'+content;
    appShell(contentHtml,"map");
  }
  function requestTrackingScreen() {
    if(state.trackingLoading) {
      appShell('<section class="workspace-page-heading"><p class="workspace-eyebrow">GYANSHALA EXCHANGE</p><h1>Opening tracking…</h1><p>Loading the accepted request and its meetup point.</p></section><div class="resource-state"><span class="spinner"></span><strong>Preparing your exchange</strong></div>',"map");
      return;
    }
    const info=state.trackingInfo;
    if(state.trackingError||!info) {
      appShell('<section class="workspace-page-heading"><p class="workspace-eyebrow">GYANSHALA EXCHANGE</p><h1>Tracking unavailable</h1><p>'+esc(state.trackingError||"Open an accepted request to track it.")+'</p></section><button type="button" class="btn btn-outline" data-action="map">Back to exchanges</button>',"map");
      return;
    }
    const status=info.status||"pending";
    const statusText={pending:"Waiting for owner approval",approved:"Request accepted · coordinate meetup",active:"Exchange in progress",completed:"Exchange completed",declined:"Request declined",cancelled:"Request cancelled"}[status]||"Exchange update";
    const isLive=status==="approved"||status==="active";
    const locs=Array.isArray(info.locations)?info.locations:[];
    const myLocation=locs.find(x=>x.isMine);
    const otherLocation=locs.find(x=>!x.isMine);
    const metersToMeetup=point=>point&&info.meetup&&Number.isFinite(Number(info.meetup.latitude))&&Number.isFinite(Number(info.meetup.longitude))?haversineMeters(Number(point.latitude),Number(point.longitude),Number(info.meetup.latitude),Number(info.meetup.longitude)):null;
    const distance=myLocation?formatDistance(metersToMeetup(myLocation)):"Not sharing";
    const otherDistance=otherLocation?formatDistance(metersToMeetup(otherLocation)):"Not sharing";
    const now=Date.now();
    const updatedLabel=point=>point?Math.max(0,Math.round((now-Date.parse(point.updatedAt))/1000))+" sec ago":"—";
    const otherName=info.role==="owner"?info.participants.requesterName:info.participants.ownerName;
    const mapsKey=info.googleMapsBrowserKey;
    const directionsUrl=info.meetup&&Number.isFinite(Number(info.meetup.latitude))&&Number.isFinite(Number(info.meetup.longitude))
      ?"https://www.google.com/maps/dir/?api=1&destination="+encodeURIComponent(info.meetup.latitude+","+info.meetup.longitude)+"&travelmode=walking":"https://www.google.com/maps";
    let mapPanel;
    if(!isLive) mapPanel='<div class="tracking-map-ended"><span>✓</span><strong>'+(status==="completed"?"This exchange is complete":"Tracking is not active")+'</strong><p>'+(status==="completed"?"Live location sharing has stopped and shared coordinates have been removed.":"Live tracking opens after the request is accepted.")+'</p><a class="btn btn-outline" href="'+directionsUrl+'" target="_blank" rel="noopener noreferrer">Open meetup in Google Maps ↗</a></div>';
    else if(!mapsKey) mapPanel='<div class="tracking-map-setup"><div class="tracking-map-placeholder">⌖</div><h2>Google Maps needs a browser API key</h2><p>The request flow works, but the in-app map stays disabled until a restricted Google Maps JavaScript API key is configured for this preview. Meanwhile, open the meetup in Google Maps.</p><a class="btn btn-primary" href="'+directionsUrl+'" target="_blank" rel="noopener noreferrer">Open route in Google Maps ↗</a><small>Ask the project admin to configure <code>GYANSHALA_GOOGLE_MAPS_BROWSER_KEY</code>. Never paste the key in a message.</small></div>';
    else mapPanel='<div class="tracking-map-wrap"><div id="tracking-google-map" class="tracking-google-map" role="application" aria-label="Live map for this accepted Gyanshala exchange"></div><div id="tracking-map-status" class="tracking-map-status" role="status" aria-live="polite">Loading Google Maps…</div></div>';
    const locCard=(point,label)=>'<div class="tracking-location-card"><span class="tracking-location-dot '+(point?"shared":"")+'"></span><div><strong>'+esc(label)+'</strong><p>'+(point?esc(formatDistance(metersToMeetup(point)))+' from meetup · updated '+esc(updatedLabel(point)):"Location not shared")+'</p></div></div>';
    const shareAction=state.trackingShareEnabled
      ?'<button type="button" class="btn btn-outline" data-action="stop-location-share">Stop sharing my location</button>'
      :'<button type="button" class="btn btn-primary" data-action="start-location-share">Share my live location</button>';
    const content='<section class="workspace-page-heading tracking-heading"><p class="workspace-eyebrow">REQUEST-BASED LIVE TRACKING</p><button class="back" type="button" data-action="map">← All exchanges</button><div class="tracking-title-row"><div><h1>'+esc(info.resource.title)+'</h1><p>'+esc(info.meetup.name)+' · '+esc(otherName||"Campus student")+'</p></div><span class="request-status status-'+esc(status)+'">'+esc(requestStatusLabel(status))+'</span></div><p class="tracking-status-copy">'+esc(statusText)+'</p></section><section class="tracking-grid"><div class="tracking-map-card"><div class="tracking-map-heading"><div><p class="section-overline">MEETUP MAP</p><h2>'+esc(info.meetup.name)+'</h2></div><a href="'+directionsUrl+'" target="_blank" rel="noopener noreferrer">Directions ↗</a></div>'+mapPanel+'<div class="tracking-location-list">'+locCard(myLocation,"Your location")+(info.role==="owner"?locCard(otherLocation,info.participants.requesterName||"Requester"):locCard(otherLocation,info.participants.ownerName||"Owner"))+'</div><div class="tracking-distance-row"><div><small>Your direct distance to meetup</small><strong id="tracking-your-distance">'+esc(distance)+'</strong></div><div><small>Other participant</small><strong id="tracking-other-distance">'+esc(otherDistance)+'</strong></div></div></div><aside class="tracking-side-card"><p class="section-overline">YOUR CONTROL</p><h2>Share only when you choose</h2><p>Location is shared only with the other participant in this accepted request. Keep this screen open while you want live updates, and stop sharing any time.</p><div class="tracking-share-status" id="tracking-share-status">'+(state.trackingLocationError?esc(state.trackingLocationError):(state.trackingShareEnabled?"Waiting for your GPS fix…":"Your location is private until you enable sharing."))+'</div>'+ (isLive?shareAction:"")+'<div class="tracking-action-divider"></div>'+(status==="approved"?'<button type="button" class="btn btn-primary full" data-action="request-status" data-id="'+esc(info.requestId)+'" data-status="active">Start exchange</button>':"")+(status==="active"?'<button type="button" class="btn btn-primary full" data-action="request-status" data-id="'+esc(info.requestId)+'" data-status="completed">Mark exchange completed</button>':"")+'<p class="tracking-smallprint">Distance shown is a straight-line estimate, not road distance or an ETA. Use Google Maps Directions for walking-route distance. Location records older than two minutes are hidden.</p></aside></section>';
    appShell(content,"map");
    if(isLive&&mapsKey) initializeGoogleTrackingMap(mapsKey,info);
    updateTrackingPolling();
  }
  function haversineMeters(lat1,lon1,lat2,lon2) {
    const toRad=value=>value*Math.PI/180;
    const dLat=toRad(lat2-lat1),dLon=toRad(lon2-lon1);
    const a=Math.sin(dLat/2)**2+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
    return 6371000*2*Math.atan2(Math.sqrt(a),Math.sqrt(Math.max(0,1-a)));
  }
  function formatDistance(meters) {
    if(!Number.isFinite(meters))return "—";
    if(meters<1000)return Math.round(meters/10)*10+" m";
    return (meters/1000).toFixed(2)+" km";
  }
  function buildDirectionsUrl(info,origin) {
    if(!info||!info.meetup||info.meetup.latitude==null||info.meetup.longitude==null)return "https://www.google.com/maps";
    const params=new URLSearchParams({api:"1",destination:info.meetup.latitude+","+info.meetup.longitude,travelmode:"walking"});
    if(origin)params.set("origin",origin.latitude+","+origin.longitude);
    return "https://www.google.com/maps/dir/?"+params.toString();
  }
  async function loadTrackingHub() {
    state.screen="map";state.requestsLoading=true;state.requestsError="";state.workspaceMessage="";
    render();
    try {
      const result=await api("/my-requests",null,"GET");
      state.myRequests=Array.isArray(result.requests)?result.requests:[];
      state.incomingRequests=Array.isArray(result.incomingRequests)?result.incomingRequests:[];
    } catch(e) { state.requestsError=e.message||"Please try again.";state.myRequests=[];state.incomingRequests=[]; }
    finally { state.requestsLoading=false;render(); }
  }
  async function loadTrackingRequest(requestId) {
    if(!requestId)return;
    if(state.locationWatchId!==null){navigator.geolocation&&navigator.geolocation.clearWatch(state.locationWatchId);state.locationWatchId=null;}
    if(state.trackingPollTimer){window.clearInterval(state.trackingPollTimer);state.trackingPollTimer=null;}
    if(state.trackingShareEnabled){
      const previousId=state.trackingRequestId;
      if(previousId)api("/requests/"+encodeURIComponent(previousId)+"/location",{stop:true},"POST").catch(()=>{});
    }
    state.trackingShareEnabled=false;state.trackingLocationError="";
    state.trackingRequestId=requestId;state.trackingInfo=null;state.trackingError="";state.trackingLoading=true;state.screen="track";
    if(state.trackingMapInstance){try{Object.values(state.trackingMapMarkers).forEach(m=>m.setMap(null));}catch{}}
    state.trackingMapInstance=null;state.trackingMapMarkers={};state.trackingMapRequestId="";
    render();
    try { state.trackingInfo=await api("/requests/"+encodeURIComponent(requestId)+"/tracking",null,"GET"); }
    catch(e) { state.trackingError=e.message||"This tracking link is unavailable."; }
    finally { state.trackingLoading=false;render(); }
  }
  async function refreshTrackingRequest(silent) {
    const requestId=state.trackingRequestId;
    if(!requestId||state.screen!=="track")return;
    try {
      const info=await api("/requests/"+encodeURIComponent(requestId)+"/tracking",null,"GET");
      const oldStatus=state.trackingInfo&&state.trackingInfo.status;
      state.trackingInfo=info;
      if(["completed","declined","cancelled"].includes(info.status)&&state.trackingShareEnabled) {
        if(state.locationWatchId!==null&&navigator.geolocation)navigator.geolocation.clearWatch(state.locationWatchId);
        state.locationWatchId=null;state.trackingShareEnabled=false;
      }
      if(!silent||oldStatus!==info.status)render();
      else {updateTrackingMarkers();updateTrackingDistanceReadouts();}
    } catch(e) {
      if(!silent){state.trackingError=e.message||"Tracking is unavailable.";render();}
      else {const el=root.querySelector("#tracking-share-status");if(el)el.textContent="Connection interrupted; waiting to refresh tracking…";}
    }
  }
  function updateTrackingPolling() {
    const enabled=state.screen==="track"&&state.trackingInfo&&state.trackingInfo.canTrack;
    if(!enabled){if(state.trackingPollTimer){window.clearInterval(state.trackingPollTimer);state.trackingPollTimer=null;}return;}
    if(!state.trackingPollTimer)state.trackingPollTimer=window.setInterval(()=>refreshTrackingRequest(true),5000);
  }
  function loadGoogleMapsScript(key) {
    if(window.google&&window.google.maps)return Promise.resolve(window.google.maps);
    if(state.googleMapsPromise)return state.googleMapsPromise;
    state.googleMapsPromise=new Promise(function(resolve,reject){
      const script=document.createElement("script");
      script.src="https://maps.googleapis.com/maps/api/js?key="+encodeURIComponent(key)+"&v=weekly";
      script.async=true;script.defer=true;
      script.onload=function(){if(window.google&&window.google.maps)resolve(window.google.maps);else reject(new Error("Google Maps loaded without map support."));};
      script.onerror=function(){reject(new Error("Google Maps did not load. Check the restricted API key and its enabled APIs."));};
      document.head.appendChild(script);
      window.setTimeout(()=>reject(new Error("Google Maps timed out. Check your connection and API key setup.")),10000);
    }).catch(function(error){state.googleMapsPromise=null;throw error;});
    return state.googleMapsPromise;
  }
  async function initializeGoogleTrackingMap(key,info) {
    const container=root.querySelector("#tracking-google-map");
    if(!container||!info||!info.meetup||info.meetup.latitude==null||info.meetup.longitude==null)return;
    const rid=info.requestId;
    if(state.trackingMapInstance&&state.trackingMapRequestId===rid){updateTrackingMarkers();return;}
    const status=root.querySelector("#tracking-map-status");
    try {
      if(status)status.textContent="Loading Google Maps…";
      const maps=await loadGoogleMapsScript(key);
      if(state.screen!=="track"||state.trackingRequestId!==rid||!root.contains(container))return;
      const pickup={lat:Number(info.meetup.latitude),lng:Number(info.meetup.longitude)};
      const map=new maps.Map(container,{center:pickup,zoom:17,mapTypeId:"roadmap",mapTypeControl:false,streetViewControl:false,fullscreenControl:true,clickableIcons:false});
      state.trackingMapInstance=map;state.trackingMapRequestId=rid;
      state.trackingMapMarkers={meetup:new maps.Marker({map,position:pickup,title:"Agreed meetup point",label:"M"})};
      updateTrackingMarkers();
      if(status)status.hidden=true;
    } catch(e) {
      if(state.screen!=="track"||state.trackingRequestId!==rid)return;
      if(status){status.hidden=false;status.textContent=e.message||"Google Maps could not be loaded.";}
    }
  }
  function updateTrackingMarkers() {
    const info=state.trackingInfo,map=state.trackingMapInstance;
    if(!info||!map||!window.google||!window.google.maps)return;
    const maps=window.google.maps;
    const pickup=info.meetup&&{lat:Number(info.meetup.latitude),lng:Number(info.meetup.longitude)};
    if(pickup&&Number.isFinite(pickup.lat)&&Number.isFinite(pickup.lng)){
      if(state.trackingMapMarkers.meetup)state.trackingMapMarkers.meetup.setPosition(pickup);
      else state.trackingMapMarkers.meetup=new maps.Marker({map,position:pickup,title:"Agreed meetup point",label:"M"});
    }
    const seen=new Set(["meetup"]);
    (info.locations||[]).forEach(function(loc){
      const key="user-"+loc.userId;seen.add(key);
      const position={lat:Number(loc.latitude),lng:Number(loc.longitude)};
      if(!Number.isFinite(position.lat)||!Number.isFinite(position.lng))return;
      const title=loc.isMine?"Your shared location":(loc.name||"Other participant");
      if(state.trackingMapMarkers[key]){state.trackingMapMarkers[key].setPosition(position);state.trackingMapMarkers[key].setTitle(title);}
      else state.trackingMapMarkers[key]=new maps.Marker({map,position,title,label:loc.isMine?"Y":"•"});
    });
    Object.keys(state.trackingMapMarkers).forEach(key=>{if(!seen.has(key)){state.trackingMapMarkers[key].setMap(null);delete state.trackingMapMarkers[key];}});
  }
  function updateTrackingDistanceReadouts() {
    const info=state.trackingInfo;
    if(!info)return;
    const locs=info.locations||[],mine=locs.find(x=>x.isMine),other=locs.find(x=>!x.isMine);
    const dist=point=>point&&info.meetup&&info.meetup.latitude!=null&&info.meetup.longitude!=null?formatDistance(haversineMeters(Number(point.latitude),Number(point.longitude),Number(info.meetup.latitude),Number(info.meetup.longitude))):"Not sharing";
    const your=root.querySelector("#tracking-your-distance"),their=root.querySelector("#tracking-other-distance");
    if(your)your.textContent=dist(mine);if(their)their.textContent=dist(other);
    const status=root.querySelector("#tracking-share-status");
    if(status&&mine&&state.trackingShareEnabled)status.textContent="Sharing on this request · last updated "+Math.max(0,Math.round((Date.now()-Date.parse(mine.updatedAt))/1000))+" seconds ago.";
  }
  async function startLiveLocationShare() {
    if(!navigator.geolocation){state.trackingLocationError="This browser does not support location sharing.";render();return;}
    if(!state.trackingInfo||!state.trackingInfo.canTrack)return;
    if(state.locationWatchId!==null&&state.trackingShareEnabled)return;
    state.trackingLocationError="Requesting location permission…";state.trackingShareEnabled=true;render();
    const requestId=state.trackingRequestId;
    try {
      const watchId=navigator.geolocation.watchPosition(async function(position){
        if(state.screen!=="track"||state.trackingRequestId!==requestId||!state.trackingShareEnabled)return;
        const payload={latitude:position.coords.latitude,longitude:position.coords.longitude,accuracyM:position.coords.accuracy||0};
        try { await api("/requests/"+encodeURIComponent(requestId)+"/location",payload,"POST");state.trackingLocationError="";await refreshTrackingRequest(true); }
        catch(e){state.trackingLocationError=e.message||"Could not share your location.";const status=root.querySelector("#tracking-share-status");if(status)status.textContent=state.trackingLocationError;}
      },function(error){
        if(state.trackingRequestId!==requestId)return;
        if(state.locationWatchId!==null&&navigator.geolocation)navigator.geolocation.clearWatch(state.locationWatchId);
        state.locationWatchId=null;state.trackingShareEnabled=false;
        state.trackingLocationError=error.code===1?"Location permission was denied. You can enable it in browser settings.":error.code===3?"Getting your location timed out. Try again.":"Your location is unavailable right now.";
        const status=root.querySelector("#tracking-share-status");if(status)status.textContent=state.trackingLocationError;
        const action=root.querySelector('[data-action="start-location-share"]');if(action){action.textContent="Try sharing again";action.disabled=false;}
      },{enableHighAccuracy:true,maximumAge:5000,timeout:15000});
      state.locationWatchId=watchId;
      const action=root.querySelector('[data-action="start-location-share"]');if(action)action.disabled=true;
      state.trackingLocationError="Waiting for a GPS fix…";
      const status=root.querySelector("#tracking-share-status");if(status)status.textContent=state.trackingLocationError;
    }catch{
      state.trackingShareEnabled=false;state.trackingLocationError="We couldn’t start location sharing. Try again.";
      const status=root.querySelector("#tracking-share-status");if(status)status.textContent=state.trackingLocationError;
    }
  }
  async function stopLiveLocationShare() {
    const requestId=state.trackingRequestId;
    if(state.locationWatchId!==null&&navigator.geolocation)navigator.geolocation.clearWatch(state.locationWatchId);
    state.locationWatchId=null;state.trackingShareEnabled=false;
    try { if(requestId)await api("/requests/"+encodeURIComponent(requestId)+"/location",{stop:true},"POST"); } catch {}
    await refreshTrackingRequest(true);render();
  }
  async function changeRequestStatus(requestId,status) {
    try {
      await api("/requests/"+encodeURIComponent(requestId)+"/status",{status},"POST");
      state.workspaceMessage=status==="approved"?"Request accepted. The tracking map is now available to both participants.":status==="declined"?"Request declined.":status==="active"?"Exchange started. You can share your location whenever you choose.":status==="completed"?"Exchange completed. Live locations were removed.": "Request cancelled.";
      if(state.screen==="track"&&state.trackingRequestId===requestId){await refreshTrackingRequest(true);render();return;}
      await loadMyRequests();
    } catch(e) { state.workspaceMessage=e.message||"Could not update the request.";if(state.screen==="track")await refreshTrackingRequest(false);else render(); }
  }
  
  async function loadSupplyFinder() {
    state.screen="supply-finder";state.supplyHostelsLoading=true;state.supplyError="";state.supplyToast="";
    render();
    try {
      const result=await api("/supply-finder/hostels",null,"GET");
      state.supplyHostels=Array.isArray(result.hostels)?result.hostels:[];
      if(!state.supplyOriginHostelId&&state.supplyHostels.length)state.supplyOriginHostelId=state.supplyHostels[0].id;
    } catch(e) {
      state.supplyError=e.message||"Could not load pickup locations.";
      state.supplyHostels=[];
    } finally {
      state.supplyHostelsLoading=false;render();
    }
  }
  async function searchSmartSupplies(query) {
    const q=String(query==null?state.supplyQuery:query).trim().slice(0,500);
    state.supplyQuery=q;state.supplyLoading=true;state.supplyError="";state.supplyToast="";state.supplyResults=null;
    render();
    try {
      const payload={query:q,originHostelId:state.supplyUsingGps?"":state.supplyOriginHostelId};
      if(state.supplyUsingGps&&Number.isFinite(state.supplyLatitude)&&Number.isFinite(state.supplyLongitude)){
        payload.latitude=state.supplyLatitude;payload.longitude=state.supplyLongitude;
      }
      const result=await api("/supply-finder",payload,"POST");
      state.supplyResults=result;
      if(!result.isSupplySearch)state.supplyToast=result.message||"Describe a physical supply you need.";
      state.supplySelectedId=result.results&&result.results[0]?result.results[0].id:"";
    } catch(e) {
      state.supplyError=e.message||"The live campus inventory could not be searched.";
      state.supplyResults=null;
    } finally {state.supplyLoading=false;render();}
  }
  function chooseSupplyOrigin() {
    if(!navigator.geolocation){state.supplyError="This browser does not support GPS. Choose your hostel from the list.";render();return;}
    state.supplyError="";
    const actionButton=root.querySelector('[data-action="supply-use-location"]');
    if(actionButton){actionButton.disabled=true;actionButton.textContent="Finding you…";}
    navigator.geolocation.getCurrentPosition(function(position){
      state.supplyLatitude=position.coords.latitude;state.supplyLongitude=position.coords.longitude;state.supplyUsingGps=true;
      if(actionButton){actionButton.disabled=false;actionButton.textContent="Using my location ✓";}
      state.workspaceMessage="Using your current location for this search only. It is not saved to your profile.";
      if(state.supplyQuery)searchSmartSupplies(state.supplyQuery);else render();
    },function(error){
      state.supplyUsingGps=false;
      state.supplyError=error.code===1?"Location permission was denied. Choose your hostel manually.":"Could not get a GPS fix. Choose your hostel manually.";
      if(actionButton){actionButton.disabled=false;actionButton.textContent="Use my location"};
      render();
    },{enableHighAccuracy:true,maximumAge:15000,timeout:12000});
  }
  async function reserveSmartSupply(supplyId) {
    if(!supplyId||state.supplyBusyId)return;
    state.supplyBusyId=supplyId;state.supplyError="";render();
    try {
      const quantity=Number(state.supplyResults&&state.supplyResults.filters&&state.supplyResults.filters.quantity)||1;
      const result=await api("/supplies/reservations",{supplyId,quantity},"POST");
      state.supplyReservations.unshift({requestId:result.requestId,supplyId:result.supplyId,name:result.name,quantity:result.quantity,hostelId:result.hostelId});
      state.supplyToast="Reserved "+result.quantity+" × "+result.name+" at the "+(state.supplyHostels.find(h=>h.id===result.hostelId)||{}).name+". Demo inventory only; no real student has been contacted.";
      state.supplyBusyId="";
      await searchSmartSupplies(state.supplyQuery);
      state.workspaceMessage=state.supplyToast;
    } catch(e) {
      state.supplyBusyId="";state.supplyError=e.message||"That supply could not be reserved.";render();
    }
  }
  async function cancelSmartSupplyReservation(requestId) {
    try {
      await api("/supplies/reservations/"+encodeURIComponent(requestId)+"/cancel",{},"POST");
      const old=state.supplyReservations.find(x=>x.requestId===requestId);
      state.supplyReservations=state.supplyReservations.filter(x=>x.requestId!==requestId);
      state.supplyToast="Reservation cancelled"+(old?" for "+old.name:"")+". Demo inventory has been restored.";
      state.workspaceMessage=state.supplyToast;
      await searchSmartSupplies(state.supplyQuery);
      state.workspaceMessage=state.supplyToast;
    } catch(e) {state.supplyError=e.message||"Could not cancel this reservation.";render();}
  }
  function supplyDistanceLabel(result) {
    if(result.distanceMeters==null)return "Choose a starting location";
    const distance=Number(result.distanceMeters);
    const label=distance<1000?Math.round(distance/10)*10+" m":(distance/1000).toFixed(2)+" km";
    if(result.distanceType==="walking_route")return label+" walking route"+(result.walkingDurationSeconds?" · "+Math.max(1,Math.round(result.walkingDurationSeconds/60))+" min":"");
    return "≈ "+label+" straight-line";
  }
  function supplyMapEmbedUrl(result) {
    const lat=Number(result.latitude),lng=Number(result.longitude);
    if(!Number.isFinite(lat)||!Number.isFinite(lng))return "";
    const delta=.003;
    const bbox=[lng-delta,lat-delta,lng+delta,lat+delta].map(x=>x.toFixed(6)).join("%2C");
    return "https://www.openstreetmap.org/export/embed.html?bbox="+bbox+"&layer=mapnik&marker="+lat.toFixed(6)+"%2C"+lng.toFixed(6);
  }
  function supplyFinderScreen() {
    const data=state.supplyResults;
    const results=data&&Array.isArray(data.results)?data.results:[];
    const selected=results.find(x=>x.id===state.supplySelectedId)||results[0]||null;
    const hostelOptions=state.supplyHostels.map(h=>'<option value="'+esc(h.id)+'"'+(h.id===state.supplyOriginHostelId&&!state.supplyUsingGps?' selected':'')+'>'+esc(h.name)+'</option>').join("");
    const originLabel=state.supplyUsingGps?"Current location":(state.supplyHostels.find(h=>h.id===state.supplyOriginHostelId)||{}).name||"Choose a hostel";
    let resultsContent="";
    if(state.supplyLoading)resultsContent='<div class="supply-state"><span class="spinner"></span><strong>Searching live inventory…</strong><p>Gemini interprets your request; Gyanshala checks current database stock and ranks available matches.</p></div>';
    else if(state.supplyError)resultsContent='<div class="supply-state"><strong>Couldn’t complete the search</strong><p>'+esc(state.supplyError)+'</p><button class="btn btn-outline" type="button" data-action="supply-retry">Try again</button></div>';
    else if(data&&!data.isSupplySearch)resultsContent='<div class="supply-state"><span class="supply-state-icon">✦</span><strong>Tell me what physical item you need</strong><p>Gyanshala only searches campus supplies. Try “borrow a scientific calculator under ₹300” or “find a lab coat for tomorrow”. It won’t answer unrelated general-chat prompts.</p></div>';
    else if(data&&results.length)resultsContent='<div class="supply-results-heading"><div><p class="section-overline">AVAILABLE RIGHT NOW IN THE DATABASE</p><h2>'+results.length+' closest match'+(results.length===1?"":"es")+'</h2></div><span class="supply-results-count">'+data.totalMatches+' match'+(data.totalMatches===1?"":"es")+'</span></div><div class="supply-results-list">'+results.map(function(item,index){
      const price=item.priceAmount>0?"₹"+Number(item.priceAmount).toLocaleString("en-IN"):(item.offerType==="borrow"?"Borrow free":"Free / donation");
      const isSelected=selected&&selected.id===item.id;
      const selectedClass=isSelected?" selected":"";
      const busy=state.supplyBusyId===item.id;
      const coordinateNote=item.coordinateSource==="demo_approximation"?"Demo coordinates": "Coordinates need verification";
      return '<article class="supply-result-card'+selectedClass+'"><button type="button" class="supply-result-select" data-action="supply-select" data-id="'+esc(item.id)+'" aria-label="Show map for '+esc(item.name)+'"><span class="supply-result-rank">'+(index+1)+'</span><span class="supply-result-info"><span class="supply-result-kicker">'+esc(item.category)+' · '+esc(item.hostelName)+'</span><strong>'+esc(item.name)+'</strong><span class="supply-result-price">'+esc(price)+' <small>'+esc(item.condition)+'</small></span><span class="supply-result-distance">'+esc(supplyDistanceLabel(item))+'</span><small class="supply-result-stock">'+Number(item.quantityAvailable)+' available · '+esc(coordinateNote)+'</small></span><span class="supply-result-chevron">›</span></button><div class="supply-result-actions"><button class="btn btn-primary" type="button" data-action="supply-reserve" data-id="'+esc(item.id)+'"'+(busy?" disabled":"")+'>'+(busy?"Reserving…":"Reserve "+Number(data.filters.quantity||1))+'</button><a class="btn btn-outline" href="'+esc(item.directionsUrl)+'" target="_blank" rel="noopener noreferrer">Walking directions ↗</a></div></article>';
    }).join("")+'</div>';
    else if(data)resultsContent='<div class="supply-state"><span class="supply-state-icon">⌕</span><strong>No matching item is in stock</strong><p>Gyanshala searched the current inventory and found no available match for that request. Try another term or a different price/offer preference.</p></div>';
    else resultsContent='<div class="supply-state"><span class="supply-state-icon">✦</span><strong>Describe what you need</strong><p>We’ll search the inventory, exclude unavailable stock, and put the closest matching pickup point first.</p></div>';
    const mapContent=selected
      ?'<div class="supply-map-card"><div class="supply-map-heading"><div><p class="section-overline">SELECTED PICKUP POINT</p><h2>'+esc(selected.hostelName)+'</h2><p>'+esc(selected.name)+' · '+esc(supplyDistanceLabel(selected))+'</p></div><span class="supply-map-pin">⌖</span></div><div class="supply-map-frame"><iframe title="OpenStreetMap view of '+esc(selected.hostelName)+' (demo coordinates)" loading="lazy" referrerpolicy="no-referrer" src="'+esc(supplyMapEmbedUrl(selected))+'"></iframe></div><p class="supply-map-note">The map point is for interface testing only. NIT Silchar hostel coordinates are simulated in this preview; do not use these distances for a real trip.</p><a class="supply-directions-link" href="'+esc(selected.directionsUrl)+'" target="_blank" rel="noopener noreferrer">Open walking route in Google Maps ↗</a></div>'
      :'<div class="supply-map-card supply-map-empty"><span>⌖</span><strong>Your selected match will appear here</strong><p>Search first to see a pickup point.</p></div>';
    const reservations=state.supplyReservations.length
      ?'<section class="supply-reservations"><div class="supply-reservations-head"><div><p class="section-overline">YOUR PREVIEW RESERVATIONS</p><h2>Reserved for you</h2></div><span>'+state.supplyReservations.length+'</span></div>'+state.supplyReservations.map(x=>'<div class="supply-reservation-row"><span class="supply-reservation-check">✓</span><div><strong>'+esc(x.name)+'</strong><p>'+Number(x.quantity)+' item(s) reserved · demo stock</p></div><button type="button" class="text-action" data-action="supply-cancel-reservation" data-id="'+esc(x.requestId)+'">Cancel</button></div>').join("")+'</section>'
      :"";
    const modeNote=data?'<span class="supply-ai-mode '+(data.usedGemini?"gemini":"fallback")+'">'+(data.usedGemini?"Gemini query parsing":"Keyword fallback")+'</span>':"";
    const content='<section class="workspace-page-heading supply-page-heading"><p class="workspace-eyebrow">GYANSHALA SMART SUPPLY LOCATOR</p><h1>Find what you need. <span>Closer.</span></h1><p>A purpose-built supply finder: natural-language item search, live database availability, nearest pickup points, and one-click preview reservations. No general chatbot.</p></section><section class="supply-search-panel"><form id="supply-finder-form" class="supply-search-form"><label for="supply-query">What do you need?</label><div class="supply-query-row"><span>✦</span><input id="supply-query" type="search" name="query" value="'+esc(state.supplyQuery)+'" placeholder="I need a scientific calculator under ₹300…" required autocomplete="off"><button type="submit" '+(state.supplyLoading?"disabled":"")+'>'+ (state.supplyLoading?"Searching…":"Find supplies")+' <span>→</span></button></div><div class="supply-origin-row"><label for="supply-origin-hostel">Starting point</label><select id="supply-origin-hostel" name="originHostelId" '+(state.supplyHostelsLoading?"disabled":"")+'>'+hostelOptions+'</select><button type="button" class="supply-location-button" data-action="supply-use-location">'+(state.supplyUsingGps?"Using my location ✓":"Use my location")+'</button></div><p class="supply-search-hint">Examples: “borrow a lab coat for tomorrow”, “free drawing kit”, “USB-C charger under ₹400”. Choose GPS only when you want to use your current location.</p></form><div class="supply-ai-status"><span>✦</span><div><strong>AI that searches, not chats</strong><p>Gemini extracts item + filters. The Worker queries D1 for real-time demo stock; Gemini cannot invent a listing.</p></div>'+modeNote+'</div></section>'+ (state.workspaceMessage?'<div class="workspace-flash" role="status">'+esc(state.workspaceMessage)+'</div>':"")+'<section class="supply-workspace"><div class="supply-results-panel">'+resultsContent+'</div><aside class="supply-map-column">'+mapContent+'</aside></section>'+reservations+'<p class="supply-demo-disclaimer">Preview dataset: 800+ synthetic listing combinations across NIT Silchar hostel names. Hostel coordinates, stock, offers, item conditions, route distances and availability are artificial and are not real student listings. Verify hostel entrances and routes before any real launch.</p>';
    appShell(content,"supply");
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
    const resource=item.resource||{};
    const hasMessages=Boolean(item.messagesAvailable);
    const icon=resource.icon||categoryIcon(resource.category);
    const sampleNote=hasMessages?"":'<p class="request-sample-note">Preview sample listing · no live owner account</p>';
    const actions=[];
    if(item.role==="owner"&&item.status==="pending"){
      actions.push('<button type="button" class="btn btn-primary" data-action="request-status" data-id="'+esc(item.requestId)+'" data-status="approved">Accept request</button>');
      actions.push('<button type="button" class="btn btn-outline" data-action="request-status" data-id="'+esc(item.requestId)+'" data-status="declined">Decline</button>');
    } else if(item.status==="approved"||item.status==="active") {
      actions.push('<button type="button" class="btn btn-primary" data-action="track-request" data-id="'+esc(item.requestId)+'">Track exchange <span class="arrow">→</span></button>');
      if(hasMessages)actions.push('<button type="button" class="btn btn-outline" data-action="open-thread" data-id="'+esc(item.requestId)+'">Message '+(item.role==="owner"?"requester":"owner")+'</button>');
    } else if(item.status==="pending"&&item.role==="requester") {
      if(hasMessages)actions.push('<button type="button" class="btn btn-outline" data-action="open-thread" data-id="'+esc(item.requestId)+'">Message owner</button>');
      actions.push('<button type="button" class="btn btn-outline" data-action="request-status" data-id="'+esc(item.requestId)+'" data-status="cancelled">Cancel request</button>');
    } else if(hasMessages) {
      actions.push('<button type="button" class="btn btn-outline" data-action="open-thread" data-id="'+esc(item.requestId)+'">Open messages</button>');
    } else {
      actions.push('<button type="button" class="btn btn-outline" data-action="resource" data-id="'+esc(resource.id)+'">View item</button>');
    }
    const otherLabel=item.role==="owner"?"Requested by ":"With ";
    return '<article class="request-card"><div class="request-art cover-'+esc(({Books:"books","Lab Equipment":"lab",Electronics:"electronics",Stationery:"stationery"})[resource.category]||"other")+'"><span>'+esc(icon)+'</span></div><div class="request-card-main"><div class="request-card-top"><span class="request-category">'+esc(resource.category||"Resource")+'</span><span class="request-status status-'+esc(item.status)+'">'+esc(requestStatusLabel(item.status))+'</span></div><h3>'+esc(resource.title||"Campus resource")+'</h3><p>'+esc(resource.pickupLocation||"Campus pickup")+' <span>·</span> '+esc(priceLabel(resource))+'</p><small>'+otherLabel+esc(item.otherName||resource.ownerName||"Student")+' · '+esc(new Date(item.createdAt).toLocaleDateString(undefined,{day:"numeric",month:"short",year:"numeric"}))+'</small>'+sampleNote+'</div><div class="request-card-actions">'+actions.join("")+'</div></article>';
  }
  function myRequestsScreen() {
    const collection=state.requestScope==="received"?state.incomingRequests:state.myRequests;
    const filters=["All","pending","approved","active","completed","declined","cancelled"];
    const items=state.requestFilter==="All"?collection:collection.filter(x=>x.status===state.requestFilter);
    const labels={All:"All",pending:"Pending",approved:"Accepted",active:"In progress",completed:"Completed",declined:"Declined",cancelled:"Cancelled"};
    const tabs=filters.map(function(f){return '<button type="button" class="request-filter'+(f===state.requestFilter?" active":"")+'" data-action="request-filter" data-id="'+esc(f)+'">'+esc(labels[f]||f)+(f==="All"?"<span>"+collection.length+"</span>":"")+'</button>';}).join("");
    let body;
    if(state.requestsLoading) body='<div class="resource-state"><span class="spinner"></span><strong>Loading requests</strong><p>Checking your campus exchanges…</p></div>';
    else if(state.requestsError) body='<div class="resource-state"><strong>Your requests didn’t load.</strong><p>'+esc(state.requestsError)+'</p><button type="button" class="btn btn-outline" data-action="my-requests">Try again</button></div>';
    else if(!items.length) body='<div class="resource-state"><div class="empty-mark">▤</div><strong>'+(collection.length?"No requests in this category":(state.requestScope==="received"?"No one has requested your listings yet":"No requests yet"))+'</strong><p>'+(collection.length?"Choose another status to see your activity.":(state.requestScope==="received"?"When another student requests one of your listings, you can accept or decline it here.":"When you request a campus resource, you can follow it here. Tracking appears only after the owner accepts."))+'</p><button type="button" class="btn btn-primary" data-action="'+(state.requestScope==="received"?"add-resource":"explore")+'">'+(state.requestScope==="received"?"List a resource":"Explore resources")+' <span class="arrow">→</span></button></div>';
    else body='<div class="request-list">'+items.map(requestListCard).join("")+'</div>';
    const content='<section class="workspace-page-heading"><p class="workspace-eyebrow">YOUR CAMPUS ACTIVITY</p><div class="workspace-heading-row"><div><h1>Requests & exchanges</h1><p>Accept requests, coordinate the meetup, and follow an exchange once it’s approved.</p></div><span class="request-count">'+(state.myRequests.length+state.incomingRequests.length)+'<small>Total</small></span></div></section><section class="request-panel"><div class="request-scope-switch"><button type="button" class="'+(state.requestScope==="sent"?"active":"")+'" data-action="request-scope" data-id="sent">Requests I sent <span>'+state.myRequests.length+'</span></button><button type="button" class="'+(state.requestScope==="received"?"active":"")+'" data-action="request-scope" data-id="received">Requests to my listings <span>'+state.incomingRequests.length+'</span></button></div><div class="request-filters">'+tabs+'</div>'+body+'</section>';
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
      state.incomingRequests=Array.isArray(result.incomingRequests)?result.incomingRequests:[];
    } catch(e) { state.requestsError=e.message || "Please try again."; state.myRequests=[]; state.incomingRequests=[]; }
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
    if(state.screen!=="track"){
      if(state.trackingPollTimer){window.clearInterval(state.trackingPollTimer);state.trackingPollTimer=null;}
      if(state.locationWatchId!==null&&navigator.geolocation){navigator.geolocation.clearWatch(state.locationWatchId);state.locationWatchId=null;}
      if(state.trackingShareEnabled&&state.trackingRequestId)api("/requests/"+encodeURIComponent(state.trackingRequestId)+"/location",{stop:true},"POST").catch(()=>{});
      state.trackingShareEnabled=false;
      state.trackingMapInstance=null;state.trackingMapMarkers={};state.trackingMapRequestId="";
    }
    releaseCampusMap();
    state.message = "";
    if (state.screen === "splash") return splash();
    if (state.screen === "onboarding") return onboarding();
    if (state.screen === "signup" || state.screen === "signin") return authForm(state.screen);
    if (state.screen === "email") return emailVerify();
    
    if (state.screen === "profile") return profile();
    if (state.screen === "home") return dashboard();
    if (state.screen === "explore") return browse();
    if (state.screen === "detail") return detail();
    if (state.screen === "supply-finder") return supplyFinderScreen();
    if (state.screen === "map") return trackingHubScreen();
    if (state.screen === "track") return requestTrackingScreen();
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
    if (form.id === "supply-finder-form") {
      state.supplyQuery=String(fd.get("query")||"").trim().slice(0,500);
      state.supplyOriginHostelId=String(fd.get("originHostelId")||state.supplyOriginHostelId);
      state.supplyUsingGps=Boolean(state.supplyUsingGps&&Number.isFinite(state.supplyLatitude)&&Number.isFinite(state.supplyLongitude));
      await searchSmartSupplies(state.supplyQuery);
    } else if (form.id === "campus-map-search-form") {
      state.mapSearch=String(fd.get("q")||"").trim().slice(0,100);
      const q=state.mapSearch.toLowerCase();
      const point=state.pickupPoints.find(function(p){return p.name.toLowerCase()===q;})||state.pickupPoints.find(function(p){return (p.name+" "+p.area).toLowerCase().includes(q);});
      if(point){state.pickupSelectedId=point.id;state.mapFocusId=point.id;state.workspaceMessage="";}
      else state.workspaceMessage="No matching pinned place found. You can still click any named map feature to inspect its OpenStreetMap label.";
      render();
    } else if (form.id === "community-post-form") {
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
  async function action(name, id, detail) {
    if (name === "home") {
      if (state.user && state.user.profileComplete) { state.category = "All"; state.search = ""; state.screen = "home"; refreshResources(); return; }
      if (state.user) { navigate("profile"); return; }
      navigate("splash"); return;
    }

    if (name === "supply-finder") { await loadSupplyFinder(); return; }
    if (name === "supply-use-location") { chooseSupplyOrigin(); return; }
    if (name === "supply-select") { state.supplySelectedId=id||"";render();return; }
    if (name === "supply-reserve") { await reserveSmartSupply(id);return; }
    if (name === "supply-cancel-reservation") { await cancelSmartSupplyReservation(id);return; }
    if (name === "supply-retry") { await searchSmartSupplies(state.supplyQuery);return; }
    if (name === "map") { await loadTrackingHub(); return; }
    if (name === "request-scope") { state.requestScope=id==="received"?"received":"sent";state.requestFilter="All";render();return; }
    if (name === "request-status") { const target=detail;if(target)await changeRequestStatus(id,target);return; }
    if (name === "track-request") { await loadTrackingRequest(id);return; }
    if (name === "start-location-share") { await startLiveLocationShare();return; }
    if (name === "stop-location-share") { await stopLiveLocationShare();return; }

    if (name === "select-pickup") { state.pickupSelectedId=id||"";state.mapFocusId=id||"";render();return; }
    if (name === "reset-campus-map") { state.campusMapView=null;state.mapFocusId="";state.mapSearch="";state.pickupSelectedId=state.pickupPoints[0]?state.pickupPoints[0].id:"";render();return; }
    if (name === "retry-campus-map") { state.campusMapLibPromise=null;state.campusMapStylesPromise=null;render();return; }
    if (name === "toggle-map-3d") {
      state.map3dEnabled=!state.map3dEnabled;
      if(state.campusMapInstance&&state.campusMapLib&&state.campusMapInstance.isStyleLoaded()){
        const ok=configureCampus3DBuildings(state.campusMapInstance);
        if(!ok){state.map3dEnabled=false;state.workspaceMessage="3D building heights are not available in this map area’s source data.";render();return;}
      }
      render();return;
    }
    if (name === "copy-map-coordinates") {
      const point=state.pickupPoints.find(function(p){return p.id===id;});
      if(point&&navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(Number(point.latitude).toFixed(6)+", "+Number(point.longitude).toFixed(6)).catch(function(){});
      state.workspaceMessage=point?"Coordinates copied.":"No coordinates available.";
      render();return;
    }

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
    if (name === "community-type") { state.communityType=id||"All";await loadCommunity();return; }
    if (name === "community-category") { state.communityCategory=id||"All";await loadCommunity();return; }
    if (name === "community-new-post") { state.communityFormOpen=!state.communityFormOpen;render();return; }
    if (name === "community-cancel") { state.communityFormOpen=false;render();return; }
    if (name === "community-interest") { await communityInterest(id);return; }
    if (name === "close-community-post") { await closeCommunityPost(id);return; }
    if (name === "explore") { state.screen = "explore"; render(); refreshResources(); return; }
    if (name === "add-resource") { state.workspaceMessage=""; navigate("listing"); return; }
    if (name === "my-requests") { state.requestScope="sent";state.requestFilter="All";await loadMyRequests(); return; }
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
      if(state.locationWatchId!==null&&navigator.geolocation)navigator.geolocation.clearWatch(state.locationWatchId);
      state.locationWatchId=null;state.trackingShareEnabled=false;
      if(state.trackingRequestId)api("/requests/"+encodeURIComponent(state.trackingRequestId)+"/location",{stop:true},"POST").catch(()=>{});
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
    action(name, id, btn.getAttribute("data-status"));
  });
  root.addEventListener("change",function(event){
    const target=event.target;
    if(target&&target.id==="supply-origin-hostel"){
      state.supplyOriginHostelId=target.value;
      state.supplyUsingGps=false;
      const locate=root.querySelector('[data-action="supply-use-location"]');
      if(locate)locate.textContent="Use my location";
    }
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