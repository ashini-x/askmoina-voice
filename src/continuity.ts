import type { Env } from "./config/env";

const VAULT_ITERATIONS = 600_000;
const MAX_BACKUP_BYTES = 750_000;
const VISITOR_COOKIE = "moina_visitor";
const ADMIN_COOKIE = "moina_admin_session";
const ADMIN_SESSION_SECONDS = 12 * 60 * 60;

type VisitorContext = { visitorId: string; cookie?: string; touch: Promise<void> };
type BackupRow = {
  vault_id: string; token_hash: string; version: number; kdf: string; iterations: number;
  salt: string; iv: string; ciphertext: string; revision: number; created_at: string; updated_at: string;
};

const json = (data: unknown, status = 200, extraHeaders?: HeadersInit): Response => {
  const headers = new Headers(extraHeaders);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return Response.json(data, { status, headers });
};

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomBase64Url(bytes = 32): string {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = "";
  for (const value of values) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie") || "";
  for (const piece of header.split(";")) {
    const separator = piece.indexOf("=");
    if (separator < 0) continue;
    if (piece.slice(0, separator).trim() === name) return piece.slice(separator + 1).trim();
  }
  return null;
}

function visitorCookieHeader(token: string): string {
  return VISITOR_COOKIE + "=" + token + "; Max-Age=31536000; Path=/; Secure; HttpOnly; SameSite=Strict";
}

export async function visitorIdFromRequest(request: Request): Promise<string | null> {
  const token = readCookie(request, VISITOR_COOKIE);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return sha256Hex(token);
}

async function touchVisitor(env: Env, visitorId: string): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO visitor_profiles (visitor_id, first_seen_at, last_seen_at) VALUES (?, ?, ?) " +
    "ON CONFLICT(visitor_id) DO UPDATE SET last_seen_at = excluded.last_seen_at",
  ).bind(visitorId, now, now).run();
}

export async function ensureVisitor(request: Request, env: Env): Promise<VisitorContext> {
  const existing = readCookie(request, VISITOR_COOKIE);
  const valid = Boolean(existing && /^[A-Za-z0-9_-]{43}$/.test(existing));
  const token = valid ? existing! : randomBase64Url(32);
  const visitorId = await sha256Hex(token);
  const touch = touchVisitor(env, visitorId).catch(() => undefined);
  return { visitorId, cookie: valid ? undefined : visitorCookieHeader(token), touch };
}

export async function recordSessionStart(
  env: Env, request: Request, sessionId: string, model: string, location: string, startedAt: number,
): Promise<string | null> {
  const visitorId = await visitorIdFromRequest(request);
  const stamp = new Date(startedAt).toISOString();
  if (visitorId) await touchVisitor(env, visitorId).catch(() => undefined);
  await env.DB.prepare(
    "INSERT INTO voice_sessions (session_id, visitor_id, started_at, ended_at, duration_seconds, outcome, model, location, setup_completed) " +
    "VALUES (?, ?, ?, NULL, NULL, 'connecting', ?, ?, 0)",
  ).bind(sessionId, visitorId, stamp, model.slice(0, 100), location.slice(0, 100)).run();
  await env.DB.prepare(
    "INSERT INTO usage_events (id, user_id, event_type, duration_seconds, estimated_cost_usd, created_at) VALUES (?, ?, ?, NULL, NULL, ?)",
  ).bind(crypto.randomUUID(), visitorId, "voice_session_started", stamp).run();
  return visitorId;
}

export async function recordSessionFinish(
  env: Env, sessionId: string, visitorId: string | null, startedAt: number, outcome: string, setupCompleted: boolean,
): Promise<void> {
  const endedAt = new Date().toISOString();
  const duration = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const safeOutcome = /^[a-z_]{1,40}$/.test(outcome) ? outcome : "unknown";
  await env.DB.prepare(
    "UPDATE voice_sessions SET ended_at = ?, duration_seconds = ?, outcome = ?, setup_completed = ? WHERE session_id = ? AND ended_at IS NULL",
  ).bind(endedAt, duration, safeOutcome, setupCompleted ? 1 : 0, sessionId).run();
  await env.DB.prepare(
    "INSERT INTO usage_events (id, user_id, event_type, duration_seconds, estimated_cost_usd, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
  ).bind(crypto.randomUUID(), visitorId, "voice_session_" + safeOutcome, duration, endedAt).run();
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin || origin !== new URL(request.url).origin) return false;
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
}

function htmlResponse(html: string, status = 200, cookie?: string): Response {
  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; connect-src 'self'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:",
    "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "microphone=(self), camera=(), geolocation=(), payment=()", "Cross-Origin-Resource-Policy": "same-origin",
  });
  if (cookie) headers.set("Set-Cookie", cookie);
  return new Response(html, { status, headers });
}

function scriptResponse(script: string): Response {
  return new Response(script, { headers: {
    "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin",
  }});
}

