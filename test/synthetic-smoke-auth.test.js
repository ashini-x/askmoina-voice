import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const grounding = readFileSync(new URL("../scripts/live-grounding-smoke.py", import.meta.url), "utf8");
const memory = readFileSync(new URL("../scripts/live-memory-voice-smoke.py", import.meta.url), "utf8");
const responseCardSmoke = readFileSync(new URL("../scripts/live-response-card-smoke.py", import.meta.url), "utf8");
const session = readFileSync(new URL("../scripts/synthetic-passkey-session.mjs", import.meta.url), "utf8");
const deploy = readFileSync(new URL("../.github/workflows/deploy-candidate-a-live-voice.yml", import.meta.url), "utf8");

describe("authenticated live synthetic verification", () => {
  it("refuses to run either websocket test with anonymous access", () => {
    for (const source of [grounding, memory]) {
      expect(source).toContain("ASKMOINA_SYNTHETIC_COOKIE");
      expect(source).toContain('AUTH_COOKIE.startswith("moina_session=")');
      expect(source).toContain("cookie=AUTH_COOKIE");
    }
  });

  it("waits for the grounded final answer after a tool-call turn completes", () => {
    // Live can mark the function-call turn complete before the grounded answer arrives.
    // The smoke test must not treat that intermediate event as the final answer.
    expect(grounding).toContain("message_has_tool_call = has_grounding_tool_call(message)");
    expect(grounding).toContain("and not message_has_tool_call");
    expect(grounding).toContain("turn_complete = True");
  });

  it("ignores non-JSON binary media frames without hiding malformed text frames", () => {
    expect(responseCardSmoke).toContain("def recv_json_message(ws):");
    expect(responseCardSmoke).toContain("if isinstance(frame, bytes):");
    expect(responseCardSmoke).toContain("except json.JSONDecodeError:");
    expect(responseCardSmoke).toContain('raise RuntimeError("Live WebSocket sent an invalid JSON text frame.")');
    expect(responseCardSmoke).not.toContain("json.loads(ws.recv())");
  });

  it("creates its session through the actual passkey signup and identity endpoints", () => {
    expect(session).toContain("WebAuthn.addVirtualAuthenticator");
    expect(session).toContain("/api/auth/passkey/register/options");
    expect(session).toContain("/api/auth/passkey/register/verify");
    expect(session).toContain("/api/auth/me");
    expect(session).toContain("moina_session=");
  });

  it("runs both live tests after deployment and revokes the test session", () => {
    expect(deploy).toContain("node scripts/synthetic-passkey-session.mjs");
    expect(deploy).toContain("python scripts/live-grounding-smoke.py");
    expect(deploy).toContain("python scripts/live-memory-voice-smoke.py");
    expect(deploy).toContain("ASKMOINA_SYNTHETIC_COOKIE");
    expect(deploy).toContain("/api/auth/logout");
  });
});
