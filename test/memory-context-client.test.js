import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("static client memory handoff", () => {
  it("sends the selected vault notes in the first voice setup frame", () => {
    const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
    expect(app).toContain("function readOptedInMemoryContext()");
    expect(app).toContain("localStorage.getItem(MEMORY_CONSENT_KEY)");
    expect(app).toContain('if (consent === "disabled") return "";');
    expect(app).toContain("selectedMemoryContext = readOptedInMemoryContext();");
    expect(app).toContain("setupPayload.memory_context = selectedMemoryContext");
    expect(app).toContain("sessionSocket.send(JSON.stringify(setupPayload))");
    const worker = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
    expect(worker).toContain("buildPersonalizedSystemInstruction(");
    expect(worker).toContain("memoryContext,");
    expect(worker).toContain("buildAssamesePronunciationInstruction(env.DB)");
    expect(worker).toContain("inputAudioTranscription: {}");
    expect(worker).toContain("outputAudioTranscription: {}");
  });

  it("routes the static entry to the Worker-controlled public audio shell", () => {
    const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
    const worker = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
    const audio = readFileSync(new URL("../public/audio.html", import.meta.url), "utf8");
    expect(html).toContain("url=/");
    expect(html).not.toContain('href="/vault"');
    expect(worker).toContain('const audioUrl = new URL("/audio", request.url)');
    expect(worker).not.toContain("ENTRY_PRODUCTS_OVERLAY");
    expect(audio).toContain('id="toggleVoice"');
    expect(audio).not.toContain('id="videoPreview"');
    expect(audio).toContain('id="mathFundCard"');
  });

  it("routes the static homepage through the Worker for identity and memory-context setup", () => {
    const config = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
    const routes = config.assets.run_worker_first;
    for (const path of ["/", "/index.html", "/api/*", "/copilot", "/copilot.html", "/copilot.js", "/copilot.css", "/login.html", "/account.html", "/auth.js", "/vault", "/vault.js", "/app.js"]) {
      expect(routes).toContain(path);
    }
  });
});