function vaultPage(): string {
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0c1222"><title>Memory Vault · AskMoina</title>',
    '<style>*{box-sizing:border-box}body{margin:0;background:#0c1222;color:#eef3ff;font:16px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:#9edbe3}.wrap{max-width:900px;margin:0 auto;padding:24px 18px 64px}.top{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}.brand{font-weight:750;font-size:1.25rem}.pill{color:#a7f3d0;border:1px solid #246754;border-radius:99px;padding:5px 10px;font-size:.8rem}h1{font-size:clamp(2rem,7vw,3.2rem);line-height:1.04;letter-spacing:-.04em;margin:34px 0 12px}p{color:#bcc8df}.lead{max-width:690px}.panel{background:#111c31;border:1px solid #293753;border-radius:18px;padding:20px;margin:16px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px}.field{display:flex;flex-direction:column;gap:7px;margin:12px 0}label{font-weight:620;font-size:.9rem}input,textarea{width:100%;background:#091221;border:1px solid #384967;color:#eef3ff;border-radius:10px;padding:12px;font:inherit}textarea{min-height:84px;resize:vertical}button,.button{border:1px solid #426a7a;background:#153d4b;color:#effcff;border-radius:10px;padding:11px 14px;font:inherit;font-weight:650;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:8px}button.secondary,.button.secondary{background:#17243a;border-color:#384967}button.danger{background:#47212a;border-color:#743843}button:disabled{opacity:.5;cursor:not-allowed}.actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:12px}.muted{font-size:.88rem;color:#94a6c3}.alert{padding:12px 14px;border-radius:10px;background:#162a3c;border:1px solid #30516a;margin:12px 0}.alert.error{background:#3b1f2a;border-color:#7b3547}.hidden{display:none!important}.key{word-break:break-all;background:#07101e;padding:12px;border-radius:10px;border:1px dashed #b4c8e6;font:600 1rem ui-monospace,monospace}.memory{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:13px 0;border-bottom:1px solid #2a3750}.memory:last-child{border-bottom:0}.memory p{white-space:pre-wrap;margin:0;color:#e5ecfb;overflow-wrap:anywhere}.memory small{color:#8fa2c0}.footer{margin-top:30px;color:#8fa2c0;font-size:.82rem}input[type=checkbox]{width:auto;accent-color:#7dc9d4}a:focus,button:focus,input:focus,textarea:focus{outline:2px solid #a0e5ec;outline-offset:2px}</style></head><body><main class="wrap">',
    '<header class="top"><div class="brand">◉ AskMoina / Memory Vault</div><a href="/">Return to voice</a><span class="pill">Encrypted by your device</span></header>',
    '<h1>Your memories.<br>Your keys.</h1><p class="lead">Save only the things you want Moina to remember. Your vault is encrypted in this browser before it is stored. AskMoina cannot decrypt an encrypted cloud backup without your recovery code.</p>',
    '<div class="alert"><strong>Important:</strong> Voice conversations still send microphone audio to Google Cloud Vertex AI. If you choose “Use in AskMoina”, the selected memory text is also sent to Gemini for that conversation. This vault is not end-to-end encryption of the live AI session.</div>',
    '<section class="panel" id="setupPanel"><h2>Open your vault</h2><p class="muted">A recovery code is generated on your device. Keep it somewhere private. Without the code, encrypted memories cannot be recovered.</p><div class="grid"><div class="field"><label for="vaultId">Vault ID (for restore)</label><input id="vaultId" autocomplete="off" spellcheck="false" placeholder="Generated when creating a vault"></div><div class="field"><label for="recoveryCode">Recovery code</label><input id="recoveryCode" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Paste your 43-character recovery code"></div></div><div class="field"><label><input type="checkbox" id="rememberDevice"> Remember unlock on this browser</label><p class="muted">Stores a non-exportable browser key locally for convenience. Anyone controlling this browser profile may be able to use the vault while this is enabled. This key is never synced.</p></div>',
    '<div class="actions"><button id="createVault">Create new vault</button><button class="secondary" id="unlockVault">Unlock this device / restore cloud backup</button></div><div class="field"><label for="importFile">Restore from an encrypted backup file</label><input id="importFile" type="file" accept="application/json,.json"><button class="secondary" id="importBackup">Import encrypted backup file</button></div>',
    '<div id="recoveryPanel" class="alert hidden"><strong>Save this recovery code now</strong><p class="muted">Anyone with this code and your vault ID can decrypt your memory backup. We cannot reset it for you.</p><div id="recoveryDisplay" class="key"></div><div class="actions"><button id="copyCode" class="secondary">Copy code</button><button id="downloadKit" class="secondary">Download recovery kit</button><button id="confirmSaved">I have saved it</button></div></div><div id="message" class="alert hidden" role="status" aria-live="polite"></div></section>',
    '<section id="vaultPanel" class="panel hidden"><div class="top"><div><h2>Your Memory Vault</h2><div class="muted" id="vaultStatus">Unlocked · local encrypted copy</div></div><button id="lockVault" class="secondary">Lock vault</button></div>',
    '<div class="field"><label for="memoryText">Add something for Moina to remember</label><textarea id="memoryText" maxlength="4000" placeholder="Example: I prefer Assamese and simple, friendly explanations."></textarea></div><div class="actions"><button id="saveMemory">Save memory</button><button id="exportBackup" class="secondary">Download encrypted backup</button><button id="uploadBackup" class="secondary">Enable / update encrypted cloud backup</button><button id="deleteLocal" class="secondary">Delete local copy</button><button id="deleteCloud" class="danger">Delete cloud backup</button></div>',
    '<div class="field"><label><input type="checkbox" id="useInVoice"> Use these memories in AskMoina across this browser</label><p class="muted">When enabled, selected note text is stored in this browser (not on our server) so it can reach AskMoina from another tab too. It is sent to Gemini at the start of each new voice conversation while enabled. Uncheck this or lock the vault to clear the selected context. This opt-in cache is plaintext in browser storage.</p></div><h3>Saved memories</h3><div id="memoryList"><p class="muted">No memories saved yet.</p></div><p class="muted">This release saves facts you enter here. It does not automatically extract memories from speech.</p></section>',
    '<p class="footer">Local-first storage · AES-GCM encryption · Optional encrypted backup · This vault does not save transcripts or microphone recordings.</p></main><script src="/vault.js" defer></script></body></html>',
  ].join("");
}

