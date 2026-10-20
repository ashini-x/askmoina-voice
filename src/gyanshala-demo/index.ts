import type { Env } from "../config/env";

type GEnv = Env & {
  GYANSHALA_DB?: D1Database;
  GYANSHALA_RESEND_API_KEY?: string;
  GYANSHALA_EMAIL_FROM?: string;
  GYANSHALA_ALLOWED_EMAIL_DOMAINS?: string;
  GYANSHALA_OTP_SECRET?: string;
  GYANSHALA_PREVIEW_TEST_MODE?: string;
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
    const url = new URL(r.url);
    const q = (url.searchParams.get("q") || "").trim().slice(0, 120);
    const categoryValue = url.searchParams.get("category") || "All";
    const categories = ["All","Books","Lab Equipment","Electronics","Stationery"];
    const category = categories.includes(categoryValue) ? categoryValue : "All";
    const like = "%" + q + "%";
    const rows = await e.GYANSHALA_DB.prepare(
      "SELECT r.*,rq.status AS request_status FROM gyanshala_resources r LEFT JOIN gyanshala_resource_requests rq ON rq.resource_id=r.resource_id AND rq.requester_id=? WHERE r.status='available' AND (?='' OR r.title LIKE ? COLLATE NOCASE OR r.category LIKE ? COLLATE NOCASE OR r.description LIKE ? COLLATE NOCASE) AND (?='All' OR r.category=?) ORDER BY r.created_at DESC,r.title ASC LIMIT 80"
    ).bind(u.user_id, q, like, like, like, category, category).all<ResourceRow>();
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
    await e.GYANSHALA_DB.prepare(
      "INSERT INTO gyanshala_resources(resource_id,owner_id,title,category,description,item_condition,lending_type,price_amount,pickup_location,distance_label,owner_name,owner_branch,icon,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'available',?,?)"
    ).bind(id,u.user_id,title,category,description,itemCondition,lendingType,priceAmount,pickupLocation,distanceLabel,u.full_name || "Student",u.branch || "",icon,now,now).run();
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
      "SELECT q.request_id,q.status,q.message,q.created_at,q.updated_at,r.resource_id,r.title,r.category,r.description,r.item_condition,r.lending_type,r.price_amount,r.pickup_location,r.distance_label,r.owner_name,r.owner_branch,r.icon,CASE WHEN q.owner_id IS NOT NULL THEN 1 ELSE 0 END AS messages_available FROM gyanshala_resource_requests q JOIN gyanshala_resources r ON r.resource_id=q.resource_id WHERE q.requester_id=? ORDER BY q.created_at DESC LIMIT 100"
    ).bind(u.user_id).all<RequestListRow>();
    const requests = (rows.results || []).map(x => ({
      requestId:x.request_id, status:x.status, message:x.message, createdAt:x.created_at, updatedAt:x.updated_at,
      resource:{id:x.resource_id,title:x.title,category:x.category,description:x.description,condition:x.item_condition,
        lendingType:x.lending_type,priceAmount:x.price_amount,pickupLocation:x.pickup_location,distanceLabel:x.distance_label,
        ownerName:x.owner_name,ownerBranch:x.owner_branch,icon:x.icon},
      messagesAvailable:x.messages_available === 1
    }));
    return reply({ ok:true, requests, total:requests.length });
  } catch {
    return reply({ error:"requests_unavailable", message:"Your requests are temporarily unavailable. Try again." },503);
  }
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



async function api(r: Request, e: GEnv): Promise<Response> {
  const p = new URL(r.url).pathname;
  if (r.method === "GET" && (p === API + "/health" || p === API + "/auth/config")) return health(e);
  if (p === API + "/me" && r.method === "GET") return me(r, e);
  if (p === API + "/resources" && r.method === "GET") return listResources(r, e);
  if (p === API + "/resources" && r.method === "POST") {
    if (!sameOrigin(r)) return reply({ error: "origin_rejected" }, 403);
    return createResource(r, e);
  }
  if (p === API + "/my-requests" && r.method === "GET") return listMyRequests(r, e);
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
  h.set("Content-Security-Policy", "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; manifest-src 'self'; worker-src 'self';");
  if (url.pathname.endsWith("/manifest.webmanifest")) h.set("Content-Type", "application/manifest+json; charset=utf-8");
  if (url.pathname.endsWith("/icon.svg")) h.set("Content-Type", "image/svg+xml; charset=utf-8");
  if (url.pathname.endsWith("/sw.js")) { h.set("Content-Type", "text/javascript; charset=utf-8"); h.set("Service-Worker-Allowed", APP + "/"); }
  return new Response(request.method === "HEAD" ? null : result.body, { status: result.status, statusText: result.statusText, headers: h });
}
