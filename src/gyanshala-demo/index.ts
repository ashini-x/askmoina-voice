import type { Env } from "../config/env";

type GEnv = Env & {
  GYANSHALA_DB?: D1Database;
  GYANSHALA_RESEND_API_KEY?: string;
  GYANSHALA_EMAIL_FROM?: string;
  GYANSHALA_ALLOWED_EMAIL_DOMAINS?: string;
  GYANSHALA_OTP_SECRET?: string;
  GYANSHALA_PREVIEW_TEST_MODE?: string;
  GYANSHALA_GOOGLE_MAPS_BROWSER_KEY?: string;
  GYANSHALA_GOOGLE_MAPS_SERVER_KEY?: string;
  GYANSHALA_GEMINI_API_KEY?: string;
  GYANSHALA_GEMINI_MODEL?: string;
};
type Challenge = {
  challenge_id: string;
  mode: "signup" | "signin";
  user_id: string | null;
  email: string;
  email_code_hash: string;
  email_expires_at: string;
  email_verified_at: string | null;
  email_sent_at: string;
  attempts: number;
  created_at: string;
};
type User = {
  user_id: string;
  email: string;
  email_verified_at: string;
  full_name: string | null;
  branch: string | null;
  year_of_study: string | null;
  residence: string | null;
  profile_complete: number;
  status: string;
  created_at: string;
};

const APP = "/gyanshala-demo";
const API = "/api/gyanshala";
const COOKIE = "gyanshala_session";
const SESSION_SECONDS = 1209600;
const CODE_SECONDS = 600;
const COOLDOWN_MS = 30000;
const MAX_ATTEMPTS = 5;