const VAULT_JS = String.raw`(() => {
"use strict";
const $ = (s) => document.querySelector(s);
const encoder = new TextEncoder();
const DB_NAME = "askmoina-memory-vault";
const STORE = "vaults";
const ITERATIONS = 600000;
const TAB_CONTEXT = "askmoina.memory.context";
const TAB_CONTEXT_VAULT_ID = "askmoina.memory.context.vaultId";
let vault = null, recoveryCode = "", key = null, currentState = null;

function message(text, error) { const n=$("#message"); n.textContent=text; n.classList.remove("hidden","error"); if(error)n.classList.add("error"); }
function b64u(bytes) { let b=""; for(const v of bytes)b+=String.fromCharCode(v); return btoa(b).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,""); }
function unb64u(s) { const raw=atob(s.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-s.length%4)%4)); return Uint8Array.from(raw,c=>c.charCodeAt(0)); }
function randCode() { return b64u(crypto.getRandomValues(new Uint8Array(32))); }
function openDb() { return new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE,{keyPath:"vaultId"});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error||new Error("Local encrypted storage is unavailable."));}); }
async function dbOp(mode,operation) { const db=await openDb(); try{return await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,mode),store=tx.objectStore(STORE);let req;try{req=operation(store);}catch(e){reject(e);return;}if(req){req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);}else{tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error);}});}finally{db.close();} }
const getLocal=id=>dbOp("readonly",s=>s.get(id)), putLocal=r=>dbOp("readwrite",s=>s.put(r)), delLocal=id=>dbOp("readwrite",s=>s.delete(id));
async function deriveKey(code,salt) { const material=await crypto.subtle.importKey("raw",encoder.encode(code),"PBKDF2",false,["deriveKey"]);return crypto.subtle.deriveKey({name:"PBKDF2",hash:"SHA-256",salt,iterations:ITERATIONS},material,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]); }
const aad=id=>encoder.encode("askmoina-memory-vault-v1:"+id);
async function encryptState(state) { const iv=crypto.getRandomValues(new Uint8Array(12));const data=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:aad(vault.vaultId)},key,encoder.encode(JSON.stringify(state)));vault.iv=b64u(iv);vault.ciphertext=b64u(new Uint8Array(data));vault.version=1;vault.kdf="PBKDF2-SHA-256";vault.iterations=ITERATIONS;vault.revision=(vault.revision||0)+1;await putLocal(vault);currentState=state; }
async function decryptStateWithKey(record,derived) { if(!record||record.version!==1||record.kdf!=="PBKDF2-SHA-256"||record.iterations!==ITERATIONS)throw new Error("Unsupported vault version.");const salt=unb64u(record.salt);if(salt.length!==16)throw new Error("Invalid vault salt.");const clear=await crypto.subtle.decrypt({name:"AES-GCM",iv:unb64u(record.iv),additionalData:aad(record.vaultId)},derived,unb64u(record.ciphertext));const state=JSON.parse(new TextDecoder().decode(clear));if(!state||state.schemaVersion!==1||!Array.isArray(state.memories)||state.memories.length>50)throw new Error("Vault contents are not valid.");return {derived,state};}
async function decryptState(record,code) { const derived=await deriveKey(code,unb64u(record.salt));return decryptStateWithKey(record,derived);}
async function apiBackup(method,code,id,body) { const headers={"Authorization":"Bearer "+code};if(body)headers["Content-Type"]="application/json";const r=await fetch("/api/vault/"+encodeURIComponent(id),{method,headers,body:body?JSON.stringify(body):undefined,cache:"no-store"});const d=await r.json().catch(()=>({}));if(!r.ok){if(r.status===409)throw new Error("A newer cloud revision exists. Restore that backup before updating.");if(r.status===404)throw new Error("Cloud backup was not found or the recovery code is incorrect.");throw new Error(d.error||"Encrypted backup request failed.");}return d;}
function showUnlocked(){ $("#vaultPanel").classList.remove("hidden");$("#vaultStatus").textContent="Unlocked · local encrypted copy"+(vault.cloudEnabled?" · encrypted cloud backup enabled":"");$("#vaultId").value=vault.vaultId;$("#recoveryCode").value="";renderMemories();let owner=localStorage.getItem(TAB_CONTEXT_VAULT_ID);if(owner&&owner!==vault.vaultId){localStorage.removeItem(TAB_CONTEXT);sessionStorage.removeItem(TAB_CONTEXT);localStorage.removeItem(TAB_CONTEXT_VAULT_ID);}let selected=localStorage.getItem(TAB_CONTEXT)||sessionStorage.getItem(TAB_CONTEXT)||"";if(selected&&!localStorage.getItem(TAB_CONTEXT)){localStorage.setItem(TAB_CONTEXT,selected);localStorage.setItem(TAB_CONTEXT_VAULT_ID,vault.vaultId);}$("#useInVoice").checked=Boolean(selected);$("#rememberDevice").checked=Boolean(vault.deviceKey); }
function lockVault(){vault=null;key=null;recoveryCode="";currentState=null;sessionStorage.removeItem(TAB_CONTEXT);localStorage.removeItem(TAB_CONTEXT);localStorage.removeItem(TAB_CONTEXT_VAULT_ID);$("#vaultPanel").classList.add("hidden");$("#recoveryPanel").classList.add("hidden");$("#recoveryCode").value="";$("#useInVoice").checked=false;message("Vault locked. Selected voice context was cleared from this browser.");}
function renderMemories(){const list=$("#memoryList");list.replaceChildren();if(!currentState.memories.length){const p=document.createElement("p");p.className="muted";p.textContent="No memories saved yet.";list.append(p);return;}for(const m of currentState.memories){const row=document.createElement("div");row.className="memory";const left=document.createElement("div"),p=document.createElement("p"),small=document.createElement("small");p.textContent=m.text;small.textContent="Saved "+new Date(m.updatedAt||m.createdAt).toLocaleString();left.append(p,small);const btn=document.createElement("button");btn.className="danger";btn.textContent="Delete";btn.addEventListener("click",async()=>{currentState.memories=currentState.memories.filter(x=>x.id!==m.id);await saveLocalState();message("Memory deleted locally. Update your encrypted cloud backup to sync this deletion.");});row.append(left,btn);list.append(row);}}
async function saveLocalState(){await encryptState(currentState);if($("#useInVoice").checked){const context=currentState.memories.map(m=>m.text).join("\n").slice(0,3000);if(context){localStorage.setItem(TAB_CONTEXT,context);sessionStorage.setItem(TAB_CONTEXT,context);localStorage.setItem(TAB_CONTEXT_VAULT_ID,vault.vaultId);}else{localStorage.removeItem(TAB_CONTEXT);sessionStorage.removeItem(TAB_CONTEXT);localStorage.removeItem(TAB_CONTEXT_VAULT_ID);$("#useInVoice").checked=false;}}renderMemories();message(vault.cloudEnabled?"Saved locally. Update your cloud backup to sync this change.":"Saved to this device in encrypted form.");}
async function createVault(){if(vault&&!confirm("Create a different vault?"))return;localStorage.removeItem(TAB_CONTEXT);sessionStorage.removeItem(TAB_CONTEXT);localStorage.removeItem(TAB_CONTEXT_VAULT_ID);const id=crypto.randomUUID(),code=randCode(),salt=crypto.getRandomValues(new Uint8Array(16));key=await deriveKey(code,salt);vault={vaultId:id,version:1,kdf:"PBKDF2-SHA-256",iterations:ITERATIONS,salt:b64u(salt),iv:"",ciphertext:"",revision:0,cloudRevision:0,cloudEnabled:false};recoveryCode=code;currentState={schemaVersion:1,memories:[]};await encryptState(currentState);localStorage.setItem("askmoina.vault.lastId",id);$("#vaultId").value=id;$("#recoveryDisplay").textContent=code;$("#recoveryPanel").classList.remove("hidden");showUnlocked();$("#recoveryPanel").classList.remove("hidden");message("Vault created. Save the recovery code before closing or losing browser data.");}
async function unlockVault(){const id=($("#vaultId").value||localStorage.getItem("askmoina.vault.lastId")||"").trim(),code=$("#recoveryCode").value.trim();if(!/^[0-9a-f-]{36}$/i.test(id))throw new Error("Enter a valid vault ID or create a new vault.");let record=await getLocal(id);let opened;if(!record){if(!/^[A-Za-z0-9_-]{43}$/.test(code))throw new Error("Enter the recovery code to restore the cloud backup.");record=await apiBackup("GET",code,id,null);record={...record,cloudEnabled:true,cloudRevision:record.revision,revision:record.revision};await putLocal(record);localStorage.setItem("askmoina.vault.lastId",id);}if(/^[A-Za-z0-9_-]{43}$/.test(code)){opened=await decryptState(record,code);recoveryCode=code;}else if(record.deviceKey){opened=await decryptStateWithKey(record,record.deviceKey);recoveryCode="";}else throw new Error("Enter the recovery code, or enable browser unlock after a previous unlock.");vault={...record};key=opened.derived;currentState=opened.state;localStorage.setItem("askmoina.vault.lastId",id);$("#recoveryPanel").classList.add("hidden");showUnlocked();message("Vault unlocked on this device. Cloud backups remain encrypted.");}
async function backupCloud(){if(!vault||!key)throw new Error("Unlock the vault first.");const body={version:vault.version,kdf:vault.kdf,iterations:vault.iterations,salt:vault.salt,iv:vault.iv,ciphertext:vault.ciphertext,expectedRevision:vault.cloudRevision||0};const result=await apiBackup("PUT",recoveryCode,vault.vaultId,body);vault.cloudRevision=result.revision;vault.cloudEnabled=true;await putLocal(vault);showUnlocked();message("Encrypted cloud backup updated. The server received ciphertext only.");}
function download(filename,content,type){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement("a");a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function downloadKit(){if(!vault||!recoveryCode)throw new Error("Create or unlock a vault first.");download("askmoina-recovery-kit.txt","AskMoina encrypted memory recovery kit\n\nVault ID: "+vault.vaultId+"\nRecovery code: "+recoveryCode+"\n\nKeep this file private and offline. Anyone with both values can decrypt the cloud backup. AskMoina cannot reset this code.\n","text/plain");}
async function deleteCloud(){if(!vault||!recoveryCode)throw new Error("Unlock the vault with its recovery code first.");if(!confirm("Permanently delete the encrypted cloud backup? The local copy will remain."))return;await apiBackup("DELETE",recoveryCode,vault.vaultId,null);vault.cloudEnabled=false;vault.cloudRevision=0;await putLocal(vault);showUnlocked();message("Encrypted cloud backup deleted. The local copy remains.");}
async function deleteLocal(){if(!vault)throw new Error("Unlock the vault first.");if(!confirm("Delete the local encrypted copy from this browser? Without another backup, access may be lost."))return;await delLocal(vault.vaultId);localStorage.removeItem("askmoina.vault.lastId");lockVault();}
function voiceContext(enabled){if(!vault||!currentState)return;if(!enabled){sessionStorage.removeItem(TAB_CONTEXT);localStorage.removeItem(TAB_CONTEXT);localStorage.removeItem(TAB_CONTEXT_VAULT_ID);message("Selected memory context cleared from this browser; it will not be sent to Gemini.");return;}const text=currentState.memories.map(m=>m.text).join("\n").slice(0,3000);if(!text){$("#useInVoice").checked=false;message("Add at least one memory first.",true);return;}localStorage.setItem(TAB_CONTEXT,text);sessionStorage.setItem(TAB_CONTEXT,text);localStorage.setItem(TAB_CONTEXT_VAULT_ID,vault.vaultId);message("Selected memories are enabled across this browser. Their text is cached locally and will be sent to Gemini at the start of each voice conversation until you disable this setting or lock the vault.");}
async function importBackup(){const file=$("#importFile").files[0];if(!file)throw new Error("Choose an encrypted backup JSON file first.");if(file.size>750000)throw new Error("Backup file is too large.");const rec=JSON.parse(await file.text());const id=String(rec.vaultId||"");if(!/^[0-9a-f-]{36}$/i.test(id)||rec.version!==1)throw new Error("This does not look like an AskMoina encrypted backup.");const code=$("#recoveryCode").value.trim();const opened=await decryptState(rec,code);await putLocal({...rec,cloudEnabled:false,cloudRevision:0});localStorage.setItem("askmoina.vault.lastId",id);vault={...rec,cloudEnabled:false,cloudRevision:0};recoveryCode=code;key=opened.derived;currentState=opened.state;$("#vaultId").value=id;showUnlocked();message("Encrypted backup imported and unlocked on this device.");}
$("#createVault").addEventListener("click",()=>createVault().catch(e=>message(e.message||"Could not create vault.",true)));
$("#unlockVault").addEventListener("click",()=>unlockVault().catch(e=>message(e.message||"Could not unlock vault.",true)));
$("#copyCode").addEventListener("click",async()=>{try{await navigator.clipboard.writeText(recoveryCode);message("Recovery code copied. Store it privately.");}catch(_){message("Copy is unavailable; select and copy the code manually.",true);}});
$("#downloadKit").addEventListener("click",()=>{try{downloadKit();}catch(e){message(e.message,true);}});
$("#confirmSaved").addEventListener("click",()=>{$("#recoveryPanel").classList.add("hidden");message("Keep the recovery code safe. You can now save memories.");});
$("#lockVault").addEventListener("click",lockVault);
$("#saveMemory").addEventListener("click",async()=>{try{const text=$("#memoryText").value.trim();if(!text)throw new Error("Enter a memory first.");if(!currentState)throw new Error("Unlock the vault first.");if(currentState.memories.length>=50)throw new Error("This release supports up to 50 memory notes.");const now=new Date().toISOString();currentState.memories.push({id:crypto.randomUUID(),text,createdAt:now,updatedAt:now});$("#memoryText").value="";await saveLocalState();}catch(e){message(e.message||"Could not save memory.",true);}});
$("#exportBackup").addEventListener("click",()=>{try{if(!vault)throw new Error("Unlock the vault first.");download("askmoina-encrypted-vault.json",JSON.stringify({vaultId:vault.vaultId,version:vault.version,kdf:vault.kdf,iterations:vault.iterations,salt:vault.salt,iv:vault.iv,ciphertext:vault.ciphertext,revision:vault.revision},null,2),"application/json");message("Encrypted backup downloaded without the recovery code.");}catch(e){message(e.message,true);}});
$("#uploadBackup").addEventListener("click",()=>backupCloud().catch(e=>message(e.message||"Cloud backup failed.",true)));
$("#deleteLocal").addEventListener("click",()=>deleteLocal().catch(e=>message(e.message,true)));
$("#deleteCloud").addEventListener("click",()=>deleteCloud().catch(e=>message(e.message||"Could not delete cloud backup.",true)));
$("#useInVoice").addEventListener("change",e=>voiceContext(Boolean(e.target.checked)));
$("#rememberDevice").addEventListener("change",async e=>{if(!vault||!key){if(e.target.checked)message("Unlock the vault first, then enable browser unlock.",true);e.target.checked=false;return;}try{if(e.target.checked){vault.deviceKey=key;await putLocal(vault);message("Browser unlock enabled on this device only.");}else{delete vault.deviceKey;await putLocal(vault);message("Browser unlock disabled. Your recovery code is required next time.");}}catch(_){e.target.checked=false;message("This browser could not persist its encryption key.",true);}});
$("#importBackup").addEventListener("click",()=>importBackup().catch(e=>message(e.message||"Could not import backup.",true)));
const last=localStorage.getItem("askmoina.vault.lastId");if(last)$("#vaultId").value=last;
})();`;

