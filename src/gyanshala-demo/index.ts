import type { Env } from "../config/env";

type GEnv = Env & {
  GYANSHALA_DB?: D1Database;
  GYANSHALA_RESEND_API_KEY?: string;
  GYANSHALA_EMAIL_FROM?: string;
  GYANSHALA_ALLOWED_EMAIL_DOMAINS?: string;
  GYANSHALA_OTP_SECRET?: string;
  TWILIO_API_KEY_SID?: string;
  TWILIO_API_KEY_SECRET?: string;
  TWILIO_VERIFY_SERVICE_SID?: string;
};
type Challenge = {
  challenge_id: string; mode: "signup" | "signin"; user_id: string | null;
  email: string; phone: string; email_code_hash: string; email_expires_at: string;
  email_verified_at: string | null; phone_verified_at: string | null;
  email_sent_at: string; phone_sent_at: string | null; attempts: number; created_at: string;
};
type User = {
  user_id: string; email: string; phone: string; full_name: string | null;
  branch: string | null; year_of_study: string | null; residence: string | null;
  profile_complete: number; status: string; created_at: string;
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
function secret(e: GEnv): string | null { return e.GYANSHALA_OTP_SECRET?.trim() || null; }
function allowedDomains(e: GEnv): string[] {
  return (e.GYANSHALA_ALLOWED_EMAIL_DOMAINS || "").split(",").map(x => x.trim().toLowerCase().replace(/^@/, ""))
    .filter(x => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(x));
}
function validEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (s.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_\x60{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(s)) return null;
  const p = s.split("@");
  if (p[0].length > 64 || p[1].startsWith(".") || p[1].endsWith(".") || p[1].includes("..")) return null;
  return s;
}
function e164(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/[\s().-]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
}
function resendReady(e: GEnv): boolean { return Boolean(e.GYANSHALA_RESEND_API_KEY?.trim() && e.GYANSHALA_EMAIL_FROM?.trim()); }
function twilioReady(e: GEnv): boolean { return Boolean(e.TWILIO_API_KEY_SID?.trim() && e.TWILIO_API_KEY_SECRET?.trim() && e.TWILIO_VERIFY_SERVICE_SID?.trim()); }
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
    emailProvider: resendReady(e),
    phoneProvider: twilioReady(e),
    collegeDomainAllowlist: allowedDomains(e).length > 0,
    otpSecret: Boolean(secret(e))
  };
}
async function health(e: GEnv): Promise<Response> {
  const schema = await hasSchema(e);
  const s = setup(e, schema);
  const missing: string[] = [];
  if (!s.databaseBinding || !s.databaseSchema) missing.push("GYANSHALA_DB binding and schema");
  if (!s.emailProvider) missing.push("GYANSHALA_RESEND_API_KEY and GYANSHALA_EMAIL_FROM");
  if (!s.phoneProvider) missing.push("TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, TWILIO_VERIFY_SERVICE_SID");
  if (!s.collegeDomainAllowlist) missing.push("GYANSHALA_ALLOWED_EMAIL_DOMAINS");
  if (!s.otpSecret) missing.push("GYANSHALA_OTP_SECRET");
  return reply({ ok: true, app: "gyanshala", signupReady: missing.length === 0, setup: s, requiredSettings: missing });
}
async function sendEmail(e: GEnv, to: string, code: string): Promise<boolean> {
  if (!resendReady(e)) return false;
  const text = "Your Gyanshala verification code is " + code + ". It expires in 10 minutes. If you did not request this, ignore this message.";
  const html = '<div style="font-family:Arial,sans-serif;color:#111;line-height:1.6"><h2>Verify your college email</h2><p>Enter this code in Gyanshala to continue.</p><p style="font-size:32px;font-weight:700;letter-spacing:8px">' + code + '</p><p>This code expires in 10 minutes.</p></div>';
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + e.GYANSHALA_RESEND_API_KEY, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ from: e.GYANSHALA_EMAIL_FROM, to: [to], subject: "Your Gyanshala verification code", text, html })
  }).catch(() => null);
  return Boolean(res?.ok);
}
async function twilio(e: GEnv, endpoint: "Verifications" | "VerificationCheck", fields: Record<string,string>): Promise<{ok:boolean;status:string}> {
  if (!twilioReady(e)) return { ok: false, status: "" };
  const res = await fetch("https://verify.twilio.com/v2/Services/" + encodeURIComponent(e.TWILIO_VERIFY_SERVICE_SID || "") + "/" + endpoint, {
    method: "POST",
    headers: { Authorization: "Basic " + btoa((e.TWILIO_API_KEY_SID || "") + ":" + (e.TWILIO_API_KEY_SECRET || "")), "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(fields)
  }).catch(() => null);
  if (!res) return { ok: false, status: "" };
  const d = await res.json().catch(() => ({})) as { status?: unknown };
  return { ok: res.ok, status: typeof d.status === "string" ? d.status : "" };
}
async function getChallenge(e: GEnv, id: unknown): Promise<Challenge | null> {
  if (!e.GYANSHALA_DB || typeof id !== "string" || !/^[A-Za-z0-9_-]{30,50}$/.test(id)) return null;
  return e.GYANSHALA_DB.prepare("SELECT * FROM gyanshala_signup_challenges WHERE challenge_id=? AND email_expires_at>? LIMIT 1")
    .bind(id, new Date().toISOString()).first<Challenge>();
}
async function cooldown(e: GEnv, email: string, phone: string): Promise<boolean> {
  if (!e.GYANSHALA_DB || !secret(e)) return true;
  const since = new Date(Date.now() - COOLDOWN_MS).toISOString();
  const emailHash = await mac(secret(e) || "", "rate:email:" + email);
  const phoneHash = await mac(secret(e) || "", "rate:phone:" + phone);
  const x = await e.GYANSHALA_DB.prepare("SELECT contact_hash FROM gyanshala_rate_limits WHERE contact_hash IN (?,?) AND last_sent_at>? LIMIT 1")
    .bind(emailHash, phoneHash, since).first<{contact_hash:string}>();
  return Boolean(x);
}
async function markSent(e: GEnv, kind: "email" | "phone", contact: string): Promise<void> {
  if (!e.GYANSHALA_DB || !secret(e)) return;
  const contactHash = await mac(secret(e) || "", "rate:" + kind + ":" + contact);
  await e.GYANSHALA_DB.prepare("INSERT INTO gyanshala_rate_limits(contact_hash,last_sent_at) VALUES(?,?) ON CONFLICT(contact_hash) DO UPDATE SET last_sent_at=excluded.last_sent_at")
    .bind(contactHash, new Date().toISOString()).run();
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
  return e.GYANSHALA_DB.prepare("SELECT u.user_id,u.email,u.phone,u.full_name,u.branch,u.year_of_study,u.residence,u.profile_complete,u.status,u.created_at FROM gyanshala_sessions s JOIN gyanshala_users u ON u.user_id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.status='active' LIMIT 1")
    .bind(await mac(secret(e) || "", "session:" + raw), new Date().toISOString()).first<User>();
}
function userView(u: User) {
  return { id: u.user_id, email: u.email, phoneMasked: "••••••" + u.phone.slice(-4), fullName: u.full_name || "",
    branch: u.branch || "", yearOfStudy: u.year_of_study || "", residence: u.residence || "", profileComplete: u.profile_complete === 1 };
}
async function finish(e: GEnv, c: Challenge): Promise<Response> {
  if (!e.GYANSHALA_DB) return reply({ error: "database_not_configured" }, 503);
  let id = c.user_id || "";
  const now = new Date().toISOString();
  if (c.mode === "signup") {
    id = "gyu_" + crypto.randomUUID().replace(/-/g, "");
    try {
      await e.GYANSHALA_DB.prepare("INSERT INTO gyanshala_users(user_id,email,phone,email_verified_at,phone_verified_at,profile_complete,status,created_at,updated_at) VALUES(?,?,?,?,?,0,'active',?,?)")
        .bind(id, c.email, c.phone, c.email_verified_at || now, c.phone_verified_at || now, now, now).run();
    } catch {
      return reply({ error: "details_already_registered", message: "These details are already linked to an account. Try signing in." }, 409);
    }
  }
  const u = await e.GYANSHALA_DB.prepare("SELECT user_id,email,phone,full_name,branch,year_of_study,residence,profile_complete,status,created_at FROM gyanshala_users WHERE user_id=? AND status='active' LIMIT 1")
    .bind(id).first<User>();
  if (!u) return reply({ error: "account_unavailable" }, 403);
  await e.GYANSHALA_DB.prepare("DELETE FROM gyanshala_signup_challenges WHERE challenge_id=?").bind(c.challenge_id).run();
  return reply({ ok: true, user: userView(u), next: u.profile_complete === 1 ? "complete" : "profile" }, 200, { "Set-Cookie": await makeCookie(e, id) });
}
async function start(r: Request, e: GEnv): Promise<Response> {
  const b = await body(r);
  if (!b) return reply({ error: "invalid_json" }, 400);
  const email = validEmail(b.email), phone = e164(b.phone), mode = b.mode === "signin" ? "signin" : "signup";
  if (!email || !phone) return reply({ error: "invalid_details", message: "Enter your college email and phone number with country code, e.g. +91…" }, 400);
  const allow = allowedDomains(e);
  if (!allow.length) return reply({ error: "college_domains_not_configured", message: "The approved college email domains are not configured." }, 503);
  if (!allow.includes(email.split("@")[1])) return reply({ error: "college_email_not_allowed", message: "Use an email address from your college's approved domain." }, 403);
  if (!e.GYANSHALA_DB || !secret(e) || !resendReady(e) || !twilioReady(e) || !(await hasSchema(e))) {
    return reply({ error: "signup_setup_incomplete", message: "Student verification is not enabled yet. An administrator must finish the setup checklist.", setup: setup(e, await hasSchema(e)) }, 503);
  }
  const db = e.GYANSHALA_DB;
  const byEmail = await db.prepare("SELECT user_id FROM gyanshala_users WHERE email=? LIMIT 1").bind(email).first<{user_id:string}>();
  const byPhone = await db.prepare("SELECT user_id FROM gyanshala_users WHERE phone=? LIMIT 1").bind(phone).first<{user_id:string}>();
  let userId: string | null = null;
  if (mode === "signup" && (byEmail || byPhone)) return reply({ error: "details_already_registered", message: "These details are already registered. Use Sign in instead." }, 409);
  if (mode === "signin") {
    const found = await db.prepare("SELECT user_id FROM gyanshala_users WHERE email=? AND phone=? AND status='active' LIMIT 1")
      .bind(email, phone).first<{user_id:string}>();
    if (!found) return reply({ error: "account_not_found", message: "No active account matched both details. Check them or create a new account." }, 401);
    userId = found.user_id;
  }
  if (await cooldown(e, email, phone)) return reply({ error: "please_wait", message: "A verification attempt was started recently. Wait 30 seconds before trying again." }, 429, { "Retry-After": "30" });
  const id = token(24), code = code6(), now = new Date(), expires = new Date(now.getTime() + CODE_SECONDS * 1000);
  const codeHash = await mac(secret(e) || "", id + ":" + code);
  await db.prepare("INSERT INTO gyanshala_signup_challenges(challenge_id,mode,user_id,email,phone,email_code_hash,email_expires_at,email_verified_at,phone_verified_at,email_sent_at,phone_sent_at,attempts,created_at) VALUES(?,?,?,?,?,?,?,NULL,NULL,?,NULL,0,?)")
    .bind(id, mode, userId, email, phone, codeHash, expires.toISOString(), now.toISOString(), now.toISOString()).run();
  const sentEmail = await sendEmail(e, email, code);
  if (!sentEmail) {
    await db.prepare("DELETE FROM gyanshala_signup_challenges WHERE challenge_id=?").bind(id).run();
    return reply({ error: "email_delivery_failed", message: "Email delivery failed. Check the Resend key and verified sender domain." }, 502);
  }
  await markSent(e, "email", email);
  const smsAttemptAt = new Date().toISOString();
  const sms = await twilio(e, "Verifications", { To: phone, Channel: "sms" });
  // Record an attempt even on provider failure to prevent rapid SMS abuse/retry loops.
  await db.prepare("UPDATE gyanshala_signup_challenges SET phone_sent_at=? WHERE challenge_id=?").bind(smsAttemptAt, id).run();
  await markSent(e, "phone", phone);
  return reply({ ok: true, challengeId: id, emailSent: true, smsSent: sms.ok, expiresInSeconds: CODE_SECONDS,
    message: sms.ok ? "Verification codes sent." : "Email sent; SMS could not start. You can retry SMS on the next screen." }, 202);
}
async function verifyEmail(r: Request, e: GEnv): Promise<Response> {
  const b = await body(r);
  if (!b || typeof b.code !== "string") return reply({ error: "invalid_json" }, 400);
  const c = await getChallenge(e, b.challengeId);
  if (!c) return reply({ error: "verification_expired", message: "Start again to receive fresh verification codes." }, 400);
  if (c.attempts >= MAX_ATTEMPTS) return reply({ error: "too_many_attempts", message: "Too many attempts. Start again." }, 429);
  const ok = /^[0-9]{6}$/.test(b.code) && await mac(secret(e) || "", c.challenge_id + ":" + b.code) === c.email_code_hash;
  if (!ok) {
    await e.GYANSHALA_DB?.prepare("UPDATE gyanshala_signup_challenges SET attempts=attempts+1 WHERE challenge_id=?").bind(c.challenge_id).run();
    return reply({ error: "invalid_email_code", message: "That code did not match. Check your email and try again." }, 401);
  }
  await e.GYANSHALA_DB?.prepare("UPDATE gyanshala_signup_challenges SET email_verified_at=?,attempts=0 WHERE challenge_id=?").bind(new Date().toISOString(), c.challenge_id).run();
  const updated = await getChallenge(e, c.challenge_id);
  return updated?.phone_verified_at ? finish(e, updated) : reply({ ok: true, emailVerified: true, next: "phone" });
}
async function resendEmail(r: Request, e: GEnv): Promise<Response> {
  const b = await body(r);
  if (!b) return reply({ error: "invalid_json" }, 400);
  const c = await getChallenge(e, b.challengeId);
  if (!c) return reply({ error: "verification_expired" }, 400);
  if (c.email_verified_at) return reply({ ok: true, emailVerified: true });
  const last = Date.parse(c.email_sent_at);
  if (Number.isFinite(last) && Date.now() - last < COOLDOWN_MS) return reply({ error: "resend_cooldown", message: "Wait 30 seconds before requesting another code." }, 429);
  const code = code6(), now = new Date(), expires = new Date(now.getTime() + CODE_SECONDS * 1000);
  const hash = await mac(secret(e) || "", c.challenge_id + ":" + code);
  if (!(await sendEmail(e, c.email, code))) return reply({ error: "email_delivery_failed" }, 502);
  await e.GYANSHALA_DB?.prepare("UPDATE gyanshala_signup_challenges SET email_code_hash=?,email_expires_at=?,email_sent_at=?,attempts=0 WHERE challenge_id=?")
    .bind(hash, expires.toISOString(), now.toISOString(), c.challenge_id).run();
  await markSent(e, "email", c.email);
  return reply({ ok: true });
}
async function startPhone(r: Request, e: GEnv): Promise<Response> {
  const b = await body(r);
  if (!b) return reply({ error: "invalid_json" }, 400);
  const c = await getChallenge(e, b.challengeId);
  if (!c) return reply({ error: "verification_expired" }, 400);
  if (c.phone_verified_at) return reply({ ok: true, phoneVerified: true });
  const last = c.phone_sent_at ? Date.parse(c.phone_sent_at) : NaN;
  if (Number.isFinite(last) && Date.now() - last < COOLDOWN_MS) return reply({ error: "resend_cooldown", message: "Wait 30 seconds before requesting another SMS." }, 429);
  const attemptedAt = new Date().toISOString();
  const sent = await twilio(e, "Verifications", { To: c.phone, Channel: "sms" });
  await e.GYANSHALA_DB?.prepare("UPDATE gyanshala_signup_challenges SET phone_sent_at=? WHERE challenge_id=?")
    .bind(attemptedAt, c.challenge_id).run();
  await markSent(e, "phone", c.phone);
  if (!sent.ok) return reply({ error: "sms_delivery_failed", message: "SMS could not start. Wait 30 seconds before retrying, then check Twilio Verify settings and phone-number support." }, 502);
  return reply({ ok: true });
}
async function verifyPhone(r: Request, e: GEnv): Promise<Response> {
  const b = await body(r);
  if (!b || typeof b.code !== "string") return reply({ error: "invalid_json" }, 400);
  const c = await getChallenge(e, b.challengeId);
  if (!c) return reply({ error: "verification_expired", message: "Start again to receive fresh codes." }, 400);
  if (c.attempts >= MAX_ATTEMPTS) return reply({ error: "too_many_attempts", message: "Too many attempts. Start again." }, 429);
  if (!/^[0-9]{4,10}$/.test(b.code.trim())) return reply({ error: "invalid_phone_code" }, 400);
  const checked = await twilio(e, "VerificationCheck", { To: c.phone, Code: b.code.trim() });
  if (!checked.ok || checked.status !== "approved") {
    await e.GYANSHALA_DB?.prepare("UPDATE gyanshala_signup_challenges SET attempts=attempts+1 WHERE challenge_id=?").bind(c.challenge_id).run();
    return reply({ error: "invalid_phone_code", message: "That SMS code could not be verified." }, 401);
  }
  await e.GYANSHALA_DB?.prepare("UPDATE gyanshala_signup_challenges SET phone_verified_at=? WHERE challenge_id=?").bind(new Date().toISOString(), c.challenge_id).run();
  const updated = await getChallenge(e, c.challenge_id);
  return updated?.email_verified_at ? finish(e, updated) : reply({ ok: true, phoneVerified: true, next: "email" });
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
async function logout(r: Request, e: GEnv): Promise<Response> {
  const raw = readCookie(r, COOKIE);
  if (raw && e.GYANSHALA_DB && secret(e)) {
    await e.GYANSHALA_DB.prepare("DELETE FROM gyanshala_sessions WHERE token_hash=?").bind(await mac(secret(e) || "", "session:" + raw)).run().catch(() => undefined);
  }
  return reply({ ok: true }, 200, { "Set-Cookie": COOKIE + "=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax" });
}
async function api(r: Request, e: GEnv): Promise<Response> {
  const p = new URL(r.url).pathname;
  if (r.method === "GET" && (p === API + "/health" || p === API + "/auth/config")) return health(e);
  if (p === API + "/me" && r.method === "GET") return me(r, e);
  if (r.method !== "POST") return reply({ error: "method_not_allowed" }, 405, { Allow: "GET, POST" });
  if (!sameOrigin(r)) return reply({ error: "origin_rejected" }, 403);
  if (p === API + "/auth/start") return start(r, e);
  if (p === API + "/auth/verify-email") return verifyEmail(r, e);
  if (p === API + "/auth/resend-email") return resendEmail(r, e);
  if (p === API + "/auth/start-phone") return startPhone(r, e);
  if (p === API + "/auth/verify-phone") return verifyPhone(r, e);
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