function reply(data: unknown, status = 200, extra?: HeadersInit): Response {
  const h = new Headers(extra);
  h.set("Content-Type", "application/json; charset=utf-8");
  h.set("Cache-Control", "no-store");
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "no-referrer");
  h.set("Cross-Origin-Resource-Policy", "same-origin");
  return Response.json(data, { status, headers: h });
}
function readCookie(r: Request, name: string): string | null {
  for (const part of (r.headers.get("Cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i >= 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}
function sameOrigin(r: Request): boolean {
  const o = r.headers.get("Origin");
  const s = r.headers.get("Sec-Fetch-Site");
  return o === new URL(r.url).origin && (!s || s === "same-origin" || s === "none");
}
async function body(r: Request): Promise<Record<string, unknown> | null> {
  if (Number(r.headers.get("Content-Length") || 0) > 8192) return null;
  try {
    const x: unknown = await r.json();
    return x && typeof x === "object" && !Array.isArray(x) ? x as Record<string, unknown> : null;
  } catch { return null; }
}
function envOf(e: Env): GEnv { return e as GEnv; }
function token(n = 24): string {
  const v = crypto.getRandomValues(new Uint8Array(n));
  let b = "";
  for (const x of v) b += String.fromCharCode(x);
  return btoa(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function code6(): string { return String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0"); }
async function mac(secret: string, value: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(sig), x => x.toString(16).padStart(2, "0")).join("");
}
export function isPreviewTestMode(environment: string | undefined, flag: string | undefined): boolean {
  return environment === "preview" && flag?.trim().toLowerCase() === "true";
}
function previewTestMode(e: GEnv): boolean { return isPreviewTestMode(e.ENVIRONMENT, e.GYANSHALA_PREVIEW_TEST_MODE); }
function secret(e: GEnv): string | null {
  return e.GYANSHALA_OTP_SECRET?.trim() || (previewTestMode(e) ? "gyanshala-preview-only-test-secret-v1" : null);
}
function allowedDomains(e: GEnv): string[] {
  return (e.GYANSHALA_ALLOWED_EMAIL_DOMAINS || "").split(",")
    .map(x => x.trim().toLowerCase().replace(/^@/, ""))
    .filter(x => /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(x) && !x.includes(".."));
}
function validEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (s.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_\x60{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(s)) return null;
  const p = s.split("@");
  if (!p[0] || p[0].length > 64 || p[1].startsWith(".") || p[1].endsWith(".") || p[1].includes("..")) return null;
  return s;
}
export function isAllowedDomain(domain: string, roots: string[]): boolean {
  const normalized = domain.trim().toLowerCase();
  return roots.some(root => normalized === root || normalized.endsWith("." + root));
}
function isAllowedCollegeEmail(email: string, e: GEnv): boolean {
  const domain = email.split("@")[1] || "";
  return isAllowedDomain(domain, allowedDomains(e));
}
function emailProviderReady(e: GEnv): boolean { return Boolean(e.GYANSHALA_RESEND_API_KEY?.trim() && e.GYANSHALA_EMAIL_FROM?.trim()); }

async function hasSchema(e: GEnv): Promise<boolean> {
  if (!e.GYANSHALA_DB) return false;
  try {
    const x = await e.GYANSHALA_DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('gyanshala_users','gyanshala_signup_challenges','gyanshala_sessions','gyanshala_rate_limits')").all<{name:string}>();
    return (x.results || []).length === 4;
  } catch { return false; }
}
function setup(e: GEnv, schema: boolean) {
  return {
    databaseBinding: Boolean(e.GYANSHALA_DB),
    databaseSchema: schema,
    emailProvider: emailProviderReady(e),
    collegeDomainPolicy: allowedDomains(e).length > 0,
    otpSecret: Boolean(e.GYANSHALA_OTP_SECRET?.trim()),
    previewTestMode: previewTestMode(e)
  };
}
async function cleanupExpired(e: GEnv): Promise<void> {
  const db = e.GYANSHALA_DB;
  if (!db) return;
  const now = new Date().toISOString();
  const retainedSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  await db.prepare("DELETE FROM gyanshala_signup_challenges WHERE email_expires_at <= ?").bind(now).run().catch(() => undefined);
  await db.prepare("DELETE FROM gyanshala_sessions WHERE expires_at <= ?").bind(now).run().catch(() => undefined);
  await db.prepare("DELETE FROM gyanshala_rate_limits WHERE last_sent_at <= ?").bind(retainedSince).run().catch(() => undefined);
}
async function health(e: GEnv): Promise<Response> {
  const schema = await hasSchema(e);
  const s = setup(e, schema);
  const missing: string[] = [];
  if (!s.databaseBinding || !s.databaseSchema) missing.push("GYANSHALA_DB binding and schema");
  if (!s.emailProvider) missing.push("GYANSHALA_RESEND_API_KEY and GYANSHALA_EMAIL_FROM");
  if (!s.collegeDomainPolicy) missing.push("GYANSHALA_ALLOWED_EMAIL_DOMAINS (institutional root domains)");
  if (!s.otpSecret) missing.push("GYANSHALA_OTP_SECRET");
  const testMode = previewTestMode(e);
  const signupReady = testMode
    ? Boolean(s.databaseBinding && s.databaseSchema && s.collegeDomainPolicy)
    : missing.length === 0;
  return reply({ ok: true, app: "gyanshala", signupReady, previewTestMode: testMode, setup: s, requiredSettings: missing });
}
async function sendEmail(e: GEnv, to: string, code: string): Promise<boolean> {
  // Preview-only test mode deliberately simulates delivery. Production never falls back to this path.
  if (previewTestMode(e)) return true;
  if (!emailProviderReady(e)) return false;
  const text = "Your Gyanshala verification code is " + code + ". It expires in 10 minutes. If you did not request this, ignore this message.";
  const html = '<div style="font-family:Arial,sans-serif;color:#111;line-height:1.6"><h2>Verify your college email</h2><p>Enter this code in Gyanshala to continue.</p><p style="font-size:32px;font-weight:700;letter-spacing:8px">' + code + '</p><p>This code expires in 10 minutes.</p></div>';
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + e.GYANSHALA_RESEND_API_KEY, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ from: e.GYANSHALA_EMAIL_FROM, to: [to], subject: "Your Gyanshala verification code", text, html })
  }).catch(() => null);
  return Boolean(res?.ok);
}
async function getChallenge(e: GEnv, id: unknown): Promise<Challenge | null> {
  if (!e.GYANSHALA_DB || typeof id !== "string" || !/^[A-Za-z0-9_-]{30,50}$/.test(id)) return null;
  return e.GYANSHALA_DB.prepare("SELECT * FROM gyanshala_signup_challenges WHERE challenge_id=? AND email_expires_at>? LIMIT 1")
    .bind(id, new Date().toISOString()).first<Challenge>();
}
async function rateLimited(e: GEnv, email: string): Promise<boolean> {
  if (!e.GYANSHALA_DB || !secret(e)) return true;
  const hash = await mac(secret(e) || "", "rate:email:" + email);
  const since = new Date(Date.now() - COOLDOWN_MS).toISOString();
  const result = await e.GYANSHALA_DB.prepare("SELECT contact_hash FROM gyanshala_rate_limits WHERE contact_hash=? AND last_sent_at>? LIMIT 1")
    .bind(hash, since).first<{contact_hash:string}>();
  return Boolean(result);
}
async function markEmailSent(e: GEnv, email: string): Promise<void> {
  if (!e.GYANSHALA_DB || !secret(e)) return;
  const hash = await mac(secret(e) || "", "rate:email:" + email);
  await e.GYANSHALA_DB.prepare("INSERT INTO gyanshala_rate_limits(contact_hash,last_sent_at) VALUES(?,?) ON CONFLICT(contact_hash) DO UPDATE SET last_sent_at=excluded.last_sent_at")
    .bind(hash, new Date().toISOString()).run();
}
async function makeCookie(e: GEnv, id: string): Promise<string> {
  if (!e.GYANSHALA_DB || !secret(e)) throw new Error("Gyanshala session configuration missing");
  const raw = token(32), now = new Date();
  const expires = new Date(now.getTime() + SESSION_SECONDS * 1000).toISOString();
  await e.GYANSHALA_DB.prepare("INSERT INTO gyanshala_sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)")
    .bind(await mac(secret(e) || "", "session:" + raw), id, now.toISOString(), expires).run();
  return COOKIE + "=" + raw + "; Max-Age=" + SESSION_SECONDS + "; Path=/; Secure; HttpOnly; SameSite=Lax";
}
async function getUser(r: Request, e: GEnv): Promise<User | null> {
  const raw = readCookie(r, COOKIE);
  if (!e.GYANSHALA_DB || !raw || !secret(e) || !/^[A-Za-z0-9_-]{40,50}$/.test(raw)) return null;
  return e.GYANSHALA_DB.prepare("SELECT u.user_id,u.email,u.email_verified_at,u.full_name,u.branch,u.year_of_study,u.residence,u.profile_complete,u.status,u.created_at FROM gyanshala_sessions s JOIN gyanshala_users u ON u.user_id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.status='active' LIMIT 1")
    .bind(await mac(secret(e) || "", "session:" + raw), new Date().toISOString()).first<User>();
}
function userView(u: User) {
  return { id: u.user_id, email: u.email, fullName: u.full_name || "", branch: u.branch || "",
    yearOfStudy: u.year_of_study || "", residence: u.residence || "", profileComplete: u.profile_complete === 1 };
}
async function finish(e: GEnv, c: Challenge): Promise<Response> {
  if (!e.GYANSHALA_DB) return reply({ error: "database_not_configured" }, 503);
  let id = c.user_id || "";
  const now = new Date().toISOString();
  if (c.mode === "signup") {
    id = "gyu_" + crypto.randomUUID().replace(/-/g, "");
    try {
      await e.GYANSHALA_DB.prepare("INSERT INTO gyanshala_users(user_id,email,email_verified_at,profile_complete,status,created_at,updated_at) VALUES(?,?,?,0,'active',?,?)")
        .bind(id, c.email, c.email_verified_at || now, now, now).run();
    } catch {
      return reply({ error: "email_already_registered", message: "This college email is already linked to an account. Sign in instead." }, 409);
    }
  }
  const u = await e.GYANSHALA_DB.prepare("SELECT user_id,email,email_verified_at,full_name,branch,year_of_study,residence,profile_complete,status,created_at FROM gyanshala_users WHERE user_id=? AND status='active' LIMIT 1")
    .bind(id).first<User>();
  if (!u) return reply({ error: "account_unavailable" }, 403);
  await e.GYANSHALA_DB.prepare("DELETE FROM gyanshala_signup_challenges WHERE challenge_id=?").bind(c.challenge_id).run();
  return reply({ ok: true, user: userView(u), next: u.profile_complete === 1 ? "complete" : "profile" }, 200, { "Set-Cookie": await makeCookie(e, id) });
}
async function start(r: Request, e: GEnv): Promise<Response> {
  const b = await body(r);
  if (!b) return reply({ error: "invalid_json" }, 400);
  const email = validEmail(b.email), mode = b.mode === "signin" ? "signin" : "signup";
  if (!email) return reply({ error: "invalid_email", message: "Enter a valid college email address." }, 400);
  const roots = allowedDomains(e);
  if (!roots.length) return reply({ error: "college_domains_not_configured", message: "The approved institutional email domains are not configured." }, 503);
  if (!isAllowedCollegeEmail(email, e)) return reply({ error: "college_email_not_allowed", message: "Use an email address belonging to NIT Silchar's approved email domain." }, 403);
  if (!e.GYANSHALA_DB || !secret(e) || (!emailProviderReady(e) && !previewTestMode(e)) || !(await hasSchema(e))) {
    return reply({ error: "signup_setup_incomplete", message: "Email verification is not enabled yet. An administrator must finish the setup checklist.", setup: setup(e, await hasSchema(e)) }, 503);
  }
  const db = e.GYANSHALA_DB;
  await cleanupExpired(e);
  const existing = await db.prepare("SELECT user_id FROM gyanshala_users WHERE email=? LIMIT 1").bind(email).first<{user_id:string}>();
  let userId: string | null = null;
  if (mode === "signup" && existing) return reply({ error: "email_already_registered", message: "This college email is already registered. Sign in instead." }, 409);
  if (mode === "signin") {
    if (!existing) return reply({ error: "account_not_found", message: "No account was found for this email. Create an account first." }, 401);
    userId = existing.user_id;
  }
  if (await rateLimited(e, email)) return reply({ error: "please_wait", message: "A verification email was sent recently. Wait 30 seconds before trying again." }, 429, { "Retry-After": "30" });
  const id = token(24), code = code6(), now = new Date(), expires = new Date(now.getTime() + CODE_SECONDS * 1000);
  const codeHash = await mac(secret(e) || "", id + ":" + code);
  await db.prepare("INSERT INTO gyanshala_signup_challenges(challenge_id,mode,user_id,email,email_code_hash,email_expires_at,email_verified_at,email_sent_at,attempts,created_at) VALUES(?,?,?,?,?,?,NULL,?,0,?)")
    .bind(id, mode, userId, email, codeHash, expires.toISOString(), now.toISOString(), now.toISOString()).run();
  if (!(await sendEmail(e, email, code))) {
    await db.prepare("DELETE FROM gyanshala_signup_challenges WHERE challenge_id=?").bind(id).run();
    return reply({ error: "email_delivery_failed", message: "Verification email failed to send. Check Resend's API key and verified sender domain." }, 502);
  }
  await markEmailSent(e, email);
  const testMode = previewTestMode(e);
  return reply({
    ok: true,
    challengeId: id,
    emailSent: !testMode,
    ...(testMode ? { previewOnly: true, previewVerificationCode: code } : {}),
    expiresInSeconds: CODE_SECONDS,
    message: testMode
      ? "PREVIEW TEST MODE — no email was sent. Enter the one-time code shown here: " + code + ". It expires in 10 minutes."
      : "Check your college email for a verification code."
  }, 202);
}
async function verifyEmail(r: Request, e: GEnv): Promise<Response> {
  const b = await body(r);
  if (!b || typeof b.code !== "string") return reply({ error: "invalid_json" }, 400);
  const c = await getChallenge(e, b.challengeId);
  if (!c) return reply({ error: "verification_expired", message: "Start again to receive a fresh verification code." }, 400);
  if (c.attempts >= MAX_ATTEMPTS) return reply({ error: "too_many_attempts", message: "Too many attempts. Start again." }, 429);
  const ok = /^[0-9]{6}$/.test(b.code) && await mac(secret(e) || "", c.challenge_id + ":" + b.code) === c.email_code_hash;
  if (!ok) {
    await e.GYANSHALA_DB?.prepare("UPDATE gyanshala_signup_challenges SET attempts=attempts+1 WHERE challenge_id=?").bind(c.challenge_id).run();
    return reply({ error: "invalid_email_code", message: "That code did not match. Check your email and try again." }, 401);
  }
  await e.GYANSHALA_DB?.prepare("UPDATE gyanshala_signup_challenges SET email_verified_at=?,attempts=0 WHERE challenge_id=?")
    .bind(new Date().toISOString(), c.challenge_id).run();
  const updated = await getChallenge(e, c.challenge_id);
  return updated ? finish(e, updated) : reply({ error: "verification_expired" }, 400);
}
async function resendEmail(r: Request, e: GEnv): Promise<Response> {
  const b = await body(r);
  if (!b) return reply({ error: "invalid_json" }, 400);
  const c = await getChallenge(e, b.challengeId);
  if (!c) return reply({ error: "verification_expired", message: "Start again to receive a fresh code." }, 400);
  if (c.email_verified_at) return reply({ ok: true, emailVerified: true });
  if (await rateLimited(e, c.email)) return reply({ error: "resend_cooldown", message: "Wait 30 seconds before requesting another code." }, 429, { "Retry-After": "30" });
  const code = code6(), now = new Date(), expires = new Date(now.getTime() + CODE_SECONDS * 1000);
  const hash = await mac(secret(e) || "", c.challenge_id + ":" + code);
  if (!(await sendEmail(e, c.email, code))) return reply({ error: "email_delivery_failed", message: "Email could not be sent. Try again later." }, 502);
  await e.GYANSHALA_DB?.prepare("UPDATE gyanshala_signup_challenges SET email_code_hash=?,email_expires_at=?,email_sent_at=?,attempts=0 WHERE challenge_id=?")
    .bind(hash, expires.toISOString(), now.toISOString(), c.challenge_id).run();
  await markEmailSent(e, c.email);
  const testMode = previewTestMode(e);
  return reply(testMode
    ? { ok: true, previewOnly: true, previewVerificationCode: code, message: "PREVIEW TEST MODE — no email was sent. Use code " + code + "." }
    : { ok: true });
}
async function me(r: Request, e: GEnv): Promise<Response> {
  const u = await getUser(r, e);
  return u ? reply({ authenticated: true, user: userView(u) }) : reply({ authenticated: false });
}
async function saveProfile(r: Request, e: GEnv): Promise<Response> {
  const u = await getUser(r, e);
  if (!u) return reply({ error: "authentication_required" }, 401);
  const b = await body(r);
  if (!b) return reply({ error: "invalid_json" }, 400);
  const name = typeof b.fullName === "string" ? b.fullName.trim().replace(/\s+/g, " ") : "";
  const branch = typeof b.branch === "string" ? b.branch.trim() : "";
  const year = typeof b.yearOfStudy === "string" ? b.yearOfStudy.trim() : "";
  const residence = typeof b.residence === "string" ? b.residence.trim().replace(/\s+/g, " ") : "";
  if (name.length < 2 || name.length > 80 || branch.length < 2 || branch.length > 100 ||
      !["1st Year","2nd Year","3rd Year","4th Year","5th Year","Postgraduate","Research Scholar","Other"].includes(year) ||
      residence.length < 2 || residence.length > 100) return reply({ error: "invalid_profile", message: "Complete your name, branch, year and campus residence." }, 400);
  await e.GYANSHALA_DB?.prepare("UPDATE gyanshala_users SET full_name=?,branch=?,year_of_study=?,residence=?,profile_complete=1,updated_at=? WHERE user_id=?")
    .bind(name, branch, year, residence, new Date().toISOString(), u.user_id).run();
  const updated = await getUser(r, e);
  return reply({ ok: true, user: updated ? userView(updated) : null, next: "complete" });
}


type ResourceRow = {
  resource_id: string;
  owner_id: string | null;
  title: string;
  category: string;
  description: string;
  item_condition: string;
  lending_type: "lend" | "sell" | "free";
  price_amount: number;
  pickup_location: string;
  distance_label: string;
  owner_name: string;
  owner_branch: string;
  icon: string;
  status: string;
  created_at: string;
  updated_at: string;
  request_status?: string | null;
};
function resourceView(r: ResourceRow) {
  return {
    id: r.resource_id, title: r.title, category: r.category, description: r.description,
    condition: r.item_condition, lendingType: r.lending_type, priceAmount: r.price_amount,
    pickupLocation: r.pickup_location, distanceLabel: r.distance_label, ownerName: r.owner_name,
    ownerBranch: r.owner_branch, icon: r.icon, status: r.status, createdAt: r.created_at,
    requestStatus: r.request_status || null
  };
}
async function seedPreviewResources(e: GEnv): Promise<void> {
  if (!previewTestMode(e) || !e.GYANSHALA_DB) return;
  const db = e.GYANSHALA_DB;
  const count = await db.prepare("SELECT COUNT(*) AS total FROM gyanshala_resources").first<{total:number}>();
  if (Number(count?.total || 0) > 0) return;
  const now = new Date().toISOString();
  const rows = [
    ["gy-rsc-calculator","Scientific Calculator","Electronics","Scientific calculator suitable for engineering mathematics, with standard scientific functions and a clear display.","Good","lend",200,"Hostel A · Block 2","5 min walk","Rohan S.","Electronics & Communication","▦"],
    ["gy-rsc-labcoat","Lab Coat","Lab Equipment","Clean lab coat for practical sessions. Check your lab’s required size and safety rules before borrowing.","Very good","free",0,"Chemistry Block","3 min walk","Priya M.","Chemical Engineering","◒"],
    ["gy-rsc-drawingkit","Engineering Drawing Kit","Stationery","Drawing instruments and essentials for engineering graphics and studio work.","Good","lend",100,"Main Library","4 min walk","Arjun K.","Civil Engineering","✎"],
    ["gy-rsc-dsa-textbook","Textbook — Data Structures","Books","A student copy of a data structures textbook for revision and semester practice.","Good","free",0,"Central Library","6 min walk","Main Library","Computer Science","▤"],
    ["gy-rsc-electronics-kit","Electronics Practice Kit","Lab Equipment","Starter kit with jumper wires, breadboard and basic components for supervised practice.","Good","lend",150,"ECE Department","7 min walk","Neha P.","Electronics & Communication","⌁"],
    ["gy-rsc-engineering-books","Engineering Books Bundle","Books","A small bundle of first-year engineering reference books. Borrow the full bundle for a study week.","Fair","free",0,"Hostel B · Common Room","8 min walk","Aditi R.","Mechanical Engineering","▤"]
  ];
  for (const row of rows) {
    await db.prepare("INSERT INTO gyanshala_resources(resource_id,owner_id,title,category,description,item_condition,lending_type,price_amount,pickup_location,distance_label,owner_name,owner_branch,icon,status,created_at,updated_at) VALUES(?,NULL,?,?,?,?,?,?,?,?,?,?,?,'available',?,?) ON CONFLICT(resource_id) DO NOTHING")
      .bind(row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8], row[9], row[10], row[11], now, now).run();
  }
}
async function listResources(r: Request, e: GEnv): Promise<Response> {
  const u = await getUser(r, e);
  if (!u) return reply({ error: "authentication_required", message: "Sign in to explore campus resources." }, 401);
  if (u.profile_complete !== 1) return reply({ error: "profile_incomplete", message: "Complete your student profile before browsing." }, 403);
  if (!e.GYANSHALA_DB) return reply({ error: "database_not_configured" }, 503);
  try {
    await seedPreviewResources(e);
    await ensurePickupPoints(e);
    const url = new URL(r.url);
    const q = (url.searchParams.get("q") || "").trim().slice(0, 120);
    const categoryValue = url.searchParams.get("category") || "All";
    const categories = ["All","Books","Lab Equipment","Electronics","Stationery"];
    const category = categories.includes(categoryValue) ? categoryValue : "All";
    const like = "%" + q + "%";
    const rows = await e.GYANSHALA_DB.prepare(
      "SELECT r.*,rq.status AS request_status FROM gyanshala_resources r LEFT JOIN gyanshala_resource_requests rq ON rq.resource_id=r.resource_id AND rq.requester_id=? WHERE r.status='available' AND (?='' OR r.title LIKE ? COLLATE NOCASE OR r.category LIKE ? COLLATE NOCASE OR r.description LIKE ? COLLATE NOCASE OR r.pickup_location LIKE ? COLLATE NOCASE) AND (?='All' OR r.category=?) ORDER BY r.created_at DESC,r.title ASC LIMIT 80"
    ).bind(u.user_id, q, like, like, like, like, category, category).all<ResourceRow>();
    return reply({ ok: true, resources: (rows.results || []).map(resourceView), total: (rows.results || []).length });
  } catch {
    return reply({ error: "resource_store_unavailable", message: "Resource discovery is being prepared. Refresh and try again." }, 503);
  }
}
async function getResource(r: Request, e: GEnv, resourceId: string): Promise<Response> {
  const u = await getUser(r, e);
  if (!u) return reply({ error: "authentication_required" }, 401);
  if (u.profile_complete !== 1) return reply({ error: "profile_incomplete", message: "Complete your student profile before browsing." }, 403);
  if (!e.GYANSHALA_DB) return reply({ error: "database_not_configured" }, 503);
  try {
    await seedPreviewResources(e);
    await ensurePickupPoints(e);
    const row = await e.GYANSHALA_DB.prepare(
      "SELECT r.*,rq.status AS request_status FROM gyanshala_resources r LEFT JOIN gyanshala_resource_requests rq ON rq.resource_id=r.resource_id AND rq.requester_id=? WHERE r.resource_id=? AND r.status='available' LIMIT 1"
    ).bind(u.user_id, resourceId).first<ResourceRow>();
    return row ? reply({ ok: true, resource: resourceView(row) }) : reply({ error: "resource_not_found", message: "This resource is no longer available." }, 404);
  } catch {
    return reply({ error: "resource_store_unavailable", message: "Resource details are temporarily unavailable." }, 503);
  }
}
async function requestResource(r: Request, e: GEnv, resourceId: string): Promise<Response> {
  const u = await getUser(r, e);
  if (!u) return reply({ error: "authentication_required", message: "Sign in to request a resource." }, 401);
  if (u.profile_complete !== 1) return reply({ error: "profile_incomplete" }, 403);
  if (!e.GYANSHALA_DB) return reply({ error: "database_not_configured" }, 503);
  try {
    await seedPreviewResources(e);
    const db = e.GYANSHALA_DB;
    const resource = await db.prepare("SELECT resource_id,owner_id,status FROM gyanshala_resources WHERE resource_id=? LIMIT 1").bind(resourceId).first<{resource_id:string;owner_id:string|null;status:string}>();
    if (!resource || resource.status !== "available") return reply({ error: "resource_not_found", message: "This resource is no longer available." }, 404);
    if (resource.owner_id && resource.owner_id === u.user_id) return reply({ error: "cannot_request_own_item", message: "You cannot request your own listing." }, 409);
    const existing = await db.prepare("SELECT request_id,status FROM gyanshala_resource_requests WHERE resource_id=? AND requester_id=? LIMIT 1")
      .bind(resourceId, u.user_id).first<{request_id:string;status:string}>();
    if (existing) return reply({ ok: true, alreadyRequested: true, requestStatus: existing.status, requestId: existing.request_id });
    const id = "gyr_" + token(18), now = new Date().toISOString();
    await db.prepare("INSERT INTO gyanshala_resource_requests(request_id,resource_id,requester_id,owner_id,status,message,created_at,updated_at) VALUES(?,?,?,?,'pending','',?,?)")
      .bind(id, resourceId, u.user_id, resource.owner_id, now, now).run();
    return reply({ ok: true, requestId: id, requestStatus: "pending" }, 201);
  } catch {
    return reply({ error: "request_failed", message: "We could not save this request. Please try again." }, 503);
  }
}

type RequestListRow = {
  request_id: string; status: string; message: string; created_at: string; updated_at: string;
  requester_id: string; owner_id: string | null; requester_name: string | null; owner_full_name: string | null;
  resource_id: string; title: string; category: string; description: string; item_condition: string;
  lending_type: "lend" | "sell" | "free"; price_amount: number; pickup_location: string;
  distance_label: string; owner_name: string; owner_branch: string; icon: string;
  messages_available: number;
};
async function createResource(r: Request, e: GEnv): Promise<Response> {
  const u = await getUser(r, e);
  if (!u) return reply({ error: "authentication_required", message: "Sign in to list a resource." }, 401);
  if (u.profile_complete !== 1) return reply({ error: "profile_incomplete", message: "Complete your student profile before listing a resource." }, 403);
  if (!e.GYANSHALA_DB) return reply({ error: "database_not_configured" }, 503);
  const b = await body(r);
  if (!b) return reply({ error: "invalid_json", message: "Check the listing details and try again." }, 400);
  const title = typeof b.title === "string" ? b.title.trim().replace(/\s+/g, " ") : "";
  const category = typeof b.category === "string" ? b.category.trim() : "";
  const description = typeof b.description === "string" ? b.description.trim() : "";
  const itemCondition = typeof b.condition === "string" ? b.condition.trim() : "Good";
  const lendingType = typeof b.lendingType === "string" ? b.lendingType.trim() : "lend";
  const pickupLocation = typeof b.pickupLocation === "string" ? b.pickupLocation.trim().replace(/\s+/g, " ") : "";
  const distanceLabel = typeof b.distanceLabel === "string" ? b.distanceLabel.trim().slice(0, 60) : "";
  const priceInput = b.priceAmount === undefined || b.priceAmount === null || b.priceAmount === "" ? 0 : Number(b.priceAmount);
  const categories = ["Books", "Lab Equipment", "Electronics", "Stationery"];
  const conditions = ["New", "Very good", "Good", "Fair"];
  if (title.length < 3 || title.length > 100 || !categories.includes(category) ||
      description.length < 8 || description.length > 1500 ||
      !conditions.includes(itemCondition) || !["lend","sell","free"].includes(lendingType) ||
      pickupLocation.length < 2 || pickupLocation.length > 120 ||
      !Number.isSafeInteger(priceInput) || priceInput < 0 || priceInput > 1000000 ||
      (lendingType === "sell" && priceInput < 1)) {
    return reply({ error: "invalid_resource", message: "Add a title, category, description, condition, pickup location, and a valid whole-rupee amount." }, 400);
  }
  const priceAmount = lendingType === "free" ? 0 : priceInput;
  const id = "gyr_" + token(18);
  const now = new Date().toISOString();
  const icon = ({ Books: "▤", "Lab Equipment": "◒", Electronics: "▦", Stationery: "✎" } as Record<string, string>)[category] || "📦";
  try {
    await ensurePickupPoints(e);
    const mappedPickup=await e.GYANSHALA_DB.prepare("SELECT pickup_id,name FROM gyanshala_pickup_points WHERE name=? AND status='active' LIMIT 1")
      .bind(pickupLocation).first<{pickup_id:string;name:string}>();
    if(!mappedPickup) return reply({error:"invalid_pickup_location",message:"Choose a pickup point from the NIT Silchar campus map."},400);
    const verifiedPickupLocation=mappedPickup.name;
    await e.GYANSHALA_DB.prepare(
      "INSERT INTO gyanshala_resources(resource_id,owner_id,title,category,description,item_condition,lending_type,price_amount,pickup_location,distance_label,owner_name,owner_branch,icon,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'available',?,?)"
    ).bind(id,u.user_id,title,category,description,itemCondition,lendingType,priceAmount,verifiedPickupLocation,distanceLabel,u.full_name || "Student",u.branch || "",icon,now,now).run();
    return reply({ ok: true, resourceId: id, message: "Your resource is now listed on the campus shelf." }, 201);
  } catch {
    return reply({ error: "resource_create_failed", message: "We couldn’t publish this listing. Please try again." }, 503);
  }
}
async function listMyRequests(r: Request, e: GEnv): Promise<Response> {
  const u = await getUser(r, e);
  if (!u) return reply({ error: "authentication_required", message: "Sign in to view your requests." }, 401);
  if (u.profile_complete !== 1) return reply({ error: "profile_incomplete" }, 403);
  if (!e.GYANSHALA_DB) return reply({ error: "database_not_configured" }, 503);
  try {
    await seedPreviewResources(e);
    const rows = await e.GYANSHALA_DB.prepare(
      "SELECT q.request_id,q.status,q.message,q.created_at,q.updated_at,q.requester_id,q.owner_id,r.resource_id,r.title,r.category,r.description,r.item_condition,r.lending_type,r.price_amount,r.pickup_location,r.distance_label,r.owner_name,r.owner_branch,r.icon,requester.full_name AS requester_name,owner.full_name AS owner_full_name,CASE WHEN q.owner_id IS NOT NULL THEN 1 ELSE 0 END AS messages_available FROM gyanshala_resource_requests q JOIN gyanshala_resources r ON r.resource_id=q.resource_id LEFT JOIN gyanshala_users requester ON requester.user_id=q.requester_id LEFT JOIN gyanshala_users owner ON owner.user_id=q.owner_id WHERE q.requester_id=? OR q.owner_id=? ORDER BY q.created_at DESC LIMIT 200"
    ).bind(u.user_id,u.user_id).all<RequestListRow>();
    const mapped = (rows.results || []).map(x => {
      const role = x.requester_id === u.user_id ? "requester" : "owner";
      return {
        requestId:x.request_id, status:x.status, role, message:x.message, createdAt:x.created_at, updatedAt:x.updated_at,
        otherName:role === "requester" ? (x.owner_full_name || x.owner_name || "Student") : (x.requester_name || "Student"),
        otherBranch:role === "requester" ? x.owner_branch : "",
        resource:{id:x.resource_id,title:x.title,category:x.category,description:x.description,condition:x.item_condition,
          lendingType:x.lending_type,priceAmount:x.price_amount,pickupLocation:x.pickup_location,distanceLabel:x.distance_label,
          ownerName:x.owner_name,ownerBranch:x.owner_branch,icon:x.icon},
        messagesAvailable:x.messages_available === 1
      };
    });
    const requests = mapped.filter(x=>x.role === "requester");
    const incomingRequests = mapped.filter(x=>x.role === "owner");
    return reply({ ok:true, requests, incomingRequests, total:requests.length, incomingTotal:incomingRequests.length });
  } catch {
    return reply({ error:"requests_unavailable", message:"Your requests are temporarily unavailable. Try again." },503);
  }
}
type TrackingRequestRow = {
  request_id:string;status:string;requester_id:string;owner_id:string|null;created_at:string;updated_at:string;
  title:string;pickup_location:string;requester_name:string|null;owner_name:string|null;
  latitude:number|null;longitude:number|null;
};
type LiveLocationRow = {
  request_id:string;user_id:string;latitude:number;longitude:number;accuracy_m:number;updated_at:string;
  full_name:string|null;branch:string|null;
};
async function getRequestTracking(r: Request,e:GEnv,requestId:string):Promise<Response>{
  const u=await getUser(r,e);
  if(!u)return reply({error:"authentication_required",message:"Sign in to view exchange tracking."},401);
  if(u.profile_complete!==1)return reply({error:"profile_incomplete"},403);
  if(!e.GYANSHALA_DB)return reply({error:"database_not_configured"},503);
  try{
    const db=e.GYANSHALA_DB;
    await ensurePickupPoints(e);
    const req=await db.prepare(
      "SELECT q.request_id,q.status,q.requester_id,q.owner_id,q.created_at,q.updated_at,r.title,r.pickup_location,requester.full_name AS requester_name,owner.full_name AS owner_name,p.latitude,p.longitude FROM gyanshala_resource_requests q JOIN gyanshala_resources r ON r.resource_id=q.resource_id LEFT JOIN gyanshala_users requester ON requester.user_id=q.requester_id LEFT JOIN gyanshala_users owner ON owner.user_id=q.owner_id LEFT JOIN gyanshala_pickup_points p ON p.name=r.pickup_location WHERE q.request_id=? AND (q.requester_id=? OR q.owner_id=?) LIMIT 1"
    ).bind(requestId,u.user_id,u.user_id).first<TrackingRequestRow>();
    if(!req)return reply({error:"tracking_not_found",message:"This exchange is not available to your account."},404);
    const isOwner=req.owner_id===u.user_id;
    const isRequester=req.requester_id===u.user_id;
    const liveStatus=req.status==="approved"||req.status==="active";
    let locations: Array<Record<string,unknown>>=[];
    if(liveStatus){
      const cutoff=new Date(Date.now()-120000).toISOString();
      const rows=await db.prepare(
        "SELECT l.request_id,l.user_id,l.latitude,l.longitude,l.accuracy_m,l.updated_at,u.full_name,u.branch FROM gyanshala_live_locations l LEFT JOIN gyanshala_users u ON u.user_id=l.user_id WHERE l.request_id=? AND l.updated_at>=? ORDER BY l.updated_at DESC"
      ).bind(requestId,cutoff).all<LiveLocationRow>();
      locations=(rows.results||[]).map(x=>({
        userId:x.user_id,name:x.full_name||"Student",branch:x.branch||"",latitude:x.latitude,longitude:x.longitude,
        accuracyM:x.accuracy_m,updatedAt:x.updated_at,role:x.user_id===req.requester_id?"requester":"owner",isMine:x.user_id===u.user_id
      }));
    }
    return reply({
      ok:true,requestId:req.request_id,status:req.status,createdAt:req.created_at,updatedAt:req.updated_at,
      role:isOwner?"owner":"requester",canTrack:liveStatus,
      resource:{title:req.title,pickupLocation:req.pickup_location},
      meetup:{name:req.pickup_location,latitude:req.latitude,longitude:req.longitude},
      participants:{requesterName:req.requester_name||"Student",ownerName:req.owner_name||"Student"},
      locations,googleMapsBrowserKey:e.GYANSHALA_GOOGLE_MAPS_BROWSER_KEY||null,
      privacy:{locationSharingOptInRequired:true,locationUpdatesExpireAfterSeconds:120}
    });
  }catch{
    return reply({error:"tracking_unavailable",message:"Tracking is temporarily unavailable. Try again."},503);
  }
}
async function updateRequestStatus(r:Request,e:GEnv,requestId:string):Promise<Response>{
  const u=await getUser(r,e);
  if(!u)return reply({error:"authentication_required"},401);
  if(u.profile_complete!==1)return reply({error:"profile_incomplete"},403);
  if(!e.GYANSHALA_DB)return reply({error:"database_not_configured"},503);
  const b=await body(r);
  const next=typeof b?.status==="string"?b.status:"";
  if(!["approved","declined","active","completed","cancelled"].includes(next))
    return reply({error:"invalid_status",message:"Choose a supported exchange action."},400);
  try{
    const db=e.GYANSHALA_DB;
    const q=await db.prepare("SELECT request_id,status,requester_id,owner_id FROM gyanshala_resource_requests WHERE request_id=? AND (requester_id=? OR owner_id=?) LIMIT 1")
      .bind(requestId,u.user_id,u.user_id).first<{request_id:string;status:string;requester_id:string;owner_id:string|null}>();
    if(!q)return reply({error:"request_not_found",message:"This request is not available to your account."},404);
    if(!q.owner_id)return reply({error:"sample_listing_no_owner",message:"This sample listing has no signed-in owner account yet."},409);
    const owner=q.owner_id===u.user_id, requester=q.requester_id===u.user_id;
    let allowed=false;
    if(owner&&q.status==="pending"&&["approved","declined"].includes(next))allowed=true;
    if(requester&&q.status==="pending"&&next==="cancelled")allowed=true;
    if((owner||requester)&&q.status==="approved"&&["active","cancelled"].includes(next))allowed=true;
    if((owner||requester)&&q.status==="active"&&next==="completed")allowed=true;
    if(!allowed)return reply({error:"invalid_transition",message:"That action is not available at this stage of the exchange."},409);
    const now=new Date().toISOString();
    await db.prepare("UPDATE gyanshala_resource_requests SET status=?,updated_at=? WHERE request_id=?").bind(next,now,requestId).run();
    if(["declined","cancelled","completed"].includes(next)){
      await db.prepare("DELETE FROM gyanshala_live_locations WHERE request_id=?").bind(requestId).run();
    }
    return reply({ok:true,requestId,status:next,updatedAt:now,trackingAvailable:next==="approved"||next==="active"});
  }catch{
    return reply({error:"request_update_failed",message:"Could not update this exchange. Please try again."},503);
  }
}
async function updateLiveLocation(r:Request,e:GEnv,requestId:string):Promise<Response>{
  const u=await getUser(r,e);
  if(!u)return reply({error:"authentication_required"},401);
  if(u.profile_complete!==1)return reply({error:"profile_incomplete"},403);
  if(!e.GYANSHALA_DB)return reply({error:"database_not_configured"},503);
  const b=await body(r);
  try{
    const db=e.GYANSHALA_DB;
    const q=await db.prepare("SELECT request_id,status,requester_id,owner_id FROM gyanshala_resource_requests WHERE request_id=? AND (requester_id=? OR owner_id=?) LIMIT 1")
      .bind(requestId,u.user_id,u.user_id).first<{request_id:string;status:string;requester_id:string;owner_id:string|null}>();
    if(!q)return reply({error:"tracking_not_found"},404);
    if(b?.stop===true){
      await db.prepare("DELETE FROM gyanshala_live_locations WHERE request_id=? AND user_id=?").bind(requestId,u.user_id).run();
      return reply({ok:true,sharing:false});
    }
    if(!q.owner_id||!["approved","active"].includes(q.status))
      return reply({error:"tracking_not_active",message:"Location sharing is available only after the owner accepts the request."},409);
    const lat=typeof b?.latitude==="number"?b.latitude:Number(b?.latitude);
    const lng=typeof b?.longitude==="number"?b.longitude:Number(b?.longitude);
    const accuracy=typeof b?.accuracyM==="number"?b.accuracyM:Number(b?.accuracyM||0);
    if(!Number.isFinite(lat)||lat < -90||lat > 90||!Number.isFinite(lng)||lng < -180||lng > 180||
       !Number.isFinite(accuracy)||accuracy<0||accuracy>10000)
      return reply({error:"invalid_location",message:"The location update was invalid."},400);
    const now=new Date().toISOString();
    await db.prepare(
      "INSERT INTO gyanshala_live_locations(request_id,user_id,latitude,longitude,accuracy_m,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(request_id,user_id) DO UPDATE SET latitude=excluded.latitude,longitude=excluded.longitude,accuracy_m=excluded.accuracy_m,updated_at=excluded.updated_at"
    ).bind(requestId,u.user_id,lat,lng,accuracy,now).run();
    return reply({ok:true,sharing:true,updatedAt:now});
  }catch{
    return reply({error:"location_update_failed",message:"Could not update your location. Please try again."},503);
  }
}

const SUPPLY_CATEGORIES = ["Academic", "Books", "Electronics", "Hostel Essentials", "Lab Equipment", "Sports", "Stationery", "Daily Essentials", "Tools", "Other"] as const;
type SupplyCategory = typeof SUPPLY_CATEGORIES[number];
type SupplyType = "donation" | "borrow" | "sell";
type SupplyHostelSeed = { id:string; name:string; latitude:number; longitude:number };
type SupplySeed = { slug:string; name:string; aliases:string[]; category:SupplyCategory; description:string; condition:string; offerType:SupplyType; basePrice:number };
const SUPPLY_HOSTELS: SupplyHostelSeed[] = (() => {
  const names = [
    "Boys Hostel 1","Boys Hostel 2","Boys Hostel 3","Boys Hostel 4","Boys Hostel 5","Boys Hostel 6","Boys Hostel 7","Boys Hostel 8",
    "Boys Hostel 9A","Boys Hostel 9B","Boys Hostel 9C","Boys Hostel 9D",
    "Girls Hostel 1","Girls Hostel 2","Girls Hostel 3","PG Hostel","Married Scholar Hostel"
  ];
  return names.map((name,i) => {
    const row=i%5, col=Math.floor(i/5);
    return {id:"gy-hostel-"+String(i+1).padStart(2,"0"),name,latitude:24.7551+(row-2)*0.00165+(col%2)*0.00025,longitude:92.78682+(col-1.5)*0.00225+(row%2)*0.00018};
  });
})();
const SUPPLY_SEEDS: SupplySeed[] = [
  {slug:"scientific-calculator",name:"Scientific Calculator",aliases:["engineering calculator","fx-991 style calculator","calculator"],category:"Electronics",description:"Scientific calculator for engineering mathematics, calculus, circuits and lab calculations.",condition:"Good",offerType:"borrow",basePrice:0},
  {slug:"basic-calculator",name:"Basic Calculator",aliases:["pocket calculator","desk calculator"],category:"Electronics",description:"Basic four-function calculator for everyday calculations.",condition:"Good",offerType:"donation",basePrice:0},
  {slug:"drawing-kit",name:"Engineering Drawing Kit",aliases:["drafter kit","geometry box","set square","drawing instruments"],category:"Stationery",description:"Engineering drawing kit with set squares, compass, divider and pencils.",condition:"Good",offerType:"sell",basePrice:180},
  {slug:"drawing-board",name:"Mini Drawing Board",aliases:["drafting board","drawing board"],category:"Stationery",description:"Portable board for engineering graphics and drawing practice.",condition:"Fair",offerType:"borrow",basePrice:0},
  {slug:"lab-coat",name:"Lab Coat",aliases:["white coat","laboratory coat","lab apron"],category:"Lab Equipment",description:"Clean lab coat for practical sessions. Confirm size and lab safety rules.",condition:"Very good",offerType:"donation",basePrice:0},
  {slug:"safety-goggles",name:"Safety Goggles",aliases:["lab goggles","protective glasses","safety glasses"],category:"Lab Equipment",description:"Protective eyewear for supervised lab work.",condition:"Good",offerType:"donation",basePrice:0},
  {slug:"breadboard-kit",name:"Breadboard & Jumper Wire Kit",aliases:["breadboard","jumper wires","electronics kit"],category:"Lab Equipment",description:"Breadboard, jumper wires and common components for supervised electronics practice.",condition:"Good",offerType:"borrow",basePrice:0},
  {slug:"multimeter",name:"Digital Multimeter",aliases:["multimeter","voltmeter","electrical tester"],category:"Lab Equipment",description:"Digital multimeter for basic voltage and continuity checks under lab guidance.",condition:"Good",offerType:"borrow",basePrice:0},
  {slug:"soldering-iron",name:"Soldering Iron Kit",aliases:["solder iron","soldering kit","solder wire"],category:"Tools",description:"Basic soldering iron and stand for supervised electronics work.",condition:"Fair",offerType:"borrow",basePrice:0},
  {slug:"usb-c-charger",name:"USB-C Phone Charger",aliases:["type c charger","phone adapter","fast charger"],category:"Electronics",description:"USB-C wall adapter for phone and small-device charging.",condition:"Good",offerType:"sell",basePrice:250},
  {slug:"laptop-charger",name:"Laptop Charger",aliases:["notebook charger","power adapter","laptop adapter"],category:"Electronics",description:"Spare laptop power adapter. Confirm connector and wattage before pickup.",condition:"Good",offerType:"borrow",basePrice:0},
  {slug:"power-bank",name:"Power Bank",aliases:["portable charger","battery pack"],category:"Electronics",description:"Portable battery pack for phones and other compatible devices.",condition:"Good",offerType:"borrow",basePrice:0},
  {slug:"wired-mouse",name:"Wired USB Mouse",aliases:["computer mouse","mouse"],category:"Electronics",description:"Wired USB mouse for laptop or desktop use.",condition:"Good",offerType:"donation",basePrice:0},
  {slug:"keyboard",name:"USB Keyboard",aliases:["computer keyboard","external keyboard"],category:"Electronics",description:"External keyboard for laptop or desktop use.",condition:"Fair",offerType:"borrow",basePrice:0},
  {slug:"hdmi-cable",name:"HDMI Cable",aliases:["display cable","monitor cable","hdmi"],category:"Electronics",description:"HDMI cable for connecting a laptop to a display or projector.",condition:"Good",offerType:"borrow",basePrice:0},
  {slug:"ethernet-cable",name:"Ethernet Cable",aliases:["lan cable","network cable","rj45 cable"],category:"Electronics",description:"Ethernet cable for compatible wired network connections.",condition:"Good",offerType:"donation",basePrice:0},
  {slug:"headphones",name:"Wired Earphones",aliases:["earbuds","headphones","audio earphones"],category:"Electronics",description:"Wired earphones for study and online classes.",condition:"Good",offerType:"sell",basePrice:100},
  {slug:"semester-books",name:"Semester Book Bundle",aliases:["textbook bundle","semester books","engineering books","used books"],category:"Books",description:"A bundle of used semester textbooks and reference books. Ask for the included titles.",condition:"Good",offerType:"donation",basePrice:0},
  {slug:"dsa-textbook",name:"Data Structures Textbook",aliases:["dsa book","data structures","algorithms textbook"],category:"Books",description:"Used data structures and algorithms textbook for semester study.",condition:"Good",offerType:"borrow",basePrice:0},
  {slug:"maths-textbook",name:"Engineering Mathematics Textbook",aliases:["maths book","calculus book","engineering maths"],category:"Books",description:"Mathematics reference book covering calculus, linear algebra and engineering topics.",condition:"Good",offerType:"sell",basePrice:220},
  {slug:"notebook-pack",name:"Notebook Pack",aliases:["notebooks","registers","class notebook"],category:"Stationery",description:"Ruled notebooks for lecture notes and assignments.",condition:"New",offerType:"sell",basePrice:90},
  {slug:"pens-highlighters",name:"Pens & Highlighters Set",aliases:["pens","markers","highlighter pens","stationery"],category:"Stationery",description:"Pens and highlighters for note-taking and revision.",condition:"New",offerType:"donation",basePrice:0},
  {slug:"exam-pad",name:"Exam Writing Pad",aliases:["clipboard","writing board","exam board"],category:"Stationery",description:"Firm writing pad for tests and everyday note-taking.",condition:"Good",offerType:"donation",basePrice:0},
  {slug:"extension-board",name:"Extension Board",aliases:["power strip","extension cord","multi plug"],category:"Hostel Essentials",description:"Extension board for hostel desk use. Check socket and electrical safety before use.",condition:"Good",offerType:"borrow",basePrice:0},
  {slug:"desk-lamp",name:"LED Study Lamp",aliases:["table lamp","reading lamp","study light"],category:"Hostel Essentials",description:"LED desk lamp for late-evening study.",condition:"Good",offerType:"borrow",basePrice:0},
  {slug:"mini-fan",name:"Mini Desk Fan",aliases:["table fan","small fan","desk fan"],category:"Hostel Essentials",description:"Compact desk fan for a study table.",condition:"Fair",offerType:"sell",basePrice:300},
  {slug:"umbrella",name:"Umbrella",aliases:["rain umbrella","monsoon umbrella"],category:"Daily Essentials",description:"Foldable umbrella for rainy campus walks.",condition:"Good",offerType:"donation",basePrice:0},
  {slug:"raincoat",name:"Raincoat",aliases:["rain jacket","waterproof jacket"],category:"Daily Essentials",description:"Rain protection for walking around campus in wet weather.",condition:"Good",offerType:"borrow",basePrice:0},
  {slug:"water-bottle",name:"Reusable Water Bottle",aliases:["water flask","bottle"],category:"Daily Essentials",description:"Reusable water bottle for classes and campus activities.",condition:"Good",offerType:"donation",basePrice:0},
  {slug:"lunch-box",name:"Reusable Lunch Box",aliases:["tiffin","food container","lunch container"],category:"Daily Essentials",description:"Reusable food container for carrying meals or snacks.",condition:"Good",offerType:"donation",basePrice:0},
  {slug:"bed-sheet",name:"Spare Bed Sheet",aliases:["bedsheet","linen","hostel bedsheet"],category:"Hostel Essentials",description:"Clean spare bed sheet for hostel use.",condition:"Good",offerType:"sell",basePrice:180},
  {slug:"pillow",name:"Pillow",aliases:["sleeping pillow","hostel pillow"],category:"Hostel Essentials",description:"Spare pillow for a hostel room.",condition:"Good",offerType:"sell",basePrice:150},
  {slug:"laundry-basket",name:"Laundry Basket",aliases:["clothes basket","laundry hamper"],category:"Hostel Essentials",description:"Compact laundry basket for a shared hostel room.",condition:"Good",offerType:"donation",basePrice:0},
  {slug:"toiletry-kit",name:"Toiletry Kit",aliases:["toiletries","toothbrush kit","personal care kit"],category:"Daily Essentials",description:"Basic personal-care kit for hostel living.",condition:"New",offerType:"sell",basePrice:120},
  {slug:"bicycle-lock",name:"Bicycle Lock",aliases:["cycle lock","bike lock","cable lock"],category:"Hostel Essentials",description:"Cable lock for a bicycle parked on campus.",condition:"Good",offerType:"borrow",basePrice:0},
  {slug:"sports-shoes",name:"Sports Shoes",aliases:["running shoes","football shoes","sneakers"],category:"Sports",description:"Pair of used sports shoes. Confirm size before requesting.",condition:"Good",offerType:"donation",basePrice:0},
  {slug:"football",name:"Football",aliases:["soccer ball","football ball"],category:"Sports",description:"Football for recreational games on campus.",condition:"Good",offerType:"borrow",basePrice:0},
  {slug:"badminton-racket",name:"Badminton Racket",aliases:["racket","shuttle racket"],category:"Sports",description:"Badminton racket for casual play.",condition:"Good",offerType:"borrow",basePrice:0},
  {slug:"first-aid-kit",name:"Basic First-Aid Kit",aliases:["bandages","first aid","medical kit"],category:"Daily Essentials",description:"Basic first-aid supplies. Check expiry dates and use responsibly.",condition:"New",offerType:"donation",basePrice:0},
  {slug:"tool-kit",name:"Small Tool Kit",aliases:["screwdriver set","tools","repair kit"],category:"Tools",description:"Small basic tool kit for simple supervised repairs.",condition:"Good",offerType:"borrow",basePrice:0},
  {slug:"usb-drive",name:"USB Flash Drive",aliases:["pen drive","thumb drive","usb stick"],category:"Electronics",description:"USB storage drive for moving personal files.",condition:"Good",offerType:"sell",basePrice:180},
  {slug:"phone-stand",name:"Phone Stand",aliases:["mobile holder","phone holder"],category:"Electronics",description:"Desk phone stand for study or video calls.",condition:"Good",offerType:"donation",basePrice:0},
  {slug:"thermos",name:"Thermal Flask",aliases:["thermos","hot water flask","vacuum flask"],category:"Daily Essentials",description:"Reusable insulated flask for hot or cold drinks.",condition:"Good",offerType:"sell",basePrice:220},
  {slug:"graph-paper",name:"Graph Paper Pack",aliases:["graph sheets","engineering graph paper"],category:"Stationery",description:"Graph paper for assignments, lab records and plotting.",condition:"New",offerType:"donation",basePrice:0},
  {slug:"whiteboard-markers",name:"Whiteboard Markers",aliases:["board markers","dry erase markers"],category:"Stationery",description:"Markers for group study and whiteboard practice.",condition:"Good",offerType:"donation",basePrice:0},
  {slug:"laptop-stand",name:"Laptop Stand",aliases:["notebook stand","computer stand"],category:"Electronics",description:"Foldable stand to raise a laptop on a study desk.",condition:"Good",offerType:"borrow",basePrice:0},
  {slug:"phone-tripod",name:"Mini Phone Tripod",aliases:["mobile tripod","phone holder tripod"],category:"Electronics",description:"Small tripod for a phone or small camera.",condition:"Good",offerType:"borrow",basePrice:0},
  {slug:"lab-record-book",name:"Lab Record Notebook",aliases:["practical record book","lab journal"],category:"Lab Equipment",description:"Notebook for recording lab observations and practical results.",condition:"New",offerType:"sell",basePrice:80},
  {slug:"safety-mask",name:"Reusable Safety Mask",aliases:["protective mask","dust mask"],category:"Lab Equipment",description:"Reusable face covering for dusty workshop environments.",condition:"Good",offerType:"donation",basePrice:0},
  {slug:"screwdriver-set",name:"Precision Screwdriver Set",aliases:["small screwdriver","electronics screwdriver"],category:"Tools",description:"Precision screwdriver set for small devices; do not open mains-powered equipment.",condition:"Good",offerType:"borrow",basePrice:0}
];
function normalizeSupplyText(value: unknown, max = 100): string {
  return typeof value === "string" ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,max) : "";
}
async function ensureSmartSupplyDemoData(e:GEnv):Promise<void>{
  if(!previewTestMode(e)||!e.GYANSHALA_DB)return;
  const db=e.GYANSHALA_DB;
  const hostelCount=await db.prepare("SELECT COUNT(*) AS total FROM gyanshala_supply_hostels WHERE is_demo=1").first<{total:number}>();
  if(Number(hostelCount?.total||0)<SUPPLY_HOSTELS.length){
    for(const h of SUPPLY_HOSTELS){
      await db.prepare("INSERT INTO gyanshala_supply_hostels(hostel_id,name,latitude,longitude,coordinate_source,is_demo,status,created_at,updated_at) VALUES(?,?,?,?,'demo_approximation',1,'active',?,?) ON CONFLICT(hostel_id) DO NOTHING")
        .bind(h.id,h.name,h.latitude,h.longitude,new Date().toISOString(),new Date().toISOString()).run();
    }
  }
  const expected=SUPPLY_HOSTELS.length*SUPPLY_SEEDS.length;
  const inventoryCount=await db.prepare("SELECT COUNT(*) AS total FROM gyanshala_supply_inventory WHERE is_demo=1").first<{total:number}>();
  if(Number(inventoryCount?.total||0)>=expected)return;
  const now=new Date().toISOString();
  for(let h=0;h<SUPPLY_HOSTELS.length;h++){
    const hostel=SUPPLY_HOSTELS[h];
    for(let i=0;i<SUPPLY_SEEDS.length;i++){
      const item=SUPPLY_SEEDS[i];
      const quantity=((h*7+i*3)%11===0)?0:1+((h*3+i*5)%5);
      const status=quantity>0?"available":"unavailable";
      const offerType=item.offerType;
      const isFree=offerType==="donation"||offerType==="borrow";
      const price=offerType==="sell"?Math.max(10,item.basePrice+(((h+i)%4)*15)):0;
      const condition=item.condition;
      const id="gy-demo-supply-"+hostel.id.slice(-2)+"-"+item.slug;
      await db.prepare("INSERT INTO gyanshala_supply_inventory(supply_id,hostel_id,name,aliases,category,description,item_condition,offer_type,price_amount,quantity_available,status,is_demo,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?,?) ON CONFLICT(supply_id) DO NOTHING")
        .bind(id,hostel.id,item.name,item.aliases.join("|"),item.category,item.description,condition,offerType,price,quantity,status,now,now).run();
    }
  }
}
function parseSupplyQueryFallback(query:string):Record<string,unknown>{
  const q=query.toLowerCase();
  const category=SUPPLY_CATEGORIES.find(c=>q.includes(c.toLowerCase()))||null;
  const guessedType:SupplyType|"any"=/(donat|free|give away|no cost)/.test(q)?"donation":/(borrow|lend|loan|temporary)/.test(q)?"borrow":/(buy|purchase|for sale|under rupees|under rs|under ₹|price)/.test(q)?"sell":"any";
  const priceMatch=q.match(/(?:under|below|max(?:imum)?|less than)\s*(?:₹|rs\.?\s*)?(\d{1,6})/);
  const item=query.replace(/(?:under|below|max(?:imum)?|less than)\s*(?:₹|rs\.?\s*)?\d{1,6}/ig,"").replace(/\b(please|i need|i want|find me|find|looking for|show me|near me|available|available now|under|below|for rent|to borrow|to buy|for sale)\b/ig," ").replace(/\s+/g," ").trim();
  return {isSupplySearch:true,item:item||query,aliases:[],category,offerType:guessedType,maxPrice:priceMatch?Number(priceMatch[1]):null,quantity:1,urgent:/\b(urgent|today|now|immediately|tomorrow|practical|exam)\b/.test(q)};
}
async function interpretSupplySearch(e:GEnv,query:string):Promise<{filters:Record<string,unknown>;usedGemini:boolean}>{
  const key=e.GYANSHALA_GEMINI_API_KEY?.trim();
  if(!key)return {filters:parseSupplyQueryFallback(query),usedGemini:false};
  const schema={
    type:"OBJECT",properties:{
      isSupplySearch:{type:"BOOLEAN",description:"True only when the user is seeking a physical item/supply available on campus."},
      item:{type:"STRING",description:"Short canonical physical item name, empty for unrelated conversation."},
      aliases:{type:"ARRAY",items:{type:"STRING"},description:"Up to six useful item synonyms."},
      category:{type:["STRING","NULL"],enum:[...SUPPLY_CATEGORIES,null]},
      offerType:{type:"STRING",enum:["donation","borrow","sell","any"]},
      maxPrice:{type:["NUMBER","NULL"]},
      quantity:{type:"INTEGER",minimum:1,maximum:10},
      urgent:{type:"BOOLEAN"}
    },required:["isSupplySearch","item","aliases","category","offerType","maxPrice","quantity","urgent"]
  };
  const model=(e.GYANSHALA_GEMINI_MODEL||"gemini-3.8-flash").trim().replace(/[^A-Za-z0-9._-]/g,"");
  try{
    const response=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent?key="+encodeURIComponent(key),{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        systemInstruction:{parts:[{text:"You are the query parser for Gyanshala Smart Supply Locator at NIT Silchar. This is NOT a chatbot. Only interpret searches for physical supplies that could exist in a campus inventory. Never answer the user, never recommend imaginary stock, never create facts. For questions, greetings, coding help, jokes, weather, or unrelated conversation, set isSupplySearch=false and item empty. Extract item synonyms and strict filters only. Return JSON matching the provided schema."}]},
        contents:[{role:"user",parts:[{text:query.slice(0,500)}]}],
        generationConfig:{responseMimeType:"application/json",responseSchema:schema,temperature:0}
      })
    });
    if(!response.ok)throw new Error("Gemini supply parser returned "+response.status);
    const data=await response.json() as {candidates?:Array<{content?:{parts?:Array<{text?:string}>}}>} ;
    const text=data.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("")||"";
    const value=JSON.parse(text) as Record<string,unknown>;
    const isSupplySearch=value.isSupplySearch===true;
    const item=normalizeSupplyText(value.item,80);
    const aliases=Array.isArray(value.aliases)?value.aliases.filter((x):x is string=>typeof x==="string").map(x=>normalizeSupplyText(x,60)).filter(Boolean).slice(0,6):[];
    const category=typeof value.category==="string"&&SUPPLY_CATEGORIES.includes(value.category as SupplyCategory)?value.category:null;
    const offerType=["donation","borrow","sell","any"].includes(String(value.offerType))?String(value.offerType):"any";
    const maxPrice=typeof value.maxPrice==="number"&&Number.isFinite(value.maxPrice)&&value.maxPrice>=0&&value.maxPrice<=1000000?Math.round(value.maxPrice):null;
    const quantity=typeof value.quantity==="number"&&Number.isFinite(value.quantity)?Math.max(1,Math.min(10,Math.round(value.quantity))):1;
    return {filters:{isSupplySearch,item,aliases,category,offerType,maxPrice,quantity,urgent:value.urgent===true},usedGemini:true};
  }catch{
    return {filters:parseSupplyQueryFallback(query),usedGemini:false};
  }
}
function distanceMetersBetween(aLat:number,aLng:number,bLat:number,bLng:number):number{
  const rad=(v:number)=>v*Math.PI/180;
  const dLat=rad(bLat-aLat),dLng=rad(bLng-aLng);
  const value=Math.sin(dLat/2)**2+Math.cos(rad(aLat))*Math.cos(rad(bLat))*Math.sin(dLng/2)**2;
  return 6371000*2*Math.atan2(Math.sqrt(value),Math.sqrt(Math.max(0,1-value)));
}
async function computeWalkingDistances(e:GEnv,origin:{latitude:number;longitude:number}|null,hostels:SupplyHostelSeed[]):Promise<Map<string,{meters:number;seconds:number}>|null>{
  const key=e.GYANSHALA_GOOGLE_MAPS_SERVER_KEY?.trim();
  if(!key||!origin||!hostels.length)return null;
  try{
    const response=await fetch("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix",{
      method:"POST",
      headers:{"Content-Type":"application/json","X-Goog-Api-Key":key,"X-Goog-FieldMask":"originIndex,destinationIndex,distanceMeters,duration,status,condition"},
      body:JSON.stringify({
        origins:[{waypoint:{location:{latLng:{latitude:origin.latitude,longitude:origin.longitude}}}}],
        destinations:hostels.map(h=>({waypoint:{location:{latLng:{latitude:h.latitude,longitude:h.longitude}}}})),
        travelMode:"WALK"
      })
    });
    if(!response.ok)return null;
    const payload=await response.json() as Array<{originIndex?:number;destinationIndex?:number;distanceMeters?:number;duration?:string;condition?:string;status?:{code?:number}}>;
    if(!Array.isArray(payload))return null;
    const result=new Map<string,{meters:number;seconds:number}>();
    for(const row of payload){
      const hostel=hostels[row.destinationIndex||0];
      if(!hostel||row.condition==="ROUTE_NOT_FOUND"||row.status&&row.status.code&&row.status.code!==0||typeof row.distanceMeters!=="number")continue;
      const seconds=typeof row.duration==="string"?Number(row.duration.replace(/s$/,"")):0;
      result.set(hostel.id,{meters:row.distanceMeters,seconds:Number.isFinite(seconds)?seconds:0});
    }
    return result.size?result:null;
  }catch{return null;}
}
async function findSmartSupplies(r:Request,e:GEnv):Promise<Response>{
  const u=await getUser(r,e);
  if(!u)return reply({error:"authentication_required",message:"Sign in to use the campus supply finder."},401);
  if(u.profile_complete!==1)return reply({error:"profile_incomplete",message:"Complete your student profile first."},403);
  if(!e.GYANSHALA_DB)return reply({error:"database_not_configured"},503);
  const b=await body(r);
  const query=normalizeSupplyText(b?.query,500);
  if(query.length<2)return reply({error:"query_required",message:"Describe the physical item you need."},400);
  const lat=typeof b?.latitude==="number"?b.latitude:Number(b?.latitude);
  const lng=typeof b?.longitude==="number"?b.longitude:Number(b?.longitude);
  const hasGps=Number.isFinite(lat)&&lat>=-90&&lat<=90&&Number.isFinite(lng)&&lng>=-180&&lng<=180;
  const originHostelId=normalizeSupplyText(b?.originHostelId,60);
  try{
    await ensureSmartSupplyDemoData(e);
    const interpreted=await interpretSupplySearch(e,query);
    const filters=interpreted.filters;
    if(filters.isSupplySearch!==true||!normalizeSupplyText(filters.item,80)){
      return reply({ok:true,usedGemini:interpreted.usedGemini,mode:interpreted.usedGemini?"gemini":"keyword_fallback",isSupplySearch:false,message:"I’m Gyanshala’s supply finder. Describe a physical item you need (for example, “borrow a scientific calculator under ₹300 near my hostel”). I only search campus inventory; I don’t handle general conversations.",results:[]});
    }
    const db=e.GYANSHALA_DB;
    const hostelRows=await db.prepare("SELECT hostel_id,name,latitude,longitude,coordinate_source,is_demo FROM gyanshala_supply_hostels WHERE status='active' ORDER BY name").all<{hostel_id:string;name:string;latitude:number;longitude:number;coordinate_source:string;is_demo:number}>();
    const hostels=(hostelRows.results||[]).map(h=>({id:h.hostel_id,name:h.name,latitude:h.latitude,longitude:h.longitude,coordinateSource:h.coordinate_source,isDemo:h.is_demo===1}));
    const selectedHostel=hostels.find(h=>h.id===originHostelId)||null;
    const origin=hasGps?{latitude:lat,longitude:lng}:selectedHostel?{latitude:selectedHostel.latitude,longitude:selectedHostel.longitude}:null;
    const terms=[normalizeSupplyText(filters.item,80),...(Array.isArray(filters.aliases)?filters.aliases.filter((x):x is string=>typeof x==="string").slice(0,6):[])].filter(x=>x.length>=2);
    const deduped=[...new Set(terms.map(x=>x.toLowerCase()))];
    const category=typeof filters.category==="string"&&SUPPLY_CATEGORIES.includes(filters.category as SupplyCategory)?filters.category:null;
    const offer=String(filters.offerType||"any");
    const quantity=Math.max(1,Math.min(10,Number(filters.quantity)||1));
    const maxPrice=typeof filters.maxPrice==="number"?filters.maxPrice:null;
    const clauses=deduped.map(()=>"(lower(s.name) LIKE ? OR lower(s.aliases) LIKE ? OR lower(s.description) LIKE ? OR lower(s.category) LIKE ?)");
    const binds:unknown[]=[quantity];
    if(maxPrice!==null)binds.push(maxPrice);
    binds.push(...deduped.flatMap(t=>{const like="%"+t+"%";return[like,like,like,like];}));
    const where=["s.status='available'","s.quantity_available>=?"];
    if(maxPrice!==null)where.push("s.price_amount<=?");
    if(offer==="donation"||offer==="borrow"||offer==="sell"){where.push("s.offer_type=?");binds.push(offer);}
    if(category){where.push("s.category=?");binds.push(category);}
    if(clauses.length)where.push("("+clauses.join(" OR ")+")");
    const result=await db.prepare(
      "SELECT s.supply_id,s.name,s.aliases,s.category,s.description,s.item_condition,s.offer_type,s.price_amount,s.quantity_available,s.is_demo,s.updated_at,h.hostel_id,h.name AS hostel_name,h.latitude,h.longitude,h.coordinate_source FROM gyanshala_supply_inventory s JOIN gyanshala_supply_hostels h ON h.hostel_id=s.hostel_id WHERE "+where.join(" AND ")+" ORDER BY s.name LIMIT 500"
    ).bind(...binds).all<{supply_id:string;name:string;aliases:string;category:string;description:string;item_condition:string;offer_type:SupplyType;price_amount:number;quantity_available:number;is_demo:number;updated_at:string;hostel_id:string;hostel_name:string;latitude:number;longitude:number;coordinate_source:string}>();
    const rows=result.results||[];
    const routeHostels=[...new Map(rows.map(x=>[x.hostel_id,{id:x.hostel_id,name:x.hostel_name,latitude:x.latitude,longitude:x.longitude}])).values()];
    const walking=await computeWalkingDistances(e,origin,routeHostels);
    const scored=rows.map(row=>{
      const name=row.name.toLowerCase(),aliases=row.aliases.toLowerCase(),desc=(row.description+" "+row.category).toLowerCase();
      let relevance=0;
      for(const term of deduped){if(name===term)relevance+=120;else if(name.includes(term))relevance+=80;if(aliases.includes(term))relevance+=45;if(desc.includes(term))relevance+=20;}
      if(category&&row.category===category)relevance+=30;
      const straight=origin?distanceMetersBetween(origin.latitude,origin.longitude,row.latitude,row.longitude):null;
      const route=walking?.get(row.hostel_id)||null;
      const distance=route?.meters??straight;
      return {...row,relevance,distanceMeters:distance,straightLineMeters:straight,walkingDurationSeconds:route?.seconds??null,distanceType:route?"walking_route":straight!==null?"straight_line_estimate":"unknown"};
    }).sort((x,y)=>{
      if(origin&&x.distanceMeters!==null&&y.distanceMeters!==null&&x.distanceMeters!==y.distanceMeters)return x.distanceMeters-y.distanceMeters;
      if(y.relevance!==x.relevance)return y.relevance-x.relevance;
      return x.price_amount-y.price_amount;
    });
    const limited=scored.slice(0,40).map(x=>({
      id:x.supply_id,name:x.name,category:x.category,description:x.description,condition:x.item_condition,
      offerType:x.offer_type,priceAmount:x.price_amount,quantityAvailable:x.quantity_available,
      hostelId:x.hostel_id,hostelName:x.hostel_name,latitude:x.latitude,longitude:x.longitude,
      distanceMeters:x.distanceMeters,distanceType:x.distanceType,walkingDurationSeconds:x.walkingDurationSeconds,
      coordinateSource:x.coordinate_source,isDemo:x.is_demo===1,updatedAt:x.updated_at,
      directionsUrl:"https://www.google.com/maps/dir/?api=1&destination="+encodeURIComponent(x.latitude+","+x.longitude)+"&travelmode=walking"
    }));
    return reply({ok:true,usedGemini:interpreted.usedGemini,mode:interpreted.usedGemini?"gemini":"keyword_fallback",isSupplySearch:true,query,filters:{
      item:filters.item,aliases:deduped,category,offerType:offer,maxPrice,quantity,urgent:filters.urgent===true
    },origin:origin?{latitude:origin.latitude,longitude:origin.longitude,source:hasGps?"gps_opt_in":"selected_hostel"}:null,
      routeQuality:walking?"google_walking_route":origin?"straight_line_demo_estimate":"not_available",
      googleMapsBrowserKey:e.GYANSHALA_GOOGLE_MAPS_BROWSER_KEY||null,
      results:limited,totalMatches:scored.length,
      dataNotice:"Preview inventory is artificial test data. Hostel names follow public NIT Silchar listings, but coordinates are synthetic and must not be used as real directions."
    });
  }catch{
    return reply({error:"supply_search_failed",message:"The campus inventory could not be searched. Please try again."},503);
  }
}
async function reserveSmartSupply(r:Request,e:GEnv,supplyId:string):Promise<Response>{
  const u=await getUser(r,e);
  if(!u)return reply({error:"authentication_required"},401);
  if(u.profile_complete!==1)return reply({error:"profile_incomplete"},403);
  if(!e.GYANSHALA_DB)return reply({error:"database_not_configured"},503);
  const b=await body(r);
  const quantity=typeof b?.quantity==="number"?Math.round(b.quantity):1;
  if(!Number.isInteger(quantity)||quantity<1||quantity>10)return reply({error:"invalid_quantity",message:"Request between 1 and 10 units."},400);
  const db=e.GYANSHALA_DB;
  try{
    await ensureSmartSupplyDemoData(e);
    const supply=await db.prepare("UPDATE gyanshala_supply_inventory SET quantity_available=quantity_available-?,status=CASE WHEN quantity_available-?<=0 THEN 'unavailable' ELSE 'available' END,updated_at=? WHERE supply_id=? AND status='available' AND quantity_available>=? RETURNING supply_id,name,hostel_id,quantity_available")
      .bind(quantity,quantity,new Date().toISOString(),supplyId,quantity).first<{supply_id:string;name:string;hostel_id:string;quantity_available:number}>();
    if(!supply)return reply({error:"supply_unavailable",message:"That quantity is no longer available. Search again to see the nearest available match."},409);
    const requestId="gysr_"+token(18),now=new Date().toISOString();
    try{
      await db.prepare("INSERT INTO gyanshala_supply_requests(request_id,supply_id,requester_id,quantity,status,is_demo,created_at,updated_at) VALUES(?,?,?,?,'reserved',1,?,?)")
        .bind(requestId,supplyId,u.user_id,quantity,now,now).run();
    }catch{
      await db.prepare("UPDATE gyanshala_supply_inventory SET quantity_available=quantity_available+?,status='available',updated_at=? WHERE supply_id=?").bind(quantity,now,supplyId).run();
      throw new Error("reservation_insert_failed");
    }
    return reply({ok:true,requestId,supplyId,name:supply.name,quantity,status:"reserved",remaining:supply.quantity_available,hostelId:supply.hostel_id,message:"Reserved in preview. This is test inventory, not a real student offer."},201);
  }catch{
    return reply({error:"reservation_failed",message:"Could not reserve the supply. Search again and retry."},503);
  }
}
async function cancelSmartSupplyReservation(r:Request,e:GEnv,requestId:string):Promise<Response>{
  const u=await getUser(r,e);
  if(!u)return reply({error:"authentication_required"},401);
  if(!e.GYANSHALA_DB)return reply({error:"database_not_configured"},503);
  try{
    const db=e.GYANSHALA_DB,now=new Date().toISOString();
    const request=await db.prepare("UPDATE gyanshala_supply_requests SET status='cancelled',updated_at=? WHERE request_id=? AND requester_id=? AND status='reserved' RETURNING supply_id,quantity")
      .bind(now,requestId,u.user_id).first<{supply_id:string;quantity:number}>();
    if(!request)return reply({error:"reservation_not_found",message:"An active reservation for this account was not found."},404);
    await db.prepare("UPDATE gyanshala_supply_inventory SET quantity_available=quantity_available+?,status='available',updated_at=? WHERE supply_id=?").bind(request.quantity,now,request.supply_id).run();
    return reply({ok:true,requestId,status:"cancelled",message:"Reservation cancelled and demo stock restored."});
  }catch{return reply({error:"reservation_cancel_failed",message:"Could not cancel this reservation."},503);}
}
type MessageThreadRow = {
  request_id:string; status:string; request_created_at:string; resource_id:string; resource_title:string; category:string;
  other_name:string|null; other_branch:string|null; last_body:string|null; last_message_at:string|null;
  last_sender_id:string|null; unread_count:number;
};
type MessageRow = {
  message_id:string; request_id:string; sender_id:string; recipient_id:string; body:string; read_at:string|null;
  created_at:string; sender_name:string|null; sender_branch:string|null;
};
function messageView(m: MessageRow, userId: string) {
  return { id:m.message_id, requestId:m.request_id, senderId:m.sender_id, senderName:m.sender_name || "Student",
    senderBranch:m.sender_branch || "", body:m.body, createdAt:m.created_at, isMine:m.sender_id === userId };
}
async function listMessageThreads(r: Request, e: GEnv): Promise<Response> {
  const u = await getUser(r, e);
  if (!u) return reply({ error:"authentication_required", message:"Sign in to view messages." },401);
  if (u.profile_complete !== 1) return reply({ error:"profile_incomplete" },403);
  if (!e.GYANSHALA_DB) return reply({ error:"database_not_configured" },503);
  try {
    const rows = await e.GYANSHALA_DB.prepare(
      "SELECT q.request_id,q.status,q.created_at AS request_created_at,r.resource_id,r.title AS resource_title,r.category,CASE WHEN q.requester_id=? THEN owner.full_name ELSE requester.full_name END AS other_name,CASE WHEN q.requester_id=? THEN owner.branch ELSE requester.branch END AS other_branch,(SELECT m.body FROM gyanshala_messages m WHERE m.request_id=q.request_id ORDER BY m.created_at DESC LIMIT 1) AS last_body,(SELECT m.created_at FROM gyanshala_messages m WHERE m.request_id=q.request_id ORDER BY m.created_at DESC LIMIT 1) AS last_message_at,(SELECT m.sender_id FROM gyanshala_messages m WHERE m.request_id=q.request_id ORDER BY m.created_at DESC LIMIT 1) AS last_sender_id,(SELECT COUNT(*) FROM gyanshala_messages m WHERE m.request_id=q.request_id AND m.recipient_id=? AND m.read_at IS NULL) AS unread_count FROM gyanshala_resource_requests q JOIN gyanshala_resources r ON r.resource_id=q.resource_id LEFT JOIN gyanshala_users requester ON requester.user_id=q.requester_id LEFT JOIN gyanshala_users owner ON owner.user_id=q.owner_id WHERE q.owner_id IS NOT NULL AND (q.requester_id=? OR q.owner_id=?) ORDER BY COALESCE((SELECT m.created_at FROM gyanshala_messages m WHERE m.request_id=q.request_id ORDER BY m.created_at DESC LIMIT 1),q.updated_at,q.created_at) DESC LIMIT 100"
    ).bind(u.user_id,u.user_id,u.user_id,u.user_id,u.user_id).all<MessageThreadRow>();
    const threads = (rows.results || []).map(x => ({
      requestId:x.request_id,status:x.status,requestCreatedAt:x.request_created_at,resourceId:x.resource_id,
      resourceTitle:x.resource_title,category:x.category,otherName:x.other_name || "Student",
      otherBranch:x.other_branch || "",lastMessage:x.last_body || "Start the conversation",
      lastMessageAt:x.last_message_at,unreadCount:Number(x.unread_count || 0)
    }));
    return reply({ok:true,threads,total:threads.length});
  } catch {
    return reply({error:"messages_unavailable",message:"Conversations are temporarily unavailable. Try again."},503);
  }
}
async function getMessageThread(r: Request, e: GEnv, requestId: string): Promise<Response> {
  const u = await getUser(r, e);
  if (!u) return reply({error:"authentication_required"},401);
  if (u.profile_complete !== 1) return reply({error:"profile_incomplete"},403);
  if (!e.GYANSHALA_DB) return reply({error:"database_not_configured"},503);
  try {
    const db=e.GYANSHALA_DB;
    const req = await db.prepare("SELECT q.request_id,q.status,q.requester_id,q.owner_id,q.created_at,r.title AS resource_title FROM gyanshala_resource_requests q JOIN gyanshala_resources r ON r.resource_id=q.resource_id WHERE q.request_id=? AND (q.requester_id=? OR q.owner_id=?) LIMIT 1")
      .bind(requestId,u.user_id,u.user_id).first<{request_id:string;status:string;requester_id:string;owner_id:string|null;created_at:string;resource_title:string}>();
    if (!req) return reply({error:"message_thread_not_found",message:"This conversation is unavailable."},404);
    if (!req.owner_id) return reply({error:"sample_listing_no_owner",message:"This sample listing has no live owner account yet. Messages are available on resources listed by a signed-in student."},409);
    const now=new Date().toISOString();
    await db.prepare("UPDATE gyanshala_messages SET read_at=? WHERE request_id=? AND recipient_id=? AND read_at IS NULL").bind(now,requestId,u.user_id).run();
    const rows=await db.prepare("SELECT m.message_id,m.request_id,m.sender_id,m.recipient_id,m.body,m.read_at,m.created_at,u.full_name AS sender_name,u.branch AS sender_branch FROM gyanshala_messages m LEFT JOIN gyanshala_users u ON u.user_id=m.sender_id WHERE m.request_id=? ORDER BY m.created_at ASC LIMIT 300")
      .bind(requestId).all<MessageRow>();
    return reply({ok:true,thread:{requestId:req.request_id,status:req.status,resourceTitle:req.resource_title,createdAt:req.created_at},messages:(rows.results || []).map(m=>messageView(m,u.user_id))});
  } catch {
    return reply({error:"message_thread_unavailable",message:"We couldn’t open this conversation. Try again."},503);
  }
}
async function sendThreadMessage(r: Request, e: GEnv, requestId: string): Promise<Response> {
  const u = await getUser(r, e);
  if (!u) return reply({error:"authentication_required"},401);
  if (u.profile_complete !== 1) return reply({error:"profile_incomplete"},403);
  if (!e.GYANSHALA_DB) return reply({error:"database_not_configured"},503);
  const b=await body(r);
  const bodyText=typeof b?.body==="string" ? b.body.trim() : "";
  if (!bodyText || bodyText.length>1200) return reply({error:"invalid_message",message:"Write a message of 1–1,200 characters."},400);
  try {
    const db=e.GYANSHALA_DB;
    const req=await db.prepare("SELECT request_id,requester_id,owner_id FROM gyanshala_resource_requests WHERE request_id=? AND (requester_id=? OR owner_id=?) LIMIT 1")
      .bind(requestId,u.user_id,u.user_id).first<{request_id:string;requester_id:string;owner_id:string|null}>();
    if (!req) return reply({error:"message_thread_not_found",message:"This conversation is unavailable."},404);
    if (!req.owner_id) return reply({error:"sample_listing_no_owner",message:"This sample listing has no live owner account yet."},409);
    const recipientId=req.requester_id === u.user_id ? req.owner_id : req.requester_id;
    const id="gym_"+token(18),now=new Date().toISOString();
    await db.prepare("INSERT INTO gyanshala_messages(message_id,request_id,sender_id,recipient_id,body,read_at,created_at) VALUES(?,?,?,?,?,NULL,?)")
      .bind(id,requestId,u.user_id,recipientId,bodyText,now).run();
    const row=await db.prepare("SELECT m.message_id,m.request_id,m.sender_id,m.recipient_id,m.body,m.read_at,m.created_at,u.full_name AS sender_name,u.branch AS sender_branch FROM gyanshala_messages m LEFT JOIN gyanshala_users u ON u.user_id=m.sender_id WHERE m.message_id=? LIMIT 1")
      .bind(id).first<MessageRow>();
    await db.prepare("UPDATE gyanshala_resource_requests SET updated_at=? WHERE request_id=?").bind(now,requestId).run();
    return reply({ok:true,message:row ? messageView(row,u.user_id) : null},201);
  } catch {
    return reply({error:"message_send_failed",message:"Your message couldn’t be sent. Try again."},503);
  }
}