const CONTINUITY_JS = `(() => {
"use strict";
const contextKey = "askmoina.memory.context";
const NativeWebSocket = window.WebSocket;
function AskMoinaWebSocket(url, protocols) {
  const socket = protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
  const send = socket.send.bind(socket);
  let firstFrameSeen = false;
  socket.send = function(data) {
    if (!firstFrameSeen && typeof data === "string") {
      try {
        const message = JSON.parse(data);
        if (message && message.setup && Object.keys(message).length === 1) {
          firstFrameSeen = true;
          let context = "";
          try { context = localStorage.getItem(contextKey) || sessionStorage.getItem(contextKey) || ""; } catch (_) {}
          if (context) {
            message.memory_context = context.slice(0, 3000);
            data = JSON.stringify(message);
          }
        }
      } catch (_) {}
    }
    return send(data);
  };
  return socket;
}
AskMoinaWebSocket.prototype = NativeWebSocket.prototype;
Object.setPrototypeOf(AskMoinaWebSocket, NativeWebSocket);
window.WebSocket = AskMoinaWebSocket;
})();`;

const ADMIN_LOGIN_HTML = [
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AskMoina Admin Login</title>',
  '<style>*{box-sizing:border-box}body{font:16px/1.5 system-ui;background:#0c1222;color:#eef3ff;margin:0;min-height:100vh;display:grid;place-items:center;padding:20px}.panel{width:min(440px,100%);background:#111c31;border:1px solid #293753;border-radius:18px;padding:26px}h1{margin-top:0}label{display:block;margin:16px 0 6px;font-size:.9rem}input{width:100%;padding:12px;border-radius:9px;border:1px solid #384967;background:#091221;color:#fff;font:inherit}button{margin-top:18px;width:100%;padding:12px;border-radius:9px;border:1px solid #426a7a;background:#153d4b;color:#fff;font:inherit;font-weight:700;cursor:pointer}.muted{color:#9eacc4;font-size:.9rem}.error{color:#fecaca}</style></head><body><main class="panel"><h1>AskMoina Admin</h1><p class="muted">Private operational analytics. Personal memories and conversation content are not exposed here.</p>',
  '<form id="login"><label for="username">Username</label><input id="username" autocomplete="username" required><label for="password">Password</label><input id="password" type="password" autocomplete="current-password" required><button type="submit">Sign in</button></form><p id="error" class="error" role="status" aria-live="polite"></p><p class="muted"><a href="/">Return to AskMoina</a></p><script src="/admin-login.js" defer></script></main></body></html>',
].join("");

