import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("public activity and support preview", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const script = readFileSync(new URL("../public/audio-chat.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../public/audio-chat.css", import.meta.url), "utf8");
  const worker = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  const continuity = readFileSync(new URL("../src/continuity.ts", import.meta.url), "utf8");

  it("labels the changing visitor number as a preview and constrains it to the requested range", () => {
    expect(html).toContain('class="visitor-chip-label">PREVIEW</span>');
    expect(html).toContain("not actual visitor analytics");
    expect(script).toContain("VISITOR_PREVIEW_MIN = ownerPreviewMode ? 73000 : 9000");
    expect(script).toContain("VISITOR_PREVIEW_MAX = ownerPreviewMode ? 73999 : 15000");
    expect(script).toContain('"askmoina.support.owner-preview.total.v1"');
    expect(script).toContain("SUPPORT_PREVIEW_MIN = ownerPreviewMode ? 501000 : 218000");
    expect(script).toContain("SUPPORT_PREVIEW_MAX = ownerPreviewMode ? 529999 : 229999");
    expect(script).toContain("setTimeout(animateVisitorPreview");
    expect(script).toContain("count-digit-strip");
    expect(css).toContain("@keyframes preview-orbit");
  });

  it("offers an available moinaOS 1 card and a disabled moinaOS 2 future card", () => {
    expect(html).toContain('id="osModelPicker"');
    expect(html).toContain('id="tryMoinaOS1">Try for free');
    expect(html).toContain('id="moinaOS2Title">moinaOS 2');
    expect(html).toContain("More advanced AI.");
    expect(html).toContain('id="moinaOS2Disabled" disabled');
    expect(html).toContain('class="conversation" aria-label="Voice test" hidden');
    const selection = readFileSync(new URL("../public/os-selection.js", import.meta.url), "utf8");
    expect(selection).toContain('tryButton.addEventListener("click"');
    expect(selection).toContain("composer.scrollIntoView");
    expect(css).toContain(".os-card-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))");
    expect(css).toContain("@media(max-width:620px)");
    expect(css).toContain(".os-card-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}");
    expect(css).toContain('body[data-owner-preview="true"] .support-status,');
  });

  it("keeps the illustrative support amount separate from verified contributions", () => {
    expect(html).toContain("preview total · not donations");
    expect(html).toContain("Preview figures are illustrative, not actual donations.");
    expect(html).toContain('id="verifiedSupportRaised"');
    expect(script).toContain("askmoina.support.preview.total.v1");
    expect(script).toContain("localStorage.setItem(SUPPORT_PREVIEW_KEY");
    expect(script).toContain('fetch("/api/support/status"');
    expect(script).toContain("Verified support status unavailable");
    expect(html).toContain("<h1>moinaOS 1</h1>");
    expect(html).toContain("<h2>Support us</h2>");
    expect(html).not.toContain("Guest · Live voice");
    expect(css).toContain("body[data-owner-preview=\"true\"] .support-card-topline");
    expect(css).toContain(".os-model-card--ready{position:relative;z-index:1;transform:translateY(-4px)");
  });

  it("only serves realistic support wording through the authenticated owner preview", () => {
    expect(worker).toContain('const ownerPreviewRequested = url.searchParams.get("ownerPreview") === "1";');
    expect(worker).toContain('const ownerPreview = ownerPreviewRequested && await isAdmin(request, env);');
    expect(worker).toContain('if (ownerPreviewRequested && !ownerPreview)');
    expect(worker).toContain('new URL("/admin/login", request.url)');
    expect(worker).toContain('url.pathname === "/os-selection.js"');
    expect(continuity).toContain('SameSite=Lax');
    expect(continuity).toContain('href="/?ownerPreview=1" target="_blank" rel="noopener">Support copy preview</a>');
    expect(worker).toContain('<body data-owner-preview="true">');
    expect(worker).toContain('headers.set("Cache-Control", "private, no-store")');
    expect(worker).toContain("Total donations");
    expect(worker).toContain("['Preview figures are illustrative, not actual donations.', '']");
    expect(html).toContain("preview total · not donations");
    expect(script).toContain('document.body?.dataset.ownerPreview === "true"');
  });

  it("has a dedicated interrupt control that flushes playback while keeping capture active", () => {
    expect(html).toContain('id="interruptVoice"');
    expect(script).toContain('interruptButton.addEventListener("click", interruptAssistant)');
    expect(script).toContain('socket.send(JSON.stringify({ interrupt: true }))');
    expect(script).toContain("stopPlayback();");
    expect(script).toContain("sendMicrophoneChunk(event.inputBuffer.getChannelData(0))");
    expect(worker).toContain('parsed.kind === "interrupt"');
    expect(worker).toContain("turnComplete: false");
  });

});
