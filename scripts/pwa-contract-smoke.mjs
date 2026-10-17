import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

const manifest = JSON.parse(read("public/manifest.webmanifest"));
const manifestIconPath = (icon) => (icon.src || "").split("?")[0];
assert.equal(manifest.display, "standalone", "manifest must request standalone display mode");
assert.equal(manifest.scope, "/", "manifest scope must cover the app");
assert.equal(manifest.start_url, "/?source=pwa", "manifest start URL mismatch");
assert.equal(manifest.theme_color, "#030406", "PWA theme color must match the black launch interface");
assert.equal(manifest.background_color, "#030406", "PWA launch background must match Interface 1");
assert.ok(manifest.icons.some((icon) => manifestIconPath(icon) === "/pwa-icon-192.svg" && icon.sizes === "192x192"), "manifest needs a 192x192 app icon");
assert.ok(manifest.icons.some((icon) => manifestIconPath(icon) === "/pwa-icon-512.svg" && icon.sizes === "512x512"), "manifest needs a 512x512 app icon");
assert.ok(manifest.icons.some((icon) => manifestIconPath(icon) === "/pwa-icon-512.png" && icon.sizes === "512x512" && icon.type === "image/png"), "Android splash requires a real 512x512 PNG icon");
assert.ok(!manifest.icons.some((icon) => ["/askmoina-bird-final.png", "/askmoina-app-icon-180.png"].includes(manifestIconPath(icon))), "legacy and 180px icons must not override the Android splash icon");
assert.ok(existsSync(resolve(root, "public/askmoina-bird-final.png")), "legacy AskMoina icon fallback is missing");
assert.ok(existsSync(resolve(root, "public/askmoina-app-icon-180.png")), "AskMoina iOS Home Screen icon is missing");
assert.ok(existsSync(resolve(root, "public/pwa-icon-512.png")), "512x512 PNG launch icon is missing");
assert.ok(read("public/install.html").includes('rel="apple-touch-icon" href="/askmoina-app-icon-180.png?v=0.4.82"'), "iOS touch icon metadata should stay available independently of the Android splash manifest");
assert.ok(existsSync(resolve(root, "public/askmoina-mark.svg")), "AskMoina primary mark is missing");
assert.ok(existsSync(resolve(root, "public/favicon.svg")), "circular AskMoina favicon is missing");
assert.ok(existsSync(resolve(root, "public/favicon-32.png")), "32px AskMoina favicon fallback is missing");
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
assert.ok(worker.includes('const themeColor = "#030406"'), "PWA theme must match Interface 1");
assert.ok(worker.includes('const statusBarStyle = "black-translucent"') && !worker.includes("lightEntrySurface"), "PWA system bars must use the dark appearance");
assert.ok(worker.includes('<meta name="color-scheme" content="dark">'), "PWA shell must declare dark color scheme");
assert.ok(worker.includes('class="app-launch-transition"'), "native app launch transition is missing");
assert.ok(read("public/native-app.css").includes("@keyframes app-launch-mark-in"), "launch mark animation is missing");
assert.ok(worker.includes('withNativeAppShell(html, env.APP_VERSION || "0.4.80", authenticated)'), "root must use the native app shell");
assert.ok(!worker.includes("ENTRY_PRODUCTS_OVERLAY"), "legacy website product chooser must be removed");
assert.ok(worker.includes("const NATIVE_APP_MENU_SHEET") && worker.includes("native-menu-signout"), "native app menu must include app settings and sign-out");
assert.ok(read("public/native-app.css").includes(".native-menu-sheet"), "native app menu styling is missing");
assert.ok(read("public/native-app.css").includes(".native-info-main"), "native secondary-page styling is missing");
assert.ok(read("public/native-app.js").includes("nativeMenuSheet"), "native app menu interactions are missing");
assert.ok(worker.includes('const statusBarStyle = "black-translucent"'), "iOS status bar mode must be dark");
assert.ok(read("public/styles.css").includes("env(safe-area-inset-bottom,0px)"), "voice UI must respect the iOS home-indicator safe area");
assert.ok(read("public/site-chrome.css").includes("min-width:44px;min-height:44px"), "navigation menu must expose a native-size touch target");
assert.ok(read("public/copilot.css").includes("iOS standalone app polish"), "camera UI must include iOS-specific layout polish");
assert.ok(read("src/copilot-assets.ts").includes("iOS standalone app polish"), "deployed embedded camera CSS must include iOS-specific layout polish");
assert.ok(worker.includes("body = withPwaStandaloneGate(body)"), "Co-Pilot standalone gate missing");
assert.ok(worker.includes("assetHtml = withPwaStandaloneGate(assetHtml)"), "sign-in standalone gate missing");
assert.ok(worker.includes("PWA_PUBLIC_STATIC_PATHS.has(url.pathname)"), "public PWA static assets must bypass the auth redirect");
assert.ok(worker.includes('"/manifest.webmanifest": "application/manifest+json; charset=utf-8"'), "manifest needs an explicit content type");
assert.ok(worker.includes('"/pwa-icon-512.png": "image/png"'), "512 PNG launch icon needs an explicit content type");
assert.ok(worker.includes('legacyIcons.has((icon.src || "").split("?")[0])'), "Worker must filter stale legacy splash icons");
assert.ok(worker.includes("? withPwaStandaloneGate(siteDecorated)"), "auth-served sign-in HTML must also pass through the standalone gate");

const serviceWorker = read("public/service-worker.js");
assert.ok(serviceWorker.includes('"/install"'), "service worker must precache the canonical install route");
assert.ok(serviceWorker.includes("askmoina-pwa-shell-v5"), "service worker cache must be refreshed for the dark splash icon");
assert.ok(serviceWorker.includes('"/favicon.svg?v=0.4.82"'), "service worker must precache the circular favicon");
assert.ok(serviceWorker.includes('"/favicon-32.png?v=0.4.82"'), "service worker must precache the 32px favicon");
assert.ok(serviceWorker.includes('"/pwa-icon-512.png?v=0.4.82"'), "service worker must precache the new 512px launch icon");
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