const ADMIN_LOGIN_JS = `(() => {
const form=document.querySelector("#login"),error=document.querySelector("#error");
form.addEventListener("submit",async(event)=>{event.preventDefault();error.textContent="";
try{const response=await fetch("/admin/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:document.querySelector("#username").value,password:document.querySelector("#password").value}),cache:"no-store"});const result=await response.json().catch(()=>({}));
if(!response.ok)throw new Error(result.error||"Sign in failed.");location.href="/admin";
}catch(e){error.textContent=e.message||"Sign in failed.";}});
})();`;

function adminPage(): string {
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0c1222"><title>AskMoina Admin</title>',
    '<style>*{box-sizing:border-box}body{margin:0;background:#0c1222;color:#eef3ff;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}.wrap{max-width:1200px;margin:auto;padding:25px 18px 60px}.top{display:flex;justify-content:space-between;align-items:center;gap:15px;flex-wrap:wrap}h1{font-size:2rem;margin:16px 0 4px}h2{margin-top:0}.muted{color:#98a8c2}.btn{border:1px solid #3a4b68;background:#14243c;color:#fff;border-radius:9px;padding:9px 12px;font:inherit;cursor:pointer}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:22px 0}.card,.section{background:#111c31;border:1px solid #293753;border-radius:15px;padding:17px}.value{font-size:2rem;font-weight:750;letter-spacing:-.03em}.label{font-size:.85rem;color:#9aacc6}.layout{display:grid;grid-template-columns:1.4fr 1fr;gap:14px}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:.88rem}th,td{text-align:left;border-bottom:1px solid #293753;padding:10px 8px;white-space:nowrap}th{color:#a8bad4;font-weight:600}.alert{padding:12px;background:#162a3c;border-radius:10px;margin:12px 0;color:#bdd7e9}@media(max-width:800px){.layout{grid-template-columns:1fr}}button:focus{outline:2px solid #9edbe3;outline-offset:2px}</style></head><body><main class="wrap">',
    '<header class="top"><div><strong>◉ AskMoina / Operations</strong><div class="muted">Operational analytics only · no transcript or memory access</div></div><div><button class="btn" id="refresh">Refresh</button> <button class="btn" id="logout">Sign out</button></div></header>',
    '<h1>System overview</h1><p class="muted">Session and privacy-safe usage data. Costs are not inferred from duration; Google Cloud billing is the source for actual spend.</p><div class="cards" id="cards"><div class="card">Loading…</div></div>',
    '<div class="layout"><section class="section"><h2>Recent voice sessions</h2><div class="table-wrap"><table><thead><tr><th>Session</th><th>Visitor</th><th>Started</th><th>Duration</th><th>Outcome</th></tr></thead><tbody id="sessions"></tbody></table></div></section>',
    '<section class="section"><h2>Privacy & health</h2><div id="health" class="alert">Loading system status…</div><p class="muted">Microphone audio and transcript text are not written to the app analytics database. Encrypted vault backups contain ciphertext only. Admin access is audited.</p><p><a href="/vault">Open Memory Vault</a> · <a href="/">Open voice app</a></p></section></div>',
    '<p id="message" class="muted" role="status" aria-live="polite"></p><script src="/admin.js" defer></script></main></body></html>',
  ].join("");
}

