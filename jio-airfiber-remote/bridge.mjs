import http from "node:http";
import https from "node:https";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { isIP } from "node:net";
import { timingSafeEqual } from "node:crypto";

const HOST = process.env.REMOTE_LISTEN_HOST || "127.0.0.1";
const PORT = Number(process.env.REMOTE_PORT || 8787);
const ALLOWED_IP = String(process.env.REMOTE_ALLOWED_IP || "").trim();
const TOKEN = String(process.env.REMOTE_TOKEN || "");
const ALLOWED_ORIGIN = String(process.env.REMOTE_ALLOWED_ORIGIN || "*").trim();
const TLS_CERT = process.env.REMOTE_TLS_CERT;
const TLS_KEY = process.env.REMOTE_TLS_KEY;
const ADB_PORT = 5555;
const ALLOWED_KEYCODES = new Set([26, 164, 19, 20, 21, 22, 66, 4, 3, 82]);

function isPrivateIPv4(ip) {
  if (isIP(ip) !== 4) return false;
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

if (!isPrivateIPv4(ALLOWED_IP)) {
  console.error("Set REMOTE_ALLOWED_IP to the set-top box's private IPv4 address (10.x, 172.16-31.x, or 192.168.x).");
  process.exit(1);
}
if (TOKEN.length < 24) {
  console.error("Set REMOTE_TOKEN to a random secret of at least 24 characters (for example: openssl rand -hex 32).");
  process.exit(1);
}
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) {
  console.error("REMOTE_PORT must be a valid TCP port between 1024 and 65535.");
  process.exit(1);
}
if (Boolean(TLS_CERT) !== Boolean(TLS_KEY)) {
  console.error("Set both REMOTE_TLS_CERT and REMOTE_TLS_KEY to enable HTTPS, or leave both unset.");
  process.exit(1);
}

const adbTarget = ALLOWED_IP + ":" + ADB_PORT;

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Vary": "Origin"
  });
  response.end(JSON.stringify(data));
}

function originIsAllowed(request) {
  const origin = request.headers.origin;
  return !origin || ALLOWED_ORIGIN === "*" || origin === ALLOWED_ORIGIN;
}

function authorized(request) {
  const header = String(request.headers.authorization || "");
  const supplied = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
  const expected = Buffer.from(TOKEN);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8192) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (_) {
    throw new Error("Request body must be valid JSON.");
  }
}

function runAdb(args, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let done = false;
    const child = spawn("adb", args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      child.kill();
      reject(new Error("ADB timed out. Check that the set-top box is reachable."));
    }, timeoutMs);

    child.stdout.on("data", chunk => { stdout += chunk.toString(); });
    child.stderr.on("data", chunk => { stderr += chunk.toString(); });
    child.on("error", error => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error.code === "ENOENT") {
        reject(new Error("Android Platform Tools are not installed or adb is not on PATH."));
      } else {
        reject(new Error("Could not start adb: " + error.message));
      }
    });
    child.on("close", code => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error((stderr || stdout || ("adb exited with code " + code)).trim()));
    });
  });
}

async function connectAndVerify() {
  await runAdb(["connect", adbTarget]);
  const state = await runAdb(["-s", adbTarget, "get-state"]);
  if (state.trim() !== "device") {
    throw new Error("ADB did not report the set-top box as ready. Authorize this bridge on the TV.");
  }
}

function validateTarget(body) {
  if (!body || body.host !== ALLOWED_IP) {
    throw new Error("The requested IP is not the allowlisted set-top box.");
  }
  if (body.port !== undefined && Number(body.port) !== ADB_PORT) {
    throw new Error("Only ADB TCP port 5555 is allowed.");
  }
}

function respondError(response, status, error) {
  sendJson(response, status, { ok: false, error: error.message || "Request failed." });
}

async function handleRequest(request, response) {
  if (!originIsAllowed(request)) {
    sendJson(response, 403, { ok: false, error: "Origin is not allowlisted." });
    return;
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "600",
      "Vary": "Origin"
    });
    response.end();
    return;
  }

  const url = new URL(request.url || "/", "http://127.0.0.1");
  if (request.method !== "POST" || !["/api/health", "/api/keyevent"].includes(url.pathname)) {
    sendJson(response, 404, { ok: false, error: "Endpoint not found." });
    return;
  }
  if (!authorized(request)) {
    sendJson(response, 401, { ok: false, error: "Invalid bridge token." });
    return;
  }

  let body;
  try {
    body = await readJson(request);
    validateTarget(body);
  } catch (error) {
    respondError(response, 400, error);
    return;
  }

  try {
    await connectAndVerify();

    if (url.pathname === "/api/health") {
      sendJson(response, 200, {
        ok: true,
        status: "device",
        target: ALLOWED_IP,
        adbPort: ADB_PORT
      });
      return;
    }

    const keyCode = Number(body.keyCode);
    if (!Number.isInteger(keyCode) || !ALLOWED_KEYCODES.has(keyCode)) {
      sendJson(response, 400, { ok: false, error: "That Android key event is not in the allowed-key list." });
      return;
    }

    // Use argv, not shell interpolation; only a fixed host, fixed port and allowlisted key code can be sent.
    await runAdb(["-s", adbTarget, "shell", "input", "keyevent", String(keyCode)]);
    sendJson(response, 200, {
      ok: true,
      keyCode,
      keyName: String(body.keyName || "key")
    });
  } catch (error) {
    respondError(response, 502, error);
  }
}

const serverOptions = TLS_CERT && TLS_KEY
  ? { key: readFileSync(TLS_KEY), cert: readFileSync(TLS_CERT) }
  : undefined;
const handler = (req, res) => {
  handleRequest(req, res).catch(error => respondError(res, 500, error));
};
const server = serverOptions
  ? https.createServer(serverOptions, handler)
  : http.createServer(handler);

server.listen(PORT, HOST, () => {
  const scheme = serverOptions ? "https" : "http";
  console.log("AirFiber ADB bridge listening at " + scheme + "://" + HOST + ":" + PORT);
  console.log("Allowlisted TV target: " + adbTarget);
  if (!serverOptions && HOST !== "127.0.0.1" && HOST !== "localhost") {
    console.warn("WARNING: HTTP is enabled on a network interface. Use trusted HTTPS for browser access; do not expose this endpoint directly.");
  }
});