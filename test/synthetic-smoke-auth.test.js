import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const grounding = readFileSync(new URL("../scripts/live-grounding-smoke.py", import.meta.url), "utf8");
const memory = readFileSync(new URL("../scripts/live-memory-voice-smoke.py", import.meta.url), "utf8");
const responseCardSmoke = readFileSync(new URL("../scripts/live-response-card-smoke.py", import.meta.url), "utf8");
const workerSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
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

  it("checks grounded completion without requiring one brittle transcript keyword", () => {
    expect(grounding).toContain("if not tool_called:");
    expect(grounding).toContain("if not turn_complete:");
    expect(grounding).toContain("if len(lowered.strip()) < 16:");
    expect(grounding).not.toContain("if not any(word in lowered");
    expect(grounding).not.toContain('if "android" not in lowered:');
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
    expect(responseCardSmoke).toContain('ws.send(json.dumps({"text_input": PROMPT}))');
    expect(responseCardSmoke).not.toContain("def synthesize_pcm_16k() -> bytes:");
    expect(responseCardSmoke).toContain("def send_silence_keepalive(ws) -> None:");
    expect(responseCardSmoke).toContain("time.monotonic() - last_keepalive_at >= 10");
    expect(responseCardSmoke).toContain("if message is None:");
    expect(responseCardSmoke).toContain("send_silence_keepalive(ws)");

    expect(responseCardSmoke).toContain("stage=");
    expect(responseCardSmoke).toContain("def get_input_text(message: dict) -> str:");
    expect(responseCardSmoke).toContain("input_transcription_received=");
    expect(responseCardSmoke).toContain("card_keyword_observed=");
    expect(responseCardSmoke).toContain("steps_keyword_observed=");


    expect(responseCardSmoke).toContain("except json.JSONDecodeError:");
    expect(responseCardSmoke).toContain('raise RuntimeError("Live WebSocket sent an invalid JSON text frame.")');
    expect(responseCardSmoke).not.toContain("json.loads(ws.recv())");
  });

  it("requires the RC2 tool for explicit card requests and keeps cards separate from overlays", () => {
    expect(workerSource).toContain("EXPLICIT CARD REQUEST OVERRIDE");
    expect(workerSource).toContain("Example: 'Make a response card with three steps for organizing pens'");
    expect(workerSource).toContain("RC4 renders validated card data as a full-screen translucent, type-specific answer sheet");

    expect(workerSource).toContain("DISPLAY_RESPONSE_CARD_FUNCTION");
    expect(workerSource).toContain("The client renders validated RC4 response-card payloads as a full-screen translucent, Apple-minimal answer sheet");
    expect(workerSource).toContain("Do not imply that showing a card completes any action.");
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