const ADMIN_JS = `(() => {
const $=s=>document.querySelector(s);
function el(tag,text){const n=document.createElement(tag);n.textContent=text;return n;}
function card(label,value,detail){const c=el("div","");c.className="card";const l=el("div",label);l.className="label";const v=el("div",String(value??"—"));v.className="value";c.append(l,v);if(detail){const d=el("div",detail);d.className="label";c.append(d);}return c;}
async function load(){ $("#message").textContent="Refreshing…";try{
const pair=await Promise.all([fetch("/admin/api/overview",{cache:"no-store"}),fetch("/admin/api/sessions",{cache:"no-store"})]);
if(pair.some(r=>r.status===401)){location.href="/admin/login";return;}if(pair.some(r=>!r.ok))throw new Error("Admin data could not be loaded.");
const o=await pair[0].json(),s=await pair[1].json(),d=o.metrics||{},cards=$("#cards");cards.replaceChildren();
cards.append(card("Visitor profiles",d.visitorsTotal,"Pseudonymous browser profiles"),card("Visitors · last 24h",d.visitors24h,"Unique profiles seen"),card("Sessions · last 24h",d.sessions24h,"All outcomes"),card("Voice time · last 24h",Math.round((d.seconds24h||0)/60)+" min","Reported session duration"),card("Active sessions",d.activeSessions,"Approximate; refresh to update"),card("Failed sessions",d.failed24h,"Last 24 hours"),card("Encrypted backups",d.encryptedBackups,"Ciphertext records only"));
const tbody=$("#sessions");tbody.replaceChildren();for(const x of s.sessions||[]){const tr=document.createElement("tr");const values=[String(x.sessionId||"").slice(0,8),x.visitor||"unknown",x.startedAt?new Date(x.startedAt).toLocaleString():"—",x.durationSeconds==null?"—":Math.floor(x.durationSeconds/60)+"m "+x.durationSeconds%60+"s",x.outcome||"—"];for(const v of values)tr.append(el("td",v));tbody.append(tr);}
$("#health").textContent="Worker: "+(o.system?.worker||"AskMoina Voice")+" · Model: "+(o.system?.model||"configured")+" · Location: "+(o.system?.location||"configured")+" · Analytics retention: "+(o.system?.retentionDays||30)+" days · Cost source: Google Cloud billing";
$("#message").textContent="Updated "+new Date().toLocaleTimeString();}catch(e){$("#message").textContent=e.message||"Could not load metrics.";}}
$("#refresh").addEventListener("click",load);$("#logout").addEventListener("click",async()=>{await fetch("/admin/logout",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});location.href="/admin/login";});load();
})();`;

async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
  let binary = "";
  for (const byte of signature) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function safeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left), b = new TextEncoder().encode(right);
  let mismatch = a.length ^ b.length;
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) mismatch |= (a[i % Math.max(1, a.length)] || 0) ^ (b[i % Math.max(1, b.length)] || 0);
  return mismatch === 0;
}

async function adminSessionCookie(env: Env): Promise<string> {
  const expiry = Math.floor(Date.now() / 1000) + ADMIN_SESSION_SECONDS;
  const signature = await hmac("askmoina-admin-v1:" + expiry, env.ADMIN_SESSION_SECRET || "");
  return ADMIN_COOKIE + "=" + expiry + "." + signature + "; Max-Age=" + ADMIN_SESSION_SECONDS + "; Path=/admin; Secure; HttpOnly; SameSite=Strict";
}

async function isAdmin(request: Request, env: Env): Promise<boolean> {
  if (!env.ADMIN_SESSION_SECRET) return false;
  const value = readCookie(request, ADMIN_COOKIE);
  if (!value) return false;
  const pieces = value.split(".");
  if (pieces.length !== 2 || !/^\d{10}$/.test(pieces[0])) return false;
  const expiry = Number(pieces[0]), now = Math.floor(Date.now() / 1000);
  if (expiry <= now || expiry > now + ADMIN_SESSION_SECONDS + 60) return false;
  const expected = await hmac("askmoina-admin-v1:" + expiry, env.ADMIN_SESSION_SECRET);
  return safeEqual(expected, pieces[1]);
}

