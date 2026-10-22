import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("public activity and support preview", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const script = readFileSync(new URL("../public/audio-chat.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../public/audio-chat.css", import.meta.url), "utf8");
  const worker = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");

  it("labels the changing visitor number as a preview and constrains it to the requested range", () => {
    expect(html).toContain('class="visitor-chip-label">PREVIEW</span>');
    expect(html).toContain("not actual visitor analytics");
    expect(script).toContain("VISITOR_PREVIEW_MIN = 9000");
    expect(script).toContain("VISITOR_PREVIEW_MAX = 15000");
    expect(script).toContain("setTimeout(animateVisitorPreview");
    expect(script).toContain("count-digit-strip");
    expect(css).toContain("@keyframes preview-orbit");
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
  });

  it("only serves realistic support wording through the authenticated owner preview", () => {
    expect(worker).toContain('url.searchParams.get("ownerPreview") === "1" && await isAdmin(request, env)');
    expect(worker).toContain('<body data-owner-preview="true">');
    expect(worker).toContain('headers.set("Cache-Control", "private, no-store")');
    expect(worker).toContain("raised toward our goal");
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
