import {
  classifyBrvinFailure,
  createBrvinConnector,
  formatBrvinCitation,
  formatBrvinEvidence,
  type BrvinFailure,
  type BrvinV2RpcBinding,
} from "../../../src/brvin-connector/index";

interface Env {
  BRVIN_SERVICE?: BrvinV2RpcBinding;
  BRVIN_TEST_ACCESS_TOKEN?: string;
}

interface ApiFailure {
  ok: false;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    action?: string;
    requestId?: string;
  };
}

const MAX_QUERY_LENGTH = 2_000;
const MAX_PROJECT_ID_LENGTH = 128;
const MAX_PDF_PAGE = 100_000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function failure(
  code: string,
  message: string,
  status: number,
  retryable = false,
  requestId?: string,
  action?: string,
): Response {
  const body: ApiFailure = {
    ok: false,
    error: {
      code,
      message,
      retryable,
      ...(requestId ? { requestId } : {}),
      ...(action ? { action } : {}),
    },
  };
  return json(body, status);
}

function equalSecret(expected: string, actual: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(expected);
  const right = encoder.encode(actual);
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function authenticate(request: Request, env: Env): Response | null {
  const expected = env.BRVIN_TEST_ACCESS_TOKEN?.trim();
  if (!expected) {
    return failure(
      "TEST_ACCESS_NOT_CONFIGURED",
      "The test interface is not configured for tester access yet.",
      503,
    );
  }

  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/iu);
  if (!match || !equalSecret(expected, match[1])) {
    return failure("UNAUTHORIZED", "Enter a valid test access token to continue.", 401);
  }

  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) {
    return failure("CROSS_ORIGIN_REJECTED", "Cross-origin requests are not allowed.", 403);
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return failure("CROSS_ORIGIN_REJECTED", "Cross-origin requests are not allowed.", 403);
  }
  return null;
}

function mapBrvinFailure(error: BrvinFailure): Response {
  const guidance = classifyBrvinFailure(error);
  const status = error.code === "INVALID_REQUEST" ? 400
    : error.code === "PROJECT_NOT_AUTHORIZED" ? 403
    : error.code === "PROJECT_INACTIVE" ? 409
    : error.code === "MONTHLY_LIMIT_REACHED" ? 429
    : error.code === "BRVIN_UNAVAILABLE" ? 503
    : error.code === "RETRIEVAL_FAILED" ? 502
    : 503;
  return failure(
    error.code,
    error.userMessage ?? "BRVIN could not complete this request (" + error.code + ").",
    status,
    error.retryable,
    error.requestId,
    guidance.action,
  );
}

function connector(env: Env) {
  if (!env.BRVIN_SERVICE) return null;
  return createBrvinConnector(env.BRVIN_SERVICE, {
    timeoutMs: 15_000,
    maxResponseBytes: 8 * 1024 * 1024,
  });
}

async function handleHealth(env: Env): Promise<Response> {
  if (!env.BRVIN_SERVICE) {
    return json({
      ok: true,
      connected: false,
      state: "not_connected",
      message: "This test Worker is ready for onboarding. Connect it through the BRVIN Connect Application wizard.",
    });
  }
  const api = connector(env);
  if (!api) return failure("BRVIN_NOT_CONNECTED", "The BRVIN Service Binding is not configured.", 503);
  const projects = await api.listAuthorizedProjects();
  if (!projects.ok) return mapBrvinFailure(projects);
  return json({
    ok: true,
    connected: true,
    state: "connected",
    authorizedProjectCount: projects.data.length,
  });
}

async function handleProjects(env: Env): Promise<Response> {
  const api = connector(env);
  if (!api) {
    return failure(
      "BRVIN_NOT_CONNECTED",
      "This test Worker has not been connected to BRVIN yet. Use the Connect Application wizard.",
      503,
    );
  }
  const projects = await api.listAuthorizedProjects();
  if (!projects.ok) return mapBrvinFailure(projects);
  return json({
    ok: true,
    projects: projects.data.map((project) => ({
      projectId: project.projectId,
      slug: project.slug,
      name: project.name,
      description: project.description,
      ready: project.ready,
      authorizedSourceCount: project.authorizedSourceCount,
    })),
  });
}