async function checkLoginThrottle(env: Env, request: Request): Promise<{ locked: boolean; hash: string }> {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const hash = await sha256Hex("askmoina-admin-login:" + ip);
  const row = await env.DB.prepare("SELECT window_start, attempts, locked_until FROM admin_login_attempts WHERE client_hash = ?")
    .bind(hash).first<{ window_start: number; attempts: number; locked_until: number }>();
  return { locked: Boolean(row && row.locked_until > Date.now()), hash };
}

async function failedLogin(env: Env, clientHash: string): Promise<void> {
  const now = Date.now();
  const row = await env.DB.prepare("SELECT window_start, attempts FROM admin_login_attempts WHERE client_hash = ?")
    .bind(clientHash).first<{ window_start: number; attempts: number }>();
  let windowStart = row?.window_start ?? now, attempts = row?.attempts ?? 0;
  if (now - windowStart > 5 * 60_000 || now < windowStart) { windowStart = now; attempts = 0; }
  attempts += 1;
  const lockedUntil = attempts >= 5 ? now + 10 * 60_000 : 0;
  await env.DB.prepare(
    "INSERT INTO admin_login_attempts (client_hash, window_start, attempts, locked_until, updated_at) VALUES (?, ?, ?, ?, ?) " +
    "ON CONFLICT(client_hash) DO UPDATE SET window_start=excluded.window_start, attempts=excluded.attempts, locked_until=excluded.locked_until, updated_at=excluded.updated_at",
  ).bind(clientHash, windowStart, attempts, lockedUntil, new Date(now).toISOString()).run();
}

async function resetLogin(env: Env, hash: string): Promise<void> {
  await env.DB.prepare("DELETE FROM admin_login_attempts WHERE client_hash = ?").bind(hash).run();
}

async function audit(env: Env, event: string): Promise<void> {
  await env.DB.prepare("INSERT INTO admin_audit_log (event_type, created_at) VALUES (?, ?)").bind(event.slice(0, 80), new Date().toISOString()).run();
}

async function handleVaultApi(request: Request, env: Env, url: URL): Promise<Response> {
  const match = url.pathname.match(/^\/api\/vault\/([0-9a-f-]{36})$/i);
  if (!match) return json({ error: "not_found" }, 404);
  const vaultId = match[1].toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(vaultId)) return json({ error: "invalid_vault_id" }, 400);
  if (!["GET", "PUT", "DELETE"].includes(request.method)) return json({ error: "method_not_allowed" }, 405, { Allow: "GET, PUT, DELETE" });
  if (request.method !== "GET" && !sameOrigin(request)) return json({ error: "forbidden_origin" }, 403);
  const auth = request.headers.get("Authorization") || "", code = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(code)) return json({ error: "recovery_code_required" }, 401);
  const tokenHash = await sha256Hex(code);
  if (request.method === "GET") {
    const row = await env.DB.prepare(
      "SELECT vault_id AS vaultId, version, kdf, iterations, salt, iv, ciphertext, revision, created_at AS createdAt, updated_at AS updatedAt FROM vault_backups WHERE vault_id = ? AND token_hash = ?",
    ).bind(vaultId, tokenHash).first();
    if (!row) return json({ error: "backup_not_found" }, 404);
    return json(row);
  }
  if (request.method === "DELETE") {
    const result = await env.DB.prepare("DELETE FROM vault_backups WHERE vault_id = ? AND token_hash = ?").bind(vaultId, tokenHash).run();
    if (!result.meta || result.meta.changes !== 1) return json({ error: "backup_not_found" }, 404);
    return json({ ok: true });
  }
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > MAX_BACKUP_BYTES) return json({ error: "backup_too_large" }, 413);
  let p: {version?:number;kdf?:string;iterations?:number;salt?:string;iv?:string;ciphertext?:string;expectedRevision?:number};
  try { p = await request.json() as typeof p; } catch { return json({ error: "invalid_json" }, 400); }
  if (JSON.stringify(p).length > MAX_BACKUP_BYTES) return json({ error: "backup_too_large" }, 413);
  if (p.version !== 1 || p.kdf !== "PBKDF2-SHA-256" || p.iterations !== VAULT_ITERATIONS ||
      typeof p.salt !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(p.salt) ||
      typeof p.iv !== "string" || !/^[A-Za-z0-9_-]{16}$/.test(p.iv) ||
      typeof p.ciphertext !== "string" || p.ciphertext.length < 24 || !/^[A-Za-z0-9_-]+$/.test(p.ciphertext) ||
      !Number.isInteger(p.expectedRevision) || (p.expectedRevision ?? -1) < 0) return json({ error: "invalid_encrypted_backup" }, 400);
  const existing = await env.DB.prepare("SELECT token_hash, revision FROM vault_backups WHERE vault_id = ?")
    .bind(vaultId).first<{token_hash:string;revision:number}>();
  const now = new Date().toISOString();
  if (!existing) {
    if (p.expectedRevision !== 0) return json({ error: "revision_conflict", currentRevision: 0 }, 409);
    try {
      await env.DB.prepare(
        "INSERT INTO vault_backups (vault_id, token_hash, version, kdf, iterations, salt, iv, ciphertext, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
      ).bind(vaultId, tokenHash, p.version, p.kdf, p.iterations, p.salt, p.iv, p.ciphertext, now, now).run();
      return json({ ok: true, revision: 1 });
    } catch { return json({ error: "revision_conflict", currentRevision: 1 }, 409); }
  }
  if (!safeEqual(existing.token_hash, tokenHash)) return json({ error: "backup_not_found" }, 404);
  if (existing.revision !== p.expectedRevision) return json({ error: "revision_conflict", currentRevision: existing.revision }, 409);
  const updated = await env.DB.prepare(
    "UPDATE vault_backups SET version=?, kdf=?, iterations=?, salt=?, iv=?, ciphertext=?, revision=revision+1, updated_at=? WHERE vault_id=? AND token_hash=? AND revision=?",
  ).bind(p.version,p.kdf,p.iterations,p.salt,p.iv,p.ciphertext,now,vaultId,tokenHash,p.expectedRevision).run();
  if (!updated.meta || updated.meta.changes !== 1) return json({ error: "revision_conflict" }, 409);
  return json({ ok: true, revision: existing.revision + 1 });
}

