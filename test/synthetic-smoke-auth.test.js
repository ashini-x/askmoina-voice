import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const grounding = readFileSync(new URL("../scripts/live-grounding-smoke.py", import.meta.url), "utf8");
const memory = readFileSync(new URL("../scripts/live-memory-voice-smoke.py", import.meta.url), "utf8");
const spokenTurnSmoke = readFileSync(new URL("../scripts/live-spoken-turn-smoke.py", import.meta.url), "utf8");
const rankedList = readFileSync(new URL("../scripts/live-ranked-list-smoke.py", import.meta.url), "utf8");
const copilot = readFileSync(new URL("../public/copilot.js", import.meta.url), "utf8");
const copilotHtml = readFileSync(new URL("../public/copilot.html", import.meta.url), "utf8");
const protocol = readFileSync(new URL("../src/sessions/copilot-protocol.ts", import.meta.url), "utf8");
const workerSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const session = readFileSync(new URL("../scripts/synthetic-passkey-session.mjs", import.meta.url), "utf8");
const deploy = readFileSync(new URL("../.github/workflows/deploy-candidate-a-live-voice.yml", import.meta.url), "utf8");

describe("authenticated live synthetic verification", () => {
  it("requires a signed-in synthetic session for live voice checks", () => {
    for (const source of [grounding, memory, spokenTurnSmoke, rankedList]) {
      expect(source).toContain("ASKMOINA_SYNTHETIC_COOKIE");
      expect(source).toContain("AUTH_COOKIE");
      expect(source).toContain("cookie=AUTH_COOKIE");
    }
  });

  it("handles Gemini Live text and binary media frames without masking invalid text frames", () => {
    expect(spokenTurnSmoke).toContain("def recv_json_message(ws):");
    expect(spokenTurnSmoke).toContain("if isinstance(frame, bytes):");
    expect(spokenTurnSmoke).toContain('ws.send(json.dumps({"text_input": PROMPT}))');
    expect(spokenTurnSmoke).toContain("def send_relay_keepalive(ws) -> None:");
    expect(spokenTurnSmoke).toContain('json.dumps({"keepalive": True})');
    expect(spokenTurnSmoke).toContain("if message is None:");
    expect(spokenTurnSmoke).toContain('raise RuntimeError("Live WebSocket sent an invalid JSON text frame.")');
    expect(spokenTurnSmoke).toContain("get_audio_payload_bytes(message)");
    expect(spokenTurnSmoke).toContain("total_audio_bytes > 0 and not calls");
    expect(protocol).toContain("value.keepalive === true");
    expect(protocol).toContain('{ kind: "keepalive" }');
  });

  it("keeps the loader search-specific and hides the live transcript dock", () => {
    expect(copilot).toContain("liveSearchStatus.hidden = !workActive || Boolean(micSpeechGateActive)");
    expect(copilot).toContain("LIVE_SEARCH_PROGRESS_SPEECH.test(normalized)");
    expect(copilot).toContain('call.name === "search_current_web"');
    expect(copilot).not.toContain("if (!responseCardRenderedForTurn) ensureTranscriptFallbackCard(true);");
    expect(copilotHtml).toContain('<section class="caption-dock" hidden');
    expect(copilotHtml).toContain('id="responseCardTray"');
    expect(copilotHtml).toContain('id="responseCardRestore"');
    expect(copilotHtml).not.toContain('id="vaultButton" href="/vault"');
  });

  it("validates grounded ranked answers as source-backed information cards and speech", () => {
    expect(workerSource).toContain("function startForcedRankedListLookup(userRequest: string)");
    expect(workerSource).toContain("Mandatory ranked-list grounding started");
    expect(workerSource).toContain("const answerInstruction = fullTableVerified");
    expect(workerSource).toContain("grounded_response_card: builtCard");
    expect(rankedList).toContain("structured information card with verified source links");
    expect(rankedList).toContain("grounded_response_card");
    expect(rankedList).toContain("get_audio_payload_bytes(message)");
    expect(rankedList).toContain("post_lookup_audio_bytes > 0");
  });

  it("exposes account-scoped past-session retrieval and structured information cards", () => {
    expect(workerSource).toContain('name: "search_past_conversations"');
    expect(workerSource).toContain("searchPriorConversationHistory(env, ownerId, query)");
    expect(workerSource).toContain("SPEECH-FIRST INTERACTION WITH INFORMATION CARDS");
    expect(workerSource).toContain("DISPLAY_RESPONSE_CARD_FUNCTION");
    expect(workerSource).not.toContain("Response cards are disabled in this Co-Pilot");
    expect(workerSource).not.toContain("EXPLICIT CARD REQUEST OVERRIDE");
  });

  it("creates its test session through passkey signup and runs speech-first verification after deployment", () => {
    expect(session).toContain("WebAuthn.addVirtualAuthenticator");
    expect(session).toContain("/api/auth/passkey/register/options");
    expect(session).toContain("/api/auth/passkey/register/verify");
    expect(session).toContain("/api/auth/me");
    expect(session).toContain("moina_session=");
    expect(deploy).toContain("node scripts/synthetic-passkey-session.mjs");
    expect(deploy).toContain("python scripts/live-grounding-smoke.py");
    expect(deploy).toContain("python scripts/live-spoken-turn-smoke.py");
    expect(deploy).toContain("python scripts/live-memory-voice-smoke.py");
    expect(deploy).toContain("/api/auth/logout");
    expect(deploy).toContain('test "$status" = "404"');
  });
});