async function logout(r: Request, e: GEnv): Promise<Response> {
  const raw = readCookie(r, COOKIE);
  if (raw && e.GYANSHALA_DB && secret(e)) {
    await e.GYANSHALA_DB.prepare("DELETE FROM gyanshala_sessions WHERE token_hash=?")
      .bind(await mac(secret(e) || "", "session:" + raw)).run().catch(() => undefined);
  }
  return reply({ ok: true }, 200, { "Set-Cookie": COOKIE + "=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax" });
}




type PickupPointRow = {
  pickup_id:string; name:string; area:string; description:string; map_x:number; map_y:number;
  latitude:number; longitude:number; coordinate_source:string; walk_minutes:number; resource_count:number;
};
async function ensurePickupPoints(e:GEnv):Promise<void> {
  if (!e.GYANSHALA_DB) return;
  const db=e.GYANSHALA_DB;
  const now=new Date().toISOString();
  // OpenStreetMap-mapped landmarks; coordinates are feature centres, not doorways.
  const points=[
    ["gy-map-nit-silchar","NIT Silchar Campus","University campus","Campus-level map anchor. Confirm the exact public meetup spot with your exchange partner.",50,50,24.7551,92.78682,5],
    ["gy-map-cricket-ground","NITS Cricket Playground","Sports ground","OpenStreetMap-mapped sports ground. This pin marks the mapped feature, not an official pickup desk.",34,18,24.75731,92.78493,5],
    ["gy-map-football-ground","NITS Football Ground","Sports ground","OpenStreetMap-mapped football ground. Agree on a safe, accessible meeting point before travelling.",16,18,24.75731,92.78317,6],
    ["gy-map-indie-lake","Indie Lake","Natural landmark","Mapped lake landmark for orientation. Do not assume the shoreline is a suitable pickup point.",26,75,24.754,92.784,7],
    ["gy-map-childrens-park","NITS Childrens Park","Park","OpenStreetMap-mapped park landmark. Verify local access and agree on an exact meetup spot.",88,77,24.75393,92.79044,6],
    ["gy-map-mini-park","NITS Mini Park","Park","OpenStreetMap-mapped park landmark. Verify local access and agree on an exact meetup spot.",86,87,24.75337,92.79021,7],
    ["gy-map-football-lake","Football Ground Lake","Natural landmark","Mapped water feature for orientation; not an official or recommended pickup station.",10,23,24.7568,92.7813,8]
  ];
  // Retire old demo-only schematic anchors; never present their x/y positions as geography.
  await db.prepare("UPDATE gyanshala_pickup_points SET status='inactive',updated_at=? WHERE pickup_id LIKE 'gy-pick-%'").bind(now).run();
  for(const p of points){
    await db.prepare("INSERT INTO gyanshala_pickup_points(pickup_id,name,area,description,map_x,map_y,latitude,longitude,coordinate_source,walk_minutes,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?, 'OpenStreetMap',?,'active',?,?) ON CONFLICT(pickup_id) DO UPDATE SET name=excluded.name,area=excluded.area,description=excluded.description,map_x=excluded.map_x,map_y=excluded.map_y,latitude=excluded.latitude,longitude=excluded.longitude,coordinate_source=excluded.coordinate_source,walk_minutes=excluded.walk_minutes,status='active',updated_at=excluded.updated_at")
      .bind(p[0],p[1],p[2],p[3],p[4],p[5],p[6],p[7],p[8],now,now).run();
  }
  await db.prepare("UPDATE gyanshala_resources SET owner_name='Gyanshala Preview',owner_branch='Sample listing',pickup_location='NIT Silchar Campus',distance_label='Campus-level preview',updated_at=? WHERE owner_id IS NULL AND resource_id LIKE 'gy-rsc-%'").bind(now).run();
  await db.prepare("UPDATE gyanshala_community_posts SET pickup_location='NIT Silchar Campus',updated_at=? WHERE owner_id IS NULL AND post_id LIKE 'gy-post-%'").bind(now).run();
}
async function listPickupLocations(r:Request,e:GEnv):Promise<Response>{
  const u=await getUser(r,e);
  if(!u) return reply({error:"authentication_required",message:"Sign in to view campus pickup locations."},401);
  if(u.profile_complete!==1) return reply({error:"profile_incomplete"},403);
  if(!e.GYANSHALA_DB) return reply({error:"database_not_configured"},503);
  try{
    await seedPreviewResources(e);
    await ensurePickupPoints(e);
    const db=e.GYANSHALA_DB;
    const points=await db.prepare("SELECT p.pickup_id,p.name,p.area,p.description,p.map_x,p.map_y,p.latitude,p.longitude,p.coordinate_source,p.walk_minutes,COUNT(r.resource_id) AS resource_count FROM gyanshala_pickup_points p LEFT JOIN gyanshala_resources r ON r.status='available' AND r.pickup_location=p.name WHERE p.status='active' GROUP BY p.pickup_id ORDER BY p.map_y,p.map_x").all<PickupPointRow>();
    const resources=await db.prepare("SELECT r.*,rq.status AS request_status FROM gyanshala_resources r LEFT JOIN gyanshala_resource_requests rq ON rq.resource_id=r.resource_id AND rq.requester_id=? WHERE r.status='available' ORDER BY r.created_at DESC,r.title ASC LIMIT 80").bind(u.user_id).all<ResourceRow>();
    const available=(resources.results||[]).map(resourceView);
    const locations=(points.results||[]).map(p=>({
      id:p.pickup_id,name:p.name,area:p.area,description:p.description,mapX:p.map_x,mapY:p.map_y,
      latitude:p.latitude,longitude:p.longitude,coordinateSource:p.coordinate_source,
      resourceCount:Number(p.resource_count||0),resources:available.filter(x=>x.pickupLocation===p.name).slice(0,8)
    }));
    return reply({ok:true,locations,total:locations.length,mapProvider:"OpenFreeMap",dataSource:"OpenStreetMap",routingAvailable:false});
  }catch{
    return reply({error:"pickup_locations_unavailable",message:"Campus pickup locations are temporarily unavailable. Try again."},503);
  }
}
type CommunityPostRow={
  post_id:string;owner_id:string|null;post_type:"offer"|"need";title:string;category:string;description:string;
  pickup_location:string;owner_name:string;owner_branch:string;status:"active"|"fulfilled"|"removed";
  created_at:string;updated_at:string;interested_count:number;my_interest:number;is_mine:number;
};
function communityPostView(p:CommunityPostRow){
  return {id:p.post_id,type:p.post_type,title:p.title,category:p.category,description:p.description,
    pickupLocation:p.pickup_location,ownerName:p.owner_name,ownerBranch:p.owner_branch,status:p.status,
    createdAt:p.created_at,updatedAt:p.updated_at,interestedCount:Number(p.interested_count||0),
    interested:Boolean(p.my_interest),isMine:Boolean(p.is_mine),sample:!p.owner_id};
}
async function seedPreviewCommunityPosts(e:GEnv):Promise<void>{
  if(!previewTestMode(e)||!e.GYANSHALA_DB) return;
  const db=e.GYANSHALA_DB;
  const count=await db.prepare("SELECT COUNT(*) AS total FROM gyanshala_community_posts").first<{total:number}>();
  if(Number(count?.total||0)>0) return;
  const now=new Date().toISOString();
  const posts=[
    ["gy-post-offer-notes","offer","First-year engineering notes","Books","Sharing a tidy set of first-year notes. Happy to help someone revise before the next assessment.","Central Library"],
    ["gy-post-offer-labcoat","offer","Extra lab coat to share","Lab Equipment","Clean lab coat available for a student who needs one for an upcoming practical. Please confirm size first.","Chemistry Block"],
    ["gy-post-need-drawingkit","need","Looking for a drawing kit","Stationery","I need a basic engineering drawing kit for a studio session this week. A loan is absolutely fine.","Main Library"],
    ["gy-post-offer-circuit","offer","Circuit basics study circle","Electronics","A few of us are revising basic circuit concepts. Join for a friendly peer study session.","Student Centre"],
    ["gy-post-need-textbook","need","Need a data structures textbook","Books","Looking to borrow a data structures reference for a few days while preparing for labs.","Central Library"],
    ["gy-post-offer-stationery","offer","Spare stationery bundle","Stationery","A few spare notebooks, pens and geometry essentials for anyone who could use them.","Main Canteen"]
  ];
  for(const p of posts){
    await db.prepare("INSERT INTO gyanshala_community_posts(post_id,owner_id,post_type,title,category,description,pickup_location,owner_name,owner_branch,status,created_at,updated_at) VALUES(?,NULL,?,?,?,?,?,'Gyanshala Preview Community','Preview samples','active',?,?) ON CONFLICT(post_id) DO NOTHING")
      .bind(p[0],p[1],p[2],p[3],p[4],p[5],now,now).run();
  }
}
async function listCommunityPosts(r:Request,e:GEnv):Promise<Response>{
  const u=await getUser(r,e);
  if(!u) return reply({error:"authentication_required",message:"Sign in to join the campus community."},401);
  if(u.profile_complete!==1) return reply({error:"profile_incomplete"},403);
  if(!e.GYANSHALA_DB) return reply({error:"database_not_configured"},503);
  try{
    await seedPreviewCommunityPosts(e);
    const url=new URL(r.url);
    const typeValue=url.searchParams.get("type")||"All";
    const type=["All","offer","need","mine"].includes(typeValue)?typeValue:"All";
    const categoryValue=url.searchParams.get("category")||"All";
    const categories=["All","Books","Lab Equipment","Electronics","Stationery","Other"];
    const category=categories.includes(categoryValue)?categoryValue:"All";
    const q=(url.searchParams.get("q")||"").trim().slice(0,100);
    const like="%"+q+"%";
    const rows=await e.GYANSHALA_DB.prepare(
      "SELECT p.*,CASE WHEN mine.user_id IS NULL THEN 0 ELSE 1 END AS my_interest,CASE WHEN p.owner_id=? THEN 1 ELSE 0 END AS is_mine,(SELECT COUNT(*) FROM gyanshala_community_interests ci WHERE ci.post_id=p.post_id) AS interested_count FROM gyanshala_community_posts p LEFT JOIN gyanshala_community_interests mine ON mine.post_id=p.post_id AND mine.user_id=? WHERE p.status<>'removed' AND ((?='mine' AND p.owner_id=?) OR (?<>'mine' AND p.status='active' AND (?='All' OR p.post_type=?))) AND (?='All' OR p.category=?) AND (?='' OR p.title LIKE ? COLLATE NOCASE OR p.description LIKE ? COLLATE NOCASE OR p.pickup_location LIKE ? COLLATE NOCASE) ORDER BY CASE p.status WHEN 'active' THEN 0 ELSE 1 END,p.created_at DESC LIMIT 100"
    ).bind(u.user_id,u.user_id,type,u.user_id,type,type,type,category,category,q,like,like,like).all<CommunityPostRow>();
    const posts=(rows.results||[]).map(communityPostView);
    return reply({ok:true,posts,total:posts.length,type,category});
  }catch{
    return reply({error:"community_unavailable",message:"Community posts are temporarily unavailable. Try again."},503);
  }
}
async function createCommunityPost(r:Request,e:GEnv):Promise<Response>{
  const u=await getUser(r,e);
  if(!u) return reply({error:"authentication_required",message:"Sign in to post an offer or need."},401);
  if(u.profile_complete!==1) return reply({error:"profile_incomplete"},403);
  if(!e.GYANSHALA_DB) return reply({error:"database_not_configured"},503);
  const b=await body(r);
  if(!b) return reply({error:"invalid_json"},400);
  const type=typeof b.type==="string"?b.type.trim():"";
  const title=typeof b.title==="string"?b.title.trim().replace(/\s+/g," "):"";
  const category=typeof b.category==="string"?b.category.trim():"";
  const description=typeof b.description==="string"?b.description.trim():"";
  const pickupLocation=typeof b.pickupLocation==="string"?b.pickupLocation.trim().replace(/\s+/g," "):"";
  if(!["offer","need"].includes(type)||title.length<3||title.length>100||
    !["Books","Lab Equipment","Electronics","Stationery","Other"].includes(category)||
    description.length<8||description.length>1000||pickupLocation.length>120){
    return reply({error:"invalid_community_post",message:"Add a title, category, and description between 8 and 1,000 characters."},400);
  }
  const id="gyp_"+token(18),now=new Date().toISOString();
  try{
    await e.GYANSHALA_DB.prepare("INSERT INTO gyanshala_community_posts(post_id,owner_id,post_type,title,category,description,pickup_location,owner_name,owner_branch,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'active',?,?)")
      .bind(id,u.user_id,type,title,category,description,pickupLocation,u.full_name||"Student",u.branch||"",now,now).run();
    return reply({ok:true,postId:id,message:type==="offer"?"Your offer is now on the community board.":"Your need is now on the community board."},201);
  }catch{
    return reply({error:"community_post_failed",message:"We couldn’t publish this post. Please try again."},503);
  }
}
async function expressCommunityInterest(r:Request,e:GEnv,postId:string):Promise<Response>{
  const u=await getUser(r,e);
  if(!u) return reply({error:"authentication_required"},401);
  if(u.profile_complete!==1) return reply({error:"profile_incomplete"},403);
  if(!e.GYANSHALA_DB) return reply({error:"database_not_configured"},503);
  const db=e.GYANSHALA_DB;
  try{
    const post=await db.prepare("SELECT post_id,owner_id,status FROM gyanshala_community_posts WHERE post_id=? LIMIT 1").bind(postId).first<{post_id:string;owner_id:string|null;status:string}>();
    if(!post||post.status!=="active") return reply({error:"community_post_not_found",message:"This post is no longer active."},404);
    if(post.owner_id===u.user_id) return reply({error:"own_post",message:"This is your post."},409);
    const prior=await db.prepare("SELECT post_id FROM gyanshala_community_interests WHERE post_id=? AND user_id=? LIMIT 1").bind(postId,u.user_id).first<{post_id:string}>();
    if(!prior) await db.prepare("INSERT INTO gyanshala_community_interests(post_id,user_id,created_at) VALUES(?,?,?) ON CONFLICT(post_id,user_id) DO NOTHING").bind(postId,u.user_id,new Date().toISOString()).run();
    const count=await db.prepare("SELECT COUNT(*) AS total FROM gyanshala_community_interests WHERE post_id=?").bind(postId).first<{total:number}>();
    return reply({ok:true,interested:true,alreadyInterested:Boolean(prior),interestedCount:Number(count?.total||0)});
  }catch{
    return reply({error:"community_interest_failed",message:"We couldn’t save your interest. Please try again."},503);
  }
}
async function closeCommunityPost(r:Request,e:GEnv,postId:string):Promise<Response>{
  const u=await getUser(r,e);
  if(!u) return reply({error:"authentication_required"},401);
  if(u.profile_complete!==1) return reply({error:"profile_incomplete"},403);
  if(!e.GYANSHALA_DB) return reply({error:"database_not_configured"},503);
  try{
    const post=await e.GYANSHALA_DB.prepare("SELECT post_id,owner_id,status FROM gyanshala_community_posts WHERE post_id=? LIMIT 1").bind(postId).first<{post_id:string;owner_id:string|null;status:string}>();
    if(!post||post.owner_id!==u.user_id) return reply({error:"post_not_found",message:"Only the student who created this post can update it."},404);
    if(post.status!=="active") return reply({ok:true,status:post.status});
    await e.GYANSHALA_DB.prepare("UPDATE gyanshala_community_posts SET status='fulfilled',updated_at=? WHERE post_id=? AND owner_id=?").bind(new Date().toISOString(),postId,u.user_id).run();
    return reply({ok:true,status:"fulfilled",message:"Your post has been marked as fulfilled."});
  }catch{
    return reply({error:"community_post_update_failed",message:"We couldn’t update this post. Try again."},503);
  }
}

