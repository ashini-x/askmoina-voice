import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

const manifest = JSON.parse(read("public/manifest.webmanifest"));
assert.equal(manifest.display, "standalone", "manifest must request standalone display mode");
assert.equal(manifest.scope, "/", "manifest scope must cover the app");
assert.equal(manifest.start_url, "/?source=pwa", "manifest start URL mismatch");
assert.ok(manifest.icons.some((icon) => icon.src === "/pwa-icon-192.svg" && icon.sizes === "192x192"), "manifest needs a 192x192 app icon");
assert.ok(manifest.icons.some((icon) => icon.src === "/pwa-icon-512.svg" && icon.sizes === "512x512"), "manifest needs a 512x512 app icon");
assert.ok(manifest.icons.some((icon) => icon.src === "/askmoina-app-icon-180.png" && icon.sizes === "180x180" && icon.type === "image/png"), "manifest needs the monochrome 180x180 Home Screen icon");
assert.ok(existsSync(resolve(root, "public/askmoina-app-icon-180.png")), "AskMoina monochrome app icon is missing");
assert.ok(existsSync(resolve(root, "public/askmoina-mark.svg")), "AskMoina primary mark is missing");
assert.ok(existsSync(resolve(root, "public/askmoina-logo.svg")), "AskMoina wordmark is missing");
assert.ok(existsSync(resolve(root, "public/askmoina-social-avatar.svg")), "AskMoina social avatar is missing");
assert.ok(existsSync(resolve(root, "public/askmoina-visual-guide.svg")), "AskMoina visual guide mark is missing");

const gate = read("public/pwa-gate.js");
assert.ok(gate.includes('window.matchMedia("(display-mode: standalone)")'), "gate must inspect actual standalone display mode");
assert.ok(gate.includes("window.navigator.standalone === true"), "gate must support iOS standalone detection");
assert.ok(gate.includes('window.location.replace("/install")'), "browser-tab users must be routed to the install landing page");
assert.ok(!gate.includes("location.search") && !gate.includes("searchParams"), "a query string must not unlock the app");

const worker = read("src/index.ts");
assert.ok(worker.includes('if (isPwaStandaloneAppPath(url.pathname)) html = withPwaStandaloneGate(html);'), "home page standalone gate missing");
assert.ok(worker.includes('apple-mobile-web-app-title" content="AskMoina'), "iOS Home Screen app title metadata missing");
assert.ok(worker.includes('cameraFirst ? "#090b0f" : "#f5f5f7"'), "PWA theme color must match camera and light app surfaces");
assert.ok(worker.includes("const cameraFirst = /<main") && !worker.includes("lightEntrySurface"), "camera-first app and sign-in must keep dark system bars");
assert.ok(worker.includes('withNativeAppShell(html, env.APP_VERSION || "0.4.64", authenticated)'), "root must use the native app shell");
assert.ok(!worker.includes("ENTRY_PRODUCTS_OVERLAY"), "legacy website product chooser must be removed");
assert.ok(worker.includes("const NATIVE_APP_MENU_SHEET") && worker.includes("native-menu-signout"), "native app menu must include app settings and sign-out");
assert.ok(read("public/native-app.css").includes(".native-menu-sheet"), "native app menu styling is missing");
assert.ok(read("public/native-app.css").includes(".native-info-main"), "native secondary-page styling is missing");
assert.ok(read("public/native-app.js").includes("nativeMenuSheet"), "native app menu interactions are missing");
assert.ok(worker.includes('cameraFirst ? "black-translucent" : "default"'), "iOS status bar mode must follow the app surface");
assert.ok(read("public/styles.css").includes("env(safe-area-inset-bottom,0px)"), "voice UI must respect the iOS home-indicator safe area");
assert.ok(read("public/site-chrome.css").includes("min-width:44px;min-height:44px"), "navigation menu must expose a native-size touch target");
assert.ok(read("public/copilot.css").includes("iOS standalone app polish"), "camera UI must include iOS-specific layout polish");
assert.ok(read("src/copilot-assets.ts").includes("iOS standalone app polish"), "deployed embedded camera CSS must include iOS-specific layout polish");
assert.ok(worker.includes("body = withPwaStandaloneGate(body)"), "Co-Pilot standalone gate missing");
assert.ok(worker.includes("assetHtml = withPwaStandaloneGate(assetHtml)"), "sign-in standalone gate missing");
assert.ok(worker.includes("PWA_PUBLIC_STATIC_PATHS.has(url.pathname)"), "public PWA static assets must bypass the auth redirect");
assert.ok(worker.includes('"/manifest.webmanifest": "application/manifest+json; charset=utf-8"'), "manifest needs an explicit content type");
assert.ok(worker.includes("? withPwaStandaloneGate(siteDecorated)"), "auth-served sign-in HTML must also pass through the standalone gate");

const serviceWorker = read("public/service-worker.js");
assert.ok(serviceWorker.includes('"/install"'), "service worker must precache the canonical install route");
assert.ok(serviceWorker.includes('caches.match("/offline")'), "service worker must use the canonical offline route");
assert.ok(serviceWorker.includes('fetch(request, { cache: "no-store" })'), "service worker must revalidate active UI code");
assert.ok(serviceWorker.includes('if (url.pathname.startsWith("/api/")'), "authenticated APIs must bypass the service worker cache strategy");
assert.ok(serviceWorker.includes('request.mode === "navigate"'), "navigation network-first behavior is required");
assert.ok(!serviceWorker.includes('"/app.js"'), "app JavaScript must not be precached");
assert.ok(!serviceWorker.includes('"/copilot.js"'), "Co-Pilot JavaScript must not be precached");

for (const path of ["public/pwa-gate.js", "public/pwa-runtime.js", "public/service-worker.js"]) {
  execFileSync(process.execPath, ["--check", resolve(root, path)], { stdio: "pipe" });
}

console.log("PWA contract smoke: passed");