async function handleQuery(request: Request, env: Env): Promise<Response> {
  const api = connector(env);
  if (!api) {
    return failure(
      "BRVIN_NOT_CONNECTED",
      "This test Worker has not been connected to BRVIN yet. Use the Connect Application wizard.",
      503,
    );
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return failure("INVALID_REQUEST", "Enter a question and select an authorised project.", 400);
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return failure("INVALID_REQUEST", "The request body must be valid JSON.", 400);
  }

  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  const query = typeof body.query === "string" ? body.query.replace(/\s+/gu, " ").trim() : "";
  const pageNumber = body.pageNumber === undefined || body.pageNumber === null || body.pageNumber === ""
    ? undefined
    : Number(body.pageNumber);

  if (!projectId || projectId.length > MAX_PROJECT_ID_LENGTH || projectId !== body.projectId) {
    return failure("INVALID_REQUEST", "Select a valid authorised BRVIN project.", 400);
  }
  if (query.length > MAX_QUERY_LENGTH || (!query && pageNumber === undefined)) {
    return failure("INVALID_REQUEST", "Enter a question, or provide a PDF page number.", 400);
  }
  if (
    pageNumber !== undefined &&
    (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > MAX_PDF_PAGE)
  ) {
    return failure("INVALID_REQUEST", "PDF page must be a whole number between 1 and 100,000.", 400);
  }

  // A project ID is a selector only. Check it against the live list for this
  // trusted application environment before asking BRVIN for readiness/retrieval.
  const authorised = await api.listAuthorizedProjects();
  if (!authorised.ok) return mapBrvinFailure(authorised);
  const selected = authorised.data.find((project) => project.projectId === projectId);
  if (!selected) {
    return failure(
      "PROJECT_NOT_AUTHORIZED",
      "This application is not authorised to use the selected project.",
      403,
      false,
      undefined,
      "request_project_access",
    );
  }

  // Re-check readiness on every request. Do not cache status or grants.
  const status = await api.getProjectStatus({ projectId });
  if (!status.ok) return mapBrvinFailure(status);
  if (!status.data.ready) {
    return failure(
      "PROJECT_NOT_READY",
      "This project is authorised, but its knowledge sources are not ready yet.",
      409,
      false,
    );
  }

  const requestId = crypto.randomUUID();
  const retrieved = await api.retrieveProjectContext({
    projectId,
    queries: query ? [query] : [],
    ...(pageNumber !== undefined ? { pageNumbers: [pageNumber] } : {}),
    requestId,
  });
  if (!retrieved.ok) return mapBrvinFailure(retrieved);

  return json({
    ok: true,
    requestId,
    project: {
      projectId: selected.projectId,
      name: selected.name,
      slug: selected.slug,
    },
    query,
    pageNumber: pageNumber ?? null,
    passages: retrieved.data.passages.map((passage) => ({
      ...passage,
      citation: formatBrvinCitation(passage),
    })),
    evidenceText: formatBrvinEvidence(retrieved.data.passages),
    searchedSources: retrieved.data.searchedSources,
    searchCount: retrieved.data.searchCount,
  });
}

const HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>BRVIN Test Lab</title>
<style>
:root{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17191f;background:#f5f6f8;font-synthesis:none}
*{box-sizing:border-box}body{margin:0;min-height:100vh}.shell{max-width:1000px;margin:0 auto;padding:28px 20px 60px}
header{display:flex;justify-content:space-between;align-items:center;gap:16px;border-bottom:1px solid #e1e4e9;padding-bottom:20px}
.brand{display:flex;align-items:center;gap:12px}.mark{width:38px;height:38px;border-radius:12px;background:#171a22;color:white;display:grid;place-items:center;font-weight:800;letter-spacing:-.04em}
h1{margin:0;font-size:20px;letter-spacing:-.04em}.sub{margin:4px 0 0;color:#77808d;font-size:12px}
.status{font-size:11px;font-weight:700;color:#657080;padding:7px 10px;border-radius:20px;background:#eceff3}.status.ok{background:#e6f5ec;color:#177647}.status.bad{background:#fff0ee;color:#a43a31}
main{padding-top:28px}.intro h2{font-size:30px;letter-spacing:-.055em;margin:0 0 8px}.intro p{color:#697281;line-height:1.6;font-size:14px;margin:0;max-width:660px}
.panel{background:white;border:1px solid #e3e6eb;border-radius:16px;padding:20px;margin-top:18px;box-shadow:0 5px 20px #1a23300a}
.panel h3{font-size:14px;margin:0 0 13px;letter-spacing:-.02em}.field{display:flex;flex-direction:column;gap:7px;margin:13px 0}.field label{font-size:11px;color:#697281;font-weight:700}.field input,.field textarea,.field select{border:1px solid #dfe3e8;border-radius:10px;padding:11px 12px;font:inherit;font-size:13px;background:white;color:#17191f;width:100%}.field textarea{min-height:106px;resize:vertical;line-height:1.5}.field input:focus,.field textarea:focus,.field select:focus{outline:3px solid #2e68db22;border-color:#7d9de1}
.grid{display:grid;grid-template-columns:minmax(0,1fr) 190px;gap:12px;align-items:end}.row{display:flex;gap:9px;flex-wrap:wrap;align-items:center}
button{border:0;border-radius:10px;padding:11px 15px;background:#171a22;color:white;font:inherit;font-size:12px;font-weight:700;cursor:pointer}button.secondary{background:#f0f2f5;color:#343b46}button:disabled{opacity:.45;cursor:wait}
.hint{color:#818997;font-size:11px;line-height:1.5}.hidden{display:none!important}
.message{border-radius:10px;padding:12px 14px;margin-top:13px;font-size:12px;line-height:1.55;background:#f1f3f6;color:#505b69;white-space:pre-wrap}.message.error{background:#fff0ee;color:#9e332b}.message.success{background:#e9f6ee;color:#1b7044}
.results-head{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap}.metrics{display:flex;gap:8px;flex-wrap:wrap}.metric{font-size:10px;color:#586272;background:#f1f3f6;padding:6px 9px;border-radius:20px}
.passage{border:1px solid #e5e8ed;border-radius:12px;padding:15px;margin-top:11px}.passage-top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.cite{font-size:12px;font-weight:750;color:#24334d}.page{font-size:10px;font-weight:750;color:#395f9c;background:#edf3ff;border-radius:20px;padding:5px 8px;white-space:nowrap}.meta{font-size:10px;color:#7b8491;margin-top:5px}.passage p{font-size:13px;line-height:1.65;color:#323b47;margin:12px 0 0;white-space:pre-wrap}.empty{border:1px dashed #d9dee5;padding:24px;border-radius:12px;color:#818997;text-align:center;font-size:12px;margin-top:12px}
footer{color:#929aa6;font-size:10px;text-align:center;margin-top:24px}
@media(max-width:620px){.shell{padding:17px 13px 40px}header{align-items:flex-start}.intro h2{font-size:25px}.panel{padding:15px}.grid{grid-template-columns:1fr}.grid .field{margin-bottom:0}.passage-top{flex-direction:column}.status{font-size:10px}}
</style>
</head>
<body>
<div class="shell">
<header>
  <div class="brand"><div class="mark">B</div><div><h1>BRVIN Test Lab</h1><p class="sub">Independent text consumer · M4 reference Worker</p></div></div>
  <span class="status" id="connection">Not connected</span>
</header>
<main>
<section class="intro">
  <h2>Test knowledge retrieval.</h2>
  <p>A small, independent consumer interface for testing BRVIN application identity, authorised projects, retrieved passages and physical PDF page citations. This is separate from the AskMoina Voice application.</p>
</section>
<section class="panel" id="access-panel">
  <h3>Tester access</h3>
  <div class="field"><label for="token">Test access token</label><input id="token" type="password" autocomplete="off" placeholder="Enter the token provided to your testing group"></div>
  <div class="row"><button id="unlock">Connect test session</button><span class="hint">The token stays in this page's memory and is never placed in the URL.</span></div>
  <div id="access-message" class="message hidden" role="status"></div>
</section>
<section class="panel hidden" id="query-panel">
  <div class="results-head"><h3>Ask the knowledge library</h3><span class="hint" id="project-count"></span></div>
  <div class="grid">
    <div class="field"><label for="project">Authorised project</label><select id="project"><option value="">Loading authorised projects…</option></select></div>
    <div class="field"><label for="page">Optional exact PDF page</label><input id="page" type="number" min="1" max="100000" step="1" placeholder="e.g. 14"></div>
  </div>
  <div class="field"><label for="question">Question or search prompt</label><textarea id="question" maxlength="2000" placeholder="Ask a question about the connected knowledge library…"></textarea></div>
  <div class="row"><button id="ask">Retrieve evidence</button><button id="refresh" class="secondary" type="button">Refresh projects</button><span class="hint">No automatic retries. A timed-out retrieval may have consumed project quota.</span></div>
  <div id="query-message" class="message hidden" role="status"></div>
</section>
<section class="panel hidden" id="results-panel">
  <div class="results-head"><h3>Retrieved evidence</h3><div class="metrics" id="metrics"></div></div>
  <div id="results"><div class="empty">Your retrieved passages will appear here.</div></div>
</section>
</main>
<footer>BRVIN returns evidence and provenance. The consumer owns final answer generation.</footer>
</div>
<script>
(function(){
  var token="";
  var $=function(id){return document.getElementById(id);};
  var escapeHtml=function(value){return String(value==null?"":value).replace(/[&<>"']/gu,function(char){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[char];});};
  var showMessage=function(id,message,type){var node=$(id);node.textContent=message;node.className="message"+(type?" "+type:"");};
  var hideMessage=function(id){$(id).classList.add("hidden");};
  async function api(path,options){
    options=options||{};
    var headers=new Headers(options.headers||{});
    headers.set("authorization","Bearer "+token);
    if(options.body)headers.set("content-type","application/json");
    var response=await fetch(path,{method:options.method||"GET",headers:headers,body:options.body||undefined,credentials:"same-origin",cache:"no-store"});
    var data={};try{data=await response.json();}catch{}
    if(!response.ok||data.ok!==true){
      var error=data.error||{};
      throw new Error((error.code?error.code+": ":"")+(error.message||"Request failed (HTTP "+response.status+")."));
    }
    return data;
  }
  function setConnected(connected){
    var badge=$("connection");
    badge.textContent=connected?"BRVIN connected":"BRVIN not connected";
    badge.className="status "+(connected?"ok":"bad");
  }
  function renderProjects(projects){
    var select=$("project");
    var previous=select.value;
    select.innerHTML="";
    if(!projects.length){
      select.innerHTML='<option value="">No authorised projects</option>';
      $("project-count").textContent="No project access";
      return;
    }
    projects.forEach(function(project){
      var option=document.createElement("option");
      option.value=project.projectId;
      option.textContent=project.name+(project.ready?"":" · not ready");
      option.disabled=!project.ready;
      select.appendChild(option);
    });
    if(projects.some(function(project){return project.projectId===previous&&project.ready;}))select.value=previous;
    $("project-count").textContent=projects.length+" authorised project"+(projects.length===1?"":"s");
  }
  async function refreshProjects(){
    var health=await api("/api/health");
    setConnected(Boolean(health.connected));
    if(!health.connected)throw new Error(health.message||"This Worker has not been connected to BRVIN yet.");
    var data=await api("/api/projects");
    renderProjects(data.projects||[]);
  }
  function renderResults(data){
    $("results-panel").classList.remove("hidden");
    $("metrics").innerHTML=[
      '<span class="metric">'+escapeHtml(data.searchedSources)+' sources searched</span>',
      '<span class="metric">'+escapeHtml(data.passages.length)+' passages returned</span>',
      '<span class="metric">'+escapeHtml(data.searchCount)+' searches</span>',
      '<span class="metric">Request '+escapeHtml(data.requestId)+'</span>'
    ].join("");
    var results=$("results");
    if(!data.passages.length){results.innerHTML='<div class="empty">BRVIN returned no matching passages for this request.</div>';return;}
    results.innerHTML=data.passages.map(function(passage,index){
      return '<article class="passage"><div class="passage-top"><div><div class="cite">'+(index+1)+'. '+escapeHtml(passage.bookTitle)+'</div><div class="meta">'+escapeHtml(passage.section||"Knowledge source")+(passage.printedPage?" · Printed page "+escapeHtml(passage.printedPage):"")+'</div></div><span class="page">PDF page '+escapeHtml(passage.pdfPage)+'</span></div><p>'+escapeHtml(passage.text)+'</p></article>';
    }).join("");
  }
  $("unlock").addEventListener("click",async function(){
    token=$("token").value.trim();
    if(!token){showMessage("access-message","Enter the test access token.","error");return;}
    $("unlock").disabled=true;
    try{
      await refreshProjects();
      $("access-panel").classList.add("hidden");
      $("query-panel").classList.remove("hidden");
      showMessage("query-message","Test session connected. Projects were loaded from the trusted BRVIN application identity.","success");
    }catch(error){
      token="";
      setConnected(false);
      showMessage("access-message",error.message,"error");
    }finally{$("unlock").disabled=false;}
  });
  $("refresh").addEventListener("click",async function(){
    $("refresh").disabled=true;
    try{await refreshProjects();hideMessage("query-message");}
    catch(error){showMessage("query-message",error.message,"error");}
    finally{$("refresh").disabled=false;}
  });
  $("ask").addEventListener("click",async function(){
    var query=$("question").value.trim();
    var projectId=$("project").value;
    var page=$("page").value.trim();
    if(!projectId){showMessage("query-message","Select an authorised, ready project.","error");return;}
    if(!query&&!page){showMessage("query-message","Enter a question or an exact PDF page number.","error");return;}
    $("ask").disabled=true;
    showMessage("query-message","Retrieving authorised evidence from BRVIN…","");
    try{
      var data=await api("/api/query",{method:"POST",body:JSON.stringify({projectId:projectId,query:query,pageNumber:page||undefined})});
      hideMessage("query-message");
      renderResults(data);
    }catch(error){showMessage("query-message",error.message,"error");}
    finally{$("ask").disabled=false;}
  });
})();
</script>
</body>
</html>`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      return new Response(HTML, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
          "referrer-policy": "no-referrer",
          "x-content-type-options": "nosniff",
          "x-frame-options": "DENY",
        },
      });
    }

    if (!url.pathname.startsWith("/api/")) return json({ ok: false, error: "not_found" }, 404);
    if (request.method !== "GET" && request.method !== "POST") {
      return new Response(null, { status: 405, headers: { allow: "GET, POST", "cache-control": "no-store" } });
    }
    const authFailure = authenticate(request, env);
    if (authFailure) return authFailure;

    if (request.method === "GET" && url.pathname === "/api/health") return handleHealth(env);
    if (request.method === "GET" && url.pathname === "/api/projects") return handleProjects(env);
    if (request.method === "POST" && url.pathname === "/api/query") return handleQuery(request, env);
    return json({ ok: false, error: "not_found" }, 404);
  },
};
