(() => {
"use strict";
const $ = (s) => document.querySelector(s);
const DIMS = [
  ["language_match","Language match"],
  ["conversational_naturalness","Naturalness"],
  ["pronunciation_clarity","Pronunciation clarity"],
  ["code_switching","Assamese-English code-switching"],
  ["turn_taking","Turn-taking"],
  ["uncertainty_honesty","Honest uncertainty"]
];
const CASES = [
  ["AS01","Greeting","Greet me in everyday Assamese and ask how my day is going."],
  ["AS02","Casual mixed speech","Aji mood tu bhal nai yaar. Honestly, eku koribo mon ja nai."],
  ["AS03","English pronunciation control","Say naturally in English: I am studying the system seriously."],
  ["AS04","Word-specific correction","For Assamese সৰু meaning small, my preferred local pronunciation is closer to 'horu' than 'soru'. Please try that word."],
  ["AS05","Correction follow-through","That word sounded off. Repeat just that word more like 'horu', then continue."],
  ["AS06","Language switch","Explain it in English for a moment. Now bujhai diya Axomiyat, short kori."],
  ["AS07","Repeat slower","Moi last line-tu bhalke hunibo nuwarilu. Repeat just that line slowly, please."],
  ["AS08","Good news","I got selected for the job! Bohut din dhori try kori asilu."],
  ["AS09","Serious empathy","Aji gharot ekta serious problem hoise. Moi bohut tense feel kori asu."],
  ["AS10","Local-name uncertainty","I am unsure how a local place name is pronounced. Can you confirm it if I say it unclearly?"],
  ["AS11","Romanized Assamese","Aji office-or pora ahi moi tired, so etiya rest lom. Reply casually."],
  ["AS12","Clarification","Eitu tu bhal nohoi. Fix kori diya."],
  ["AS13","Formal register","Translate into formal written Assamese, not casual speech: I will submit the application tomorrow."],
  ["AS14","Noisy or unclear input","Speak one short Assamese-English phrase; repeat with one word partly masked by ambient noise."],
  ["AS15","Current local information","Axomot etiya ekta job notice ulai ase buli hunisu. Official notice confirm kori kobo pariba?"]
];
function make(tag, text, cls) {
  const n = document.createElement(tag);
  if (text !== undefined && text !== null) n.textContent = String(text);
  if (cls) n.className = cls;
  return n;
}
function button(text, onClick, cls) {
  const b = make("button", text, "btn" + (cls ? " " + cls : ""));
  b.type = "button"; b.addEventListener("click", onClick); return b;
}
async function api(path, init) {
  const response = await fetch(path, Object.assign({cache:"no-store", credentials:"same-origin"}, init || {}));
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) { location.href = "/admin/login"; throw new Error("Admin session expired."); }
  if (!response.ok) throw new Error(body.message || body.error || "Request failed.");
  return body;
}
function reviewer() {
  const reviewerCode = ($("#as-reviewer-code").value || "").trim();
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(reviewerCode)) throw new Error("Enter a stable pseudonymous reviewer code (3–80 letters/numbers/_/-), not your name.");
  if (!$("#as-native-attest").checked) throw new Error("Confirm the native-speaker attestation before submitting a review.");
  return {reviewerCode, localityScope:($("#as-reviewer-locality").value || "").trim().slice(0,120), nativeSpeakerAttestation:true};
}
function addInfo(card, label, value) {
  const p = make("p", "");
  p.append(make("strong", label + ": "), document.createTextNode(value || "—"));
  card.append(p);
}
function reviewStatus(e) {
  const count = Number(e.approvedNativeReviewCount || 0);
  if (Number(e.enabled) === 1) return "ACTIVE · rights confirmed · " + count + "/2 distinct native approvals";
  if (e.reviewStatus === "rejected") return "REJECTED · disabled";
  if (e.reviewStatus === "needs_revision") return "NEEDS REVISION · disabled";
  if (Number(e.rightsConfirmed) !== 1) return "RIGHTS PENDING · disabled · " + count + "/2 native approvals";
  return "DISABLED · " + count + "/2 distinct native approvals";
}
function renderRefs(entries) {
  const root = $("#as-references"); root.replaceChildren();
  if (!entries.length) { root.append(make("p", "No review candidates were found.")); return; }
  for (const e of entries) {
    const card = make("article", "", "review-card"); card.dataset.entryId = e.entryId;
    card.append(make("h3", e.entryId + " · " + e.interactionIntent));
    card.append(make("div", reviewStatus(e), "review-status"));
    addInfo(card, "Dialect scope", e.dialectScope);
    addInfo(card, "Language / register", String(e.languageMode || "—") + " / " + String(e.register || "—"));
    addInfo(card, "Context", e.contextSummary);
    addInfo(card, "User example", e.userExample);
    addInfo(card, "Candidate response", e.responseExample);
    addInfo(card, "Usage note", e.usageNotes);
    addInfo(card, "Avoid when", e.avoidWhen);
    addInfo(card, "Source", e.sourceTitle);
    addInfo(card, "License / permission basis", String(e.sourceLicense || "—") + " · " + String(e.permissionBasis || "—"));
    if (e.sourceUrl && /^https?:\/\//i.test(e.sourceUrl)) {
      const link = make("a", "Open source reference");
      link.href = e.sourceUrl; link.target = "_blank"; link.rel = "noopener noreferrer"; card.append(link);
    }
    const rightsLabel = make("label", "", "attest");
    const rights = document.createElement("input"); rights.type = "checkbox";
    rights.checked = Number(e.rightsConfirmed) === 1;
    rightsLabel.append(rights, document.createTextNode("I checked the displayed source/license/permission basis and confirm it is accurate for AskMoina use."));
    card.append(rightsLabel);
    const decisionLabel = make("label", "Your native-language decision");
    const decision = document.createElement("select");
    for (const pair of [["","Choose a decision"],["approved","Approve this wording and regional fit"],["needs_revision","Needs revision"],["rejected","Reject this candidate"]]) {
      const option = make("option", pair[1]); option.value = pair[0]; decision.append(option);
    }
    const previous = (e.reviews || []).find((r) => r.reviewerCode === ($("#as-reviewer-code").value || "").trim());
    if (previous) decision.value = previous.decision;
    decisionLabel.append(decision); card.append(decisionLabel);
    const notesLabel = make("label", "Brief, non-identifying note (no transcript)");
    const notes = document.createElement("textarea"); notes.maxLength = 280;
    notes.placeholder = "Why this fits or needs changing (max 280 characters)";
    if (previous) notes.value = previous.notes || "";
    notesLabel.append(notes); card.append(notesLabel);
    const history = make("div", "", "review-meta"); history.append(make("strong", "Review history"));
    if (!(e.reviews || []).length) history.append(make("p", "No reviews saved."));
    for (const r of (e.reviews || [])) {
      const line = make("p", String(r.reviewerCode) + " (" + String(r.reviewerType) + "): " + String(r.decision) + " · " + String(r.localityScope || "scope not recorded") + " · " + String(r.reviewedAt || ""));
      if (r.notes) line.append(document.createTextNode(" — " + String(r.notes)));
      history.append(line);
    }
    card.append(history);
    card.append(button("Save review", async () => {
      const status = $("#as-review-status");
      try {
        const who = reviewer(); if (!decision.value) throw new Error("Choose approve, needs revision, or reject.");
        status.textContent = "Saving review for " + e.entryId + "…";
        const result = await api("/admin/api/assamese/reference-review", {
          method:"POST", headers:{"Content-Type":"application/json"},
          body:JSON.stringify(Object.assign({}, who, {entryId:e.entryId, decision:decision.value, notes:notes.value, rightsConfirmed:rights.checked}))
        });
        status.textContent = result.message || "Review saved."; await loadRefs();
      } catch (err) { status.textContent = err.message || "Could not save review."; }
    }));
    root.append(card);
  }
}
async function loadRefs() {
  $("#as-review-status").textContent = "Loading M2 reference candidates…";
  try {
    const out = await api("/admin/api/assamese/references"); renderRefs(out.entries || []);
    $("#as-review-status").textContent = "A phrase stays disabled until source/use rights are confirmed and two genuinely distinct native speakers approve it. Use one stable code per reviewer; never create extra codes to simulate a second person.";
  } catch (err) { $("#as-review-status").textContent = err.message || "Could not load references."; }
}
function renderSpeechCases() {
  const root = $("#as-speech-cases"); root.replaceChildren();
  for (const c of CASES) {
    const card = make("article", "", "review-card"); card.dataset.caseId = c[0];
    card.append(make("h3", c[0] + " · " + c[1]));
    const prompt = make("p", c[2]); prompt.className = "review-meta"; card.append(prompt);
    card.append(button("Copy test prompt", async () => {
      try { await navigator.clipboard.writeText(c[2]); $("#as-speech-status").textContent = c[0] + " prompt copied. Run it in Co-Pilot, then score the audio you actually heard."; }
      catch { $("#as-speech-status").textContent = "Copy unavailable. Select and copy the prompt text above, then test it in Co-Pilot."; }
    }, "copy-prompt"));
    const grid = make("div", "", "score-grid");
    for (const d of DIMS) {
      const row = make("label", "", "score-row"); row.append(make("span", d[1]));
      const select = document.createElement("select"); select.dataset.dimension = d[0];
      for (const pair of [["","Not rated"],["0","0 · Fail"],["1","1 · Partial"],["2","2 · Pass"]]) {
        const option = make("option", pair[1]); option.value = pair[0]; select.append(option);
      }
      row.append(select); grid.append(row);
    }
    card.append(grid);
    const failLabel = make("label", "", "attest");
    const fail = document.createElement("input"); fail.type = "checkbox"; fail.dataset.critical = "true";
    failLabel.append(fail, document.createTextNode("Critical failure observed in this case")); card.append(failLabel);
    const notesLabel = make("label", "Non-identifying note (no transcript or personal details)");
    const notes = document.createElement("textarea"); notes.maxLength = 280; notes.dataset.notes = "true";
    notes.placeholder = "Example: English /s/ sounded distorted; repeat handling failed.";
    notesLabel.append(notes); card.append(notes); root.append(card);
  }
}
async function submitSpeech() {
  const status = $("#as-speech-status");
  try {
    const who = reviewer(), results = [];
    for (const card of $("#as-speech-cases").querySelectorAll("[data-case-id]")) {
      const ratings = {};
      for (const d of DIMS) {
        const value = card.querySelector("select[data-dimension='" + d[0] + "']").value;
        ratings[d[0]] = value === "" ? null : Number(value);
      }
      const critical = card.querySelector("[data-critical]").checked;
      const notes = card.querySelector("textarea[data-notes]").value.slice(0,280);
      results.push({case_id:card.dataset.caseId, ratings, critical_failures:critical ? ["critical_audio_or_language_failure"] : [], notes});
    }
    status.textContent = "Validating and saving score-only M1 evaluation…";
    const out = await api("/admin/api/assamese/speech-runs", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({evaluatorCode:who.reviewerCode, nativeSpeakerAttestation:who.nativeSpeakerAttestation, suiteVersion:"1.0.0", results})
    });
    status.textContent = "Saved · " + out.completedCases + "/15 complete · overall " + (out.overallPercent === null ? "not scored" : out.overallPercent + "%") + " · critical failures " + out.criticalFailureCount + " · " + (out.passed ? "NUMERICAL THRESHOLDS PASSED" : "M1 acceptance not yet passed");
    await loadSpeechHistory();
  } catch (err) { status.textContent = err.message || "Could not save evaluation."; }
}
async function loadSpeechHistory() {
  const root = $("#as-speech-history"); root.replaceChildren();
  try {
    const out = await api("/admin/api/assamese/speech-runs");
    root.append(make("h3", "Saved score-only evaluations"));
    if (!(out.runs || []).length) { root.append(make("p", "No native-speaker score runs saved yet.")); return; }
    for (const r of out.runs) {
      let dims = {}; try { dims = JSON.parse(r.dimensionsJson || "{}"); } catch {}
      const passed = Number(r.passed) === 1;
      const card = make("article", "", "review-card " + (passed ? "success" : "failure"));
      card.append(make("h3", (passed ? "Numerical score gate passed" : "Acceptance pending") + " · " + String(r.evaluationDate || "")));
      card.append(make("p", String(r.evaluatorCode) + " · " + String(r.completedCases) + "/" + String(r.totalCases) + " complete · overall " + (r.overallPercent == null ? "not scored" : String(r.overallPercent) + "%") + " · critical failures " + String(r.criticalFailureCount)));
      for (const d of DIMS) card.append(make("p", d[1] + ": " + (dims[d[0]] && dims[d[0]].percent != null ? dims[d[0]].percent + "%" : "not scored")));
      root.append(card);
    }
  } catch (err) {
    root.append(make("p", err.message || "Score history is not available; apply the score-only review migration."));
  }
}
$("#as-refresh-refs").addEventListener("click", loadRefs);
$("#as-refresh-scores").addEventListener("click", loadSpeechHistory);
$("#as-submit-speech").addEventListener("click", submitSpeech);
renderSpeechCases(); loadRefs(); loadSpeechHistory();
})();