async function handleAdmin(request: Request, env: Env, url: URL): Promise<Response> {
  if (url.pathname === "/admin/login" && request.method === "GET") return htmlResponse(ADMIN_LOGIN_HTML);
  if (url.pathname === "/admin/login" && request.method === "POST") {
    if (!sameOrigin(request)) return json({ error: "forbidden_origin" }, 403);
    if (!env.ADMIN_DASHBOARD_PASSWORD || !env.ADMIN_SESSION_SECRET) return json({ error: "admin_credentials_not_configured" }, 503);
    const throttle = await checkLoginThrottle(env, request);
    if (throttle.locked) return json({ error: "too_many_attempts_try_later" }, 429, { "Retry-After": "600" });
    let input: {username?:unknown;password?:unknown};
    try { input = await request.json() as typeof input; } catch { return json({ error: "invalid_json" }, 400); }
    const username = typeof input.username === "string" ? input.username.slice(0,128) : "";
    const password = typeof input.password === "string" ? input.password.slice(0,512) : "";
    if (!safeEqual(username, env.ADMIN_DASHBOARD_USER || "admin") || !safeEqual(password, env.ADMIN_DASHBOARD_PASSWORD)) {
      await failedLogin(env, throttle.hash);
      return json({ error: "invalid_credentials" }, 401);
    }
    await resetLogin(env, throttle.hash);
    await audit(env, "admin_login");
    return json({ ok:true }, 200, { "Set-Cookie": await adminSessionCookie(env) });
  }
  if (url.pathname === "/admin/logout" && request.method === "POST") {
    if (!sameOrigin(request) || !await isAdmin(request,env)) return json({ error:"unauthorized" },401);
    await audit(env,"admin_logout").catch(()=>undefined);
    return json({ok:true},200,{"Set-Cookie":ADMIN_COOKIE+"=; Max-Age=0; Path=/admin; Secure; HttpOnly; SameSite=Strict"});
  }
  if (url.pathname === "/admin.js" && request.method === "GET") return scriptResponse(ADMIN_JS);
  if (url.pathname === "/admin-login.js" && request.method === "GET") return scriptResponse(ADMIN_LOGIN_JS);
  if (url.pathname === "/admin" && request.method === "GET") {
    if (!await isAdmin(request,env)) return Response.redirect(new URL("/admin/login",request.url).toString(),302);
    return htmlResponse(adminPage());
  }
  if (url.pathname.startsWith("/admin/api/")) {
    if (!await isAdmin(request,env)) return json({error:"unauthorized"},401);
    if (request.method !== "GET") return json({error:"method_not_allowed"},405);
    if (url.pathname === "/admin/api/overview") {
      const metrics = await env.DB.prepare(
        "SELECT (SELECT COUNT(*) FROM visitor_profiles) AS visitorsTotal, " +
        "(SELECT COUNT(*) FROM visitor_profiles WHERE last_seen_at >= datetime('now','-1 day')) AS visitors24h, " +
        "(SELECT COUNT(*) FROM voice_sessions WHERE started_at >= datetime('now','-1 day')) AS sessions24h, " +
        "(SELECT COALESCE(SUM(duration_seconds),0) FROM voice_sessions WHERE started_at >= datetime('now','-1 day')) AS seconds24h, " +
        "(SELECT COUNT(*) FROM voice_sessions WHERE ended_at IS NULL AND started_at >= datetime('now','-1 hour')) AS activeSessions, " +
        "(SELECT COUNT(*) FROM voice_sessions WHERE started_at >= datetime('now','-1 day') AND outcome NOT IN ('completed','connecting','client_disconnected')) AS failed24h, " +
        "(SELECT COUNT(*) FROM vault_backups) AS encryptedBackups",
      ).first<Record<string,number>>();
      return json({metrics:metrics||{},system:{worker:"AskMoina Voice",model:env.GEMINI_MODEL||"configured",location:env.GEMINI_LOCATION||"configured",retentionDays:30}});
    }
    if (url.pathname === "/admin/api/sessions") {
      const result = await env.DB.prepare(
        "SELECT session_id AS sessionId, substr(visitor_id,-8) AS visitor, started_at AS startedAt, duration_seconds AS durationSeconds, outcome, setup_completed AS setupCompleted FROM voice_sessions ORDER BY started_at DESC LIMIT 50",
      ).all();
      return json({sessions:result.results||[]});
    }
    return json({error:"not_found"},404);
  }
  if (url.pathname.startsWith("/admin")) return json({error:"not_found"},404);
  return json({error:"not_found"},404);
}

export async function handleContinuityRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === "/api/identity" && request.method === "GET") {
    const visitor = await ensureVisitor(request,env); ctx.waitUntil(visitor.touch);
    return json({ok:true,continuity:"anonymous-profile-cookie"},200,visitor.cookie?{"Set-Cookie":visitor.cookie}:undefined);
  }
  if (url.pathname === "/api/vault" || url.pathname.startsWith("/api/vault/")) return url.pathname==="/api/vault"?json({error:"not_found"},404):handleVaultApi(request,env,url);
  if (url.pathname === "/vault" || url.pathname === "/vault/") {
    if (request.method !== "GET") return json({error:"method_not_allowed"},405);
    const visitor=await ensureVisitor(request,env);ctx.waitUntil(visitor.touch);
    return htmlResponse(vaultPage(),200,visitor.cookie);
  }
  if (url.pathname === "/vault.js" && request.method === "GET") return scriptResponse(VAULT_JS);
  if (url.pathname === "/continuity.js" && request.method === "GET") return scriptResponse(CONTINUITY_JS);
  if (url.pathname === "/admin" || url.pathname.startsWith("/admin/") || url.pathname === "/admin.js" || url.pathname === "/admin-login.js") return handleAdmin(request,env,url);
  return null;
}
