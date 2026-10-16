import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  new URL("../.github/workflows/deploy-candidate-a-live-voice.yml", import.meta.url),
  "utf8",
);

describe("Cloudflare Worker version promotion", () => {
  it("retries temporary version-propagation delays before the guarded health fallback", () => {
    expect(workflow).toContain('for attempt in $(seq 1 8)');
    expect(workflow).toContain("sleep 2");
    expect(workflow).toContain('if [[ "$promoted" == "true" ]]; then');
    expect(workflow).toContain("Production is not serving the expected release");
    expect(workflow).toContain("Refusing to continue.");
  });
});