async function api(r: Request, e: GEnv): Promise<Response> {
  const p = new URL(r.url).pathname;
  if (r.method === "GET" && (p === API + "/health" || p === API + "/auth/config")) return health(e);
  if (p === API + "/me" && r.method === "GET") return me(r, e);
  if (p === API + "/resources" && r.method === "GET") return listResources(r, e);
  if (p === API + "/pickup-locations" && r.method === "GET") return listPickupLocations(r,e);
  if (p === API + "/community/posts" && r.method === "GET") return listCommunityPosts(r,e);
  if (p === API + "/community/posts" && r.method === "POST") {
    if (!sameOrigin(r)) return reply({error:"origin_rejected"},403);
    return createCommunityPost(r,e);
  }
  const communityPrefix=API + "/community/posts/";
  if (p.startsWith(communityPrefix)) {
    const tail=p.slice(communityPrefix.length);
    const interestSuffix="/interest", closeSuffix="/close";
    if(r.method==="POST" && tail.endsWith(interestSuffix)){
      if(!sameOrigin(r)) return reply({error:"origin_rejected"},403);
      const id=tail.slice(0,-interestSuffix.length);
      if(id&&!id.includes("/")&&/^[A-Za-z0-9_-]{1,100}$/.test(id)) return expressCommunityInterest(r,e,id);
    }
    if(r.method==="POST" && tail.endsWith(closeSuffix)){
      if(!sameOrigin(r)) return reply({error:"origin_rejected"},403);
      const id=tail.slice(0,-closeSuffix.length);
      if(id&&!id.includes("/")&&/^[A-Za-z0-9_-]{1,100}$/.test(id)) return closeCommunityPost(r,e,id);
    }
    return reply({error:"not_found"},404);
  }
  if (p === API + "/resources" && r.method === "POST") {
    if (!sameOrigin(r)) return reply({ error: "origin_rejected" }, 403);
    return createResource(r, e);
  }
  if (p === API + "/my-requests" && r.method === "GET") return listMyRequests(r, e);
  if(p===API+"/supply-finder"&&r.method==="POST"){
    if(!sameOrigin(r))return reply({error:"origin_rejected"},403);
    return findSmartSupplies(r,e);
  }
  if(p===API+"/supplies/reservations"&&r.method==="POST"){
    if(!sameOrigin(r))return reply({error:"origin_rejected"},403);
    const b=await body(r);const supplyId=normalizeSupplyText(b?.supplyId,100);
    if(!supplyId||! /^[A-Za-z0-9_-]{1,100}$/.test(supplyId))return reply({error:"invalid_supply_id"},400);
    return reserveSmartSupply(r,e,supplyId);
  }
  const reservationPrefix=API+"/supplies/reservations/";
  if(p.startsWith(reservationPrefix)&&r.method==="POST"&&p.endsWith("/cancel")){
    if(!sameOrigin(r))return reply({error:"origin_rejected"},403);
    const id=p.slice(reservationPrefix.length,-7).replace(/\/$/,"");
    if(!id||! /^[A-Za-z0-9_-]{1,100}$/.test(id))return reply({error:"reservation_not_found"},404);
    return cancelSmartSupplyReservation(r,e,id);
  }
  const requestsPrefix=API+"/requests/";
  if(p.startsWith(requestsPrefix)){
    const parts=p.slice(requestsPrefix.length).split("/");
    const requestId=parts[0]||"";
    if(requestId&&!/^[A-Za-z0-9_-]{1,100}$/.test(requestId))return reply({error:"request_not_found"},404);
    if(parts.length===2&&parts[1]==="tracking"&&r.method==="GET")return getRequestTracking(r,e,requestId);
    if(parts.length===2&&parts[1]==="status"&&r.method==="POST"){
      if(!sameOrigin(r))return reply({error:"origin_rejected"},403);
      return updateRequestStatus(r,e,requestId);
    }
    if(parts.length===2&&parts[1]==="location"&&r.method==="POST"){
      if(!sameOrigin(r))return reply({error:"origin_rejected"},403);
      return updateLiveLocation(r,e,requestId);
    }
    return reply({error:"not_found"},404);
  }
  if (p === API + "/messages" && r.method === "GET") return listMessageThreads(r, e);
  const messagePrefix = API + "/messages/";
  if (p.startsWith(messagePrefix)) {
    const requestId=p.slice(messagePrefix.length);
    if (requestId && !requestId.includes("/") && /^[A-Za-z0-9_-]{1,100}$/.test(requestId)) {
      if (r.method === "GET") return getMessageThread(r,e,requestId);
      if (r.method === "POST") {
        if (!sameOrigin(r)) return reply({error:"origin_rejected"},403);
        return sendThreadMessage(r,e,requestId);
      }
    }
    return reply({error:"not_found"},404);
  }
  const resourcesPrefix = API + "/resources/";
  if (p.startsWith(resourcesPrefix)) {
    const tail = p.slice(resourcesPrefix.length);
    if (r.method === "POST" && tail.endsWith("/request")) {
      if (!sameOrigin(r)) return reply({ error: "origin_rejected" }, 403);
      const resourceId = tail.slice(0, -8);
      if (resourceId && !resourceId.includes("/") && /^[A-Za-z0-9_-]{1,80}$/.test(resourceId)) return requestResource(r, e, resourceId);
      return reply({ error: "resource_not_found" }, 404);
    }
    if (r.method === "GET" && !tail.includes("/") && /^[A-Za-z0-9_-]{1,80}$/.test(tail)) return getResource(r, e, tail);
  }
  if (r.method !== "POST") return reply({ error: "method_not_allowed" }, 405, { Allow: "GET, POST" });
  if (!sameOrigin(r)) return reply({ error: "origin_rejected" }, 403);
  if (p === API + "/auth/start") return start(r, e);
  if (p === API + "/auth/verify-email") return verifyEmail(r, e);
  if (p === API + "/auth/resend-email") return resendEmail(r, e);
  if (p === API + "/profile") return saveProfile(r, e);
  if (p === API + "/auth/logout") return logout(r, e);
  return reply({ error: "not_found" }, 404);
}

