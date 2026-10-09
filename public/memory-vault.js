(() => {
  "use strict";
  const DB = "askmoina-memory-vault";
  const ITERATIONS = 600000;
  const KDF = "PBKDF2-SHA-256";
  const AAD = new TextEncoder().encode("askmoina-memory-vault-v1");
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const $ = (id) => document.getElementById(id);
  const setup = $("memorySetup"), unlock = $("memoryUnlock"), workspace = $("memoryWorkspace");
  const message = $("memoryMessage"), list = $("memoryList"), syncStatus = $("memorySyncStatus");
  const passphrase = $("memoryPassphrase"), confirmPass = $("memoryPassphraseConfirm");
  const unlockPass = $("memoryUnlockPassphrase"), addForm = $("memoryAddForm");
  let key = null, envelope = null, state = null, sync = null;

  function say(text, kind="normal") { message.textContent = text; message.dataset.kind = kind; }
  function saySync(text, kind="normal") { syncStatus.textContent = text; syncStatus.dataset.kind = kind; }
  function show(which) { setup.hidden = which !== "setup"; unlock.hidden = which !== "unlock"; workspace.hidden = which !== "workspace"; }
  function random(n) { const b = new Uint8Array(n); crypto.getRandomValues(b); return b; }
  function b64(b) { let s=""; for (const x of b) s+=String.fromCharCode(x); return btoa(s).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_"); }
  function un64(s) { if(typeof s!=="string"||! /^[A-Za-z0-9_-]+$/.test(s)) throw new Error("Invalid encrypted data."); return Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-s.length%4)%4)), c=>c.charCodeAt(0)); }
  function openDb() {
    return new Promise((resolve,reject)=>{ const r=indexedDB.open(DB,1);
      r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains("records"))r.result.createObjectStore("records",{keyPath:"key"});};
      r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(new Error("Encrypted local storage is unavailable."));
    });
  }
  async function record(id, value, remove=false) {
    const db=await openDb();
    try { await new Promise((resolve,reject)=>{ const tx=db.transaction("records","readwrite"), store=tx.objectStore("records");
      if(remove)store.delete(id); else if(arguments.length>=2)store.put({key:id,value});
      else { const r=store.get(id); r.onsuccess=()=>resolve(r.result?.value ?? null); r.onerror=()=>reject(r.error); return; }
      tx.oncomplete=()=>resolve(true); tx.onerror=()=>reject(tx.error||new Error("Local vault storage failed."));
    }); } finally { db.close(); }
  }
  async function derive(secret,salt) {
    const material=await crypto.subtle.importKey("raw",enc.encode(secret),"PBKDF2",false,["deriveKey"]);
    return crypto.subtle.deriveKey({name:"PBKDF2",salt,iterations:ITERATIONS,hash:"SHA-256"},material,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
  }
  async function seal(data,cryptoKey,salt) {
    const iv=random(12), bytes=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:AAD},cryptoKey,enc.encode(JSON.stringify(data)));
    return {version:1,kdf:KDF,iterations:ITERATIONS,salt:b64(salt),iv:b64(iv),ciphertext:b64(new Uint8Array(bytes))};
  }
  function validate(data) {
    if(!data||data.version!==1||!Array.isArray(data.memories)||data.memories.length>1000)throw new Error("This is not a valid AskMoina memory vault.");
    for(const m of data.memories)if(!m||typeof m.id!=="string"||typeof m.title!=="string"||typeof m.text!=="string"||typeof m.updatedAt!=="string"||m.title.length>100||m.text.length>1200||typeof m.shareWithAI!=="boolean")throw new Error("A memory record is invalid.");
    return data;
  }
  async function openEnvelope(box,cryptoKey) {
    if(!box||box.version!==1||box.kdf!==KDF||box.iterations!==ITERATIONS)throw new Error("Unsupported recovery format.");
    const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:un64(box.iv),additionalData:AAD},cryptoKey,un64(box.ciphertext));
    return validate(JSON.parse(dec.decode(plain)));
  }
  function active() { return (state?.memories||[]).filter(m=>!m.deletedAt); }
  function merge(local,remote) {
    const result=new Map();
    for(const m of [...(remote.memories||[]),...(local.memories||[])]) {
      const old=result.get(m.id);
      if(!old||String(m.updatedAt)>String(old.updatedAt))result.set(m.id,m);
    }
    return {version:1,createdAt:local.createdAt||remote.createdAt,updatedAt:new Date().toISOString(),memories:Array.from(result.values()).slice(-1000)};
  }
  function render() {
    list.replaceChildren();
    const items=active().sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
    if(!items.length){const p=document.createElement("p");p.className="memory-empty";p.textContent="Your vault is empty. Save only what you want Moina to remember.";list.append(p);return;}
    for(const item of items){
      const row=document.createElement("article");row.className="memory-item";
      const head=document.createElement("div");head.className="memory-item-head";
      const title=document.createElement("strong");title.textContent=item.title;
      const actions=document.createElement("div");actions.className="memory-actions";
      const edit=document.createElement("button");edit.type="button";edit.className="memory-small-button";edit.textContent="Edit";
      edit.onclick=()=>{ $("memoryTitle").value=item.title;$("memoryText").value=item.text;$("memoryShare").checked=item.shareWithAI;addForm.dataset.editId=item.id;addForm.querySelector('[type="submit"]').textContent="Save changes";$("memoryTitle").focus();};
      const forget=document.createElement("button");forget.type="button";forget.className="memory-small-button";forget.textContent="Forget";
      forget.onclick=()=>void removeMemory(item.id);
      actions.append(edit,forget);head.append(title,actions);
      const text=document.createElement("p");text.className="memory-item-text";text.textContent=item.text;
      const meta=document.createElement("p");meta.className="memory-item-meta";meta.textContent=item.shareWithAI?"May be shared when you opt in for a voice session":"Stored privately; not shared with Gemini";
      row.append(head,text,meta);list.append(row);
    }
  }
  async function save(options={}) {
    if(!key||!state||!envelope)throw new Error("Unlock your vault first.");
    state.updatedAt=new Date().toISOString();
    envelope=await seal(state,key,un64(envelope.salt));
    await record("vault",envelope);render();
    if(options.sync!==false&&sync?.enabled){try{await push();saySync("Encrypted cloud backup is up to date.","success");}catch(e){saySync(e.message||"Saved locally; cloud backup needs attention.","warning");}}
    say("Saved in your encrypted local vault.","success");
  }
  function strong(pass) { return typeof pass==="string"&&pass.length>=12&&pass.length<=256; }
  async function create() {
    const secret=passphrase.value;
    if(!strong(secret)){say("Use a unique passphrase of at least 12 characters.","warning");return;}
    if(secret!==confirmPass.value){say("The passphrases do not match.","warning");return;}
    try{
      const salt=random(16), nextKey=await derive(secret,salt), now=new Date().toISOString();
      const nextState={version:1,createdAt:now,updatedAt:now,memories:[]};
      const box=await seal(nextState,nextKey,salt);await record("vault",box);await record("sync",null,true);
      key=nextKey;state=nextState;envelope=box;sync=null;passphrase.value="";confirmPass.value="";
      show("workspace");render();saySync("Device-only storage. Cloud backup is optional.");say("Private vault created. Keep your passphrase safe; AskMoina cannot recover it.","success");
    }catch(e){say(e.message||"Could not create vault.","error");}
  }
  async function unlockVault() {
    try{
      const box=await record("vault");if(!box){show("setup");say("No local vault found. Create one or import a recovery file.","warning");return;}
      const secret=unlockPass.value;if(!secret){say("Enter your passphrase.","warning");return;}
      const nextKey=await derive(secret,un64(box.salt)), nextState=await openEnvelope(box,nextKey);
      key=nextKey;state=nextState;envelope=box;sync=await record("sync");unlockPass.value="";
      show("workspace");render();saySync(sync?.enabled?"Encrypted cloud backup configured · revision "+sync.revision+".":"Device-only storage. Cloud backup is optional.");
      say("Vault unlocked. You choose which memories to share with Gemini.","success");
    }catch(_){say("Could not unlock the vault. Check your passphrase or import a recovery file.","error");}
  }
  async function requestJson(path,body) {
    const response=await fetch(path,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json",Accept:"application/json"},cache:"no-store",body:JSON.stringify(body)});
    const result=await response.json().catch(()=>({}));
    return {response,result};
  }
  async function push() {
    if(!sync?.enabled||!envelope)return;
    const {response,result}=await requestJson("/api/vault/backup",{vaultId:sync.vaultId,token:sync.token,expectedRevision:Number(sync.revision||0),...envelope});
    if(response.status===409)throw new Error("Cloud backup changed on another device. Use “Restore latest” to merge before syncing again.");
    if(!response.ok||result.ok!==true)throw new Error("Saved locally, but encrypted cloud backup failed. Try again.");
    sync.revision=Number(result.revision);await record("sync",sync);
  }
  async function cloudEnvelope() {
    if(!sync?.enabled)throw new Error("Cloud backup is not configured on this device.");
    const {response,result}=await requestJson("/api/vault/restore",{vaultId:sync.vaultId,token:sync.token});
    if(!response.ok||result.ok!==true)throw new Error("Could not restore cloud backup. Keep the recovery kit safe.");
    return {envelope:result.envelope,revision:Number(result.revision)};
  }
  async function enableSync() {
    if(!key||!envelope)return;
    if(sync?.enabled){try{await push();say("Encrypted cloud backup synchronised.","success");}catch(e){say(e.message,"warning");}return;}
    const fresh={enabled:true,vaultId:Array.from(random(16),b=>b.toString(16).padStart(2,"0")).join(""),token:b64(random(32)),revision:0};
    try{sync=fresh;await record("sync",sync);await push();saySync("Cloud backup enabled. Download a recovery kit and keep it private.","success");say("The backup contains ciphertext; the server never receives your passphrase.","success");}
    catch(e){sync=null;await record("sync",null,true);saySync("Could not enable encrypted cloud backup.","warning");say(e.message||"Cloud backup failed.","error");}
  }
  async function restoreSync() {
    try{
      const remote=await cloudEnvelope();
      const remoteState=await openEnvelope(remote.envelope,key);
      state=merge(state,remoteState);sync.revision=remote.revision;
      envelope=await seal(state,key,un64(remote.envelope.salt));
      await record("vault",envelope);await record("sync",sync);await push();render();
      say("Merged the latest encrypted cloud backup with this device.","success");
    }catch(e){say(e.message||"Could not restore cloud backup.","error");}
  }
  function downloadKit() {
    if(!envelope)return;
    const kit={format:"askmoina-memory-vault",formatVersion:1,exportedAt:new Date().toISOString(),
      vaultId:sync?.enabled?sync.vaultId:null,token:sync?.enabled?sync.token:null,revision:sync?.revision||0,envelope};
    const blob=new Blob([JSON.stringify(kit,null,2)],{type:"application/json"}),url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download="askmoina-memory-recovery.json";document.body.append(a);a.click();a.remove();URL.revokeObjectURL(url);
    say(sync?.enabled?"Recovery kit downloaded. Keep it private; the passphrase is separate.":"Encrypted vault backup downloaded. Keep it private and remember your passphrase.","success");
  }
  async function importKit(fileId,passId) {
    const file=$(fileId)?.files?.[0],secret=$(passId)?.value||"";
    if(!file){say("Choose an encrypted recovery file first.","warning");return;}
    if(!strong(secret)){say("Enter the vault passphrase (at least 12 characters).","warning");return;}
    if(file.size>300*1024){say("Recovery file is too large.","warning");return;}
    try{
      const kit=JSON.parse(await file.text()),box=kit.format==="askmoina-memory-vault"&&kit.formatVersion===1?kit.envelope:kit;
      const nextKey=await derive(secret,un64(box.salt)),nextState=await openEnvelope(box,nextKey);
      const hasSync=kit.vaultId&&kit.token&&/^[a-f0-9]{32}$/.test(kit.vaultId)&&/^[A-Za-z0-9_-]{40,64}$/.test(kit.token);
      const nextSync=hasSync?{enabled:true,vaultId:kit.vaultId,token:kit.token,revision:Number(kit.revision||0)}:null;
      await record("vault",box);if(nextSync)await record("sync",nextSync);else await record("sync",null,true);
      key=nextKey;state=nextState;envelope=box;sync=nextSync;$(passId).value="";$(fileId).value="";
      show("workspace");render();
      if(sync?.enabled){
        try{const remote=await cloudEnvelope();const remoteState=await openEnvelope(remote.envelope,key);
          state=merge(state,remoteState);sync.revision=remote.revision;envelope=await seal(state,key,un64(remote.envelope.salt));
          await record("vault",envelope);await record("sync",sync);await push();saySync("Restored and synchronised encrypted cloud backup.","success");
        }catch(e){saySync("Imported local recovery file; cloud restore did not complete.","warning");}
      }
      say("Encrypted recovery file imported.","success");
    }catch(e){say(e.message||"Recovery file could not be imported.","error");}
  }
  async function removeMemory(id) {
    const item=state?.memories.find(m=>m.id===id);
    if(!item||!confirm("Forget this memory?"))return;
    const now=new Date().toISOString();item.deletedAt=now;item.updatedAt=now;
    try{await save();}catch(e){say(e.message,"error");}
  }
  async function clearVault() {
    if(!confirm("Permanently delete this local vault and encrypted cloud backup, if enabled?"))return;
    try{
      if(sync?.enabled){const {response}=await requestJson("/api/vault/delete",{vaultId:sync.vaultId,token:sync.token});if(!response.ok)throw new Error("Cloud backup could not be deleted. Local vault has been kept.");}
      await record("vault",null,true);await record("sync",null,true);
      key=null;state=null;envelope=null;sync=null;$("memoryShareSession").checked=false;
      show("setup");saySync("No cloud backup configured.");say("Local vault and cloud backup were deleted.","success");
    }catch(e){say(e.message||"Vault deletion failed.","error");}
  }
  $("createVault").addEventListener("click",()=>void create());
  $("unlockVault").addEventListener("click",()=>void unlockVault());
  $("importVault").addEventListener("click",()=>void importKit("memoryRecoveryFile","memoryImportPassphrase"));
  $("importVaultUnlock").addEventListener("click",()=>void importKit("memoryRecoveryFileUnlock","memoryImportPassphraseUnlock"));
  addForm.addEventListener("submit",async(event)=>{
    event.preventDefault();if(!state)return;
    const title=$("memoryTitle").value.trim(),text=$("memoryText").value.trim();
    if(!title||!text||title.length>100||text.length>1200){say("Add a short title and a memory under 1,200 characters.","warning");return;}
    const now=new Date().toISOString(),editId=addForm.dataset.editId;
    if(editId){const m=state.memories.find(x=>x.id===editId);if(m){m.title=title;m.text=text;m.shareWithAI=$("memoryShare").checked;m.updatedAt=now;delete m.deletedAt;}
      delete addForm.dataset.editId;addForm.querySelector('[type="submit"]').textContent="Save memory";
    }else{state.memories.push({id:crypto.randomUUID(),title,text,shareWithAI:$("memoryShare").checked,createdAt:now,updatedAt:now});}
    addForm.reset();try{await save();}catch(e){say(e.message||"Could not save memory.","error");}
  });
  $("memoryLock").addEventListener("click",()=>{key=null;state=null;envelope=null;$("memoryShareSession").checked=false;show("unlock");say("Vault locked. Memory content is no longer available to the voice setup.","normal");});
  $("memoryEnableSync").addEventListener("click",()=>void enableSync());
  $("memoryRestoreCloud").addEventListener("click",()=>void restoreSync());
  $("memoryExport").addEventListener("click",downloadKit);
  $("memoryDeleteEverything").addEventListener("click",()=>void clearVault());
  window.askMoinaGetMemoryContext=async()=>{
    if(!key||!state||!$("memoryShareSession").checked)return "";
    return active().filter(m=>m.shareWithAI===true).slice(0,20).map(m=>m.title+": "+m.text).join("\n").slice(0,1400);
  };
  void (async()=>{try{const existing=await record("vault");show(existing?"unlock":"setup");if(!existing)say("Memory is off until you create your encrypted vault.","normal");}
    catch(_){show("setup");say("This browser could not open encrypted local storage. Use a current browser over HTTPS.","error");}})();
})();