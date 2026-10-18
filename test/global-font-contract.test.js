import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const publicRoot = join(repoRoot, "public");
const globalFontCss = readFileSync(join(publicRoot, "askmoina-global-font.css"), "utf8");
const brandSystem = readFileSync(join(repoRoot, "docs", "ASKMOINA-BRAND-SYSTEM-V1.md"), "utf8");
const workerSource = readFileSync(join(repoRoot, "src", "index.ts"), "utf8");

function collectHtmlPages(directory) {
  const paths = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...collectHtmlPages(fullPath));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) paths.push(fullPath);
  }
  return paths;
}

describe("AskMoina global typography contract", () => {
  it("defines askmoina-global-font as the single universal UI font", () => {
    expect(globalFontCss).toContain('font-family: "askmoina-global-font"');
    expect(globalFontCss).toContain('--askmoina-global-font: "askmoina-global-font"');
    expect(globalFontCss).toMatch(
      /\*,\s*\*::before,\s*\*::after\s*\{[\s\S]*?font-family:\s*var\(--askmoina-global-font\)\s*!important;/
    );
  });

  it("loads the global font stylesheet last on every static HTML page", () => {
    const pages = collectHtmlPages(publicRoot);
    expect(pages.length).toBeGreaterThan(0);

    for (const pagePath of pages) {
      const html = readFileSync(pagePath, "utf8");
      const label = relative(repoRoot, pagePath);
      const globalFontIndex = html.indexOf("askmoina-global-font.css");
      expect(globalFontIndex, label + " must load askmoina-global-font.css").toBeGreaterThanOrEqual(0);

      const stylesheetLinks = [...html.matchAll(/<link\b[^>]*\brel=["']stylesheet["'][^>]*>/gi)];
      for (const match of stylesheetLinks) {
        if (match[0].includes("askmoina-global-font.css")) continue;
        expect(match.index, label + " must load component styles before the global font").toBeLessThan(globalFontIndex);
      }
    }
  });

  it("injects the canonical font into Worker-generated application and information shells", () => {
    expect(workerSource).toContain("/askmoina-global-font.css");
    expect(workerSource).toContain("function withNativeAppShell");
    expect(workerSource).toContain("function renderSiteInfoPage");
    expect(workerSource).toContain("function withSiteChrome");
  });

  it("preserves the typography rule for future UI work", () => {
    expect(brandSystem).toContain("The canonical UI typography name is **`askmoina-global-font`**");
    expect(brandSystem).toContain("All visible UI text must inherit this one family");
    expect(brandSystem).toContain("Future UI work must load `/askmoina-global-font.css`");
  });
});