export async function handleGyanshalaRequest(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === APP) return Response.redirect(url.origin + APP + "/", 308);
  if (url.pathname === API || url.pathname.startsWith(API + "/")) return api(request, envOf(env));
  if (!url.pathname.startsWith(APP + "/")) return null;
  if (request.method !== "GET" && request.method !== "HEAD") return reply({ error: "method_not_allowed" }, 405, { Allow: "GET, HEAD" });
  const result = await env.ASSETS.fetch(request);
  const h = new Headers(result.headers);
  h.set("Cache-Control", "no-store");
  h.set("X-Content-Type-Options", "nosniff");
  h.set("X-Frame-Options", "DENY");
  h.set("Referrer-Policy", "no-referrer");
  h.set("Cross-Origin-Resource-Policy", "same-origin");
  const isGyanshalaShell = url.pathname === APP + "/";
  // Only the Gyanshala shell permits the map library/style/tiles. All unrelated
  // AskMoina and Veda routes retain their existing restrictive CSP.
  h.set("Content-Security-Policy", isGyanshalaShell
    ? "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; frame-src https://www.openstreetmap.org https://www.google.com https://maps.google.com; form-action 'self'; connect-src 'self' wss: https://unpkg.com https://tiles.openfreemap.org https://maps.googleapis.com; script-src 'self' 'wasm-unsafe-eval' https://unpkg.com https://maps.googleapis.com https://maps.gstatic.com; style-src 'self' 'unsafe-inline' https://unpkg.com https://maps.googleapis.com; img-src 'self' data: blob: https://tiles.openfreemap.org https://maps.googleapis.com https://maps.gstatic.com; font-src 'self' data: https://tiles.openfreemap.org https://fonts.gstatic.com; manifest-src 'self'; worker-src 'self' blob:; child-src blob:;"
    : "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; manifest-src 'self'; worker-src 'self';");
  if (isGyanshalaShell) h.set("Permissions-Policy", "geolocation=(self), camera=(), microphone=()");
  if (url.pathname.endsWith("/manifest.webmanifest")) h.set("Content-Type", "application/manifest+json; charset=utf-8");
  if (url.pathname.endsWith("/icon.svg")) h.set("Content-Type", "image/svg+xml; charset=utf-8");
  if (url.pathname.endsWith("/sw.js")) { h.set("Content-Type", "text/javascript; charset=utf-8"); h.set("Service-Worker-Allowed", APP + "/"); }
  return new Response(request.method === "HEAD" ? null : result.body, { status: result.status, statusText: result.statusText, headers: h });
}
