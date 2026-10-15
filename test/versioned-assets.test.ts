import { describe, expect, it } from "vitest";
import { removeCopilotClientScript, versionCopilotAssetUrls } from "../src/sessions/versioned-assets";

describe("versioned Co-Pilot browser assets", () => {
  it("ties JavaScript and CSS cache keys to the active Worker release", () => {
    const html = '<link rel="stylesheet" href="/copilot.css?v=0.4.36"><script src="/copilot.js?v=0.4.36" defer></script>';
    expect(versionCopilotAssetUrls(html, "0.4.38"))
      .toBe('<link rel="stylesheet" href="/copilot.css?v=0.4.38"><script src="/copilot.js?v=0.4.38" defer></script>');
  });

  it("rejects unsafe or malformed version strings", () => {
    const html = '<link rel="stylesheet" href="/copilot.css?v=old">';
    expect(versionCopilotAssetUrls(html, '0.4.38" onload="alert(1)'))
      .toBe('<link rel="stylesheet" href="/copilot.css?v=0.0.0">');
  });

  it("removes a queried Co-Pilot script from the entry page", () => {
    const html = '<html><script src="/copilot.js?v=0.4.36" defer></script><script src="/auth.js" defer></script></html>';
    expect(removeCopilotClientScript(html))
      .toBe('<html><script src="/auth.js" defer></script></html>');
  });

  it("leaves unrelated scripts untouched", () => {
    const html = '<script src="/auth.js" defer></script><script src="/entry-menu.js" defer></script>';
    expect(removeCopilotClientScript(html)).toBe(html);
  });
});
