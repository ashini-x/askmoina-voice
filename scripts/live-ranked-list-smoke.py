#!/usr/bin/env python3
"""Authenticated synthetic Live Co-Pilot test for a grounded, spoken ranked-list answer.

Sends a top-10 IPL ranking request and verifies that live search returns a source-backed information card plus a useful spoken answer with real generated audio.
"""
import base64
import json
import os
import time

import websocket

BASE_URL = os.environ.get("BASE_URL", "https://askmoina-voice.thenewtongs.workers.dev").rstrip("/")
AUTH_COOKIE = os.environ.get("ASKMOINA_SYNTHETIC_COOKIE", "").strip()
PROMPT = (
    "Can you tell me the top 10 rankers of IPL 2025? By rankers, default to the usual most-runs batting leaderboard unless wickets are clearly implied. "
    "Search the web, include all ten players with teams and runs, then give me a short spoken summary."
)
SETUP_WAIT_SECONDS = 18
GREETING_WAIT_SECONDS = 22
TURN_WAIT_SECONDS = 160
PHASE = "startup"


def get_text(message: dict) -> str:
    texts = []
    for key in ("serverContent", "server_content"):
        content = message.get(key)
        if not isinstance(content, dict):
            continue
        for transcript_key in ("outputTranscription", "output_transcription"):
            item = content.get(transcript_key)
            if isinstance(item, dict) and isinstance(item.get("text"), str):
                texts.append(item["text"])
        for turn_key in ("modelTurn", "model_turn"):
            turn = content.get(turn_key)
            parts = turn.get("parts", []) if isinstance(turn, dict) else []
            for part in parts if isinstance(parts, list) else []:
                if isinstance(part, dict) and isinstance(part.get("text"), str):
                    texts.append(part["text"])
    item = message.get("output_transcription") or message.get("outputTranscription")
    if isinstance(item, dict) and isinstance(item.get("text"), str):
        texts.append(item["text"])
    return " ".join(texts)


def get_audio_payload_bytes(message: dict) -> int:
    """Count actual generated audio payload bytes, not just optional transcript text."""
    total = 0
    for key in ("serverContent", "server_content"):
        content = message.get(key)
        if not isinstance(content, dict):
            continue
        turn = content.get("modelTurn") or content.get("model_turn")
        parts = turn.get("parts", []) if isinstance(turn, dict) else []
        for part in parts if isinstance(parts, list) else []:
            if not isinstance(part, dict):
                continue
            inline = part.get("inlineData") or part.get("inline_data")
            if not isinstance(inline, dict):
                continue
            data = inline.get("data")
            mime_type = str(inline.get("mimeType") or inline.get("mime_type") or "").lower()
            if isinstance(data, str) and data and mime_type.startswith("audio/"):
                try:
                    total += len(base64.b64decode(data, validate=True))
                except (ValueError, base64.binascii.Error):
                    # Malformed audio payload must not count as proof of speech.
                    continue
    return total


def get_calls(message: dict) -> list:
    frame = message.get("toolCall") or message.get("tool_call")
    if not isinstance(frame, dict):
        return []
    calls = frame.get("functionCalls") or frame.get("function_calls") or []
    return calls if isinstance(calls, list) else []


def recv_json_message(ws):
    """Read a JSON text frame, ignoring non-JSON binary media frames.

    Gemini Live may send binary media frames between structured tool/control
    messages. Tool calls and acknowledgements are JSON text, so only binary
    frames that cannot be parsed as JSON are skipped; malformed text frames
    remain a hard failure so the smoke test does not hide protocol regressions.
    """
    frame = ws.recv()
    if frame == "":
        return None
    if isinstance(frame, bytes):
        try:
            frame_text = frame.decode("utf-8")
        except UnicodeDecodeError:
            return None
        try:
            message = json.loads(frame_text)
        except json.JSONDecodeError:
            return None
    else:
        try:
            message = json.loads(frame)
        except json.JSONDecodeError:
            raise RuntimeError("Live WebSocket sent an invalid JSON text frame.") from None
    if not isinstance(message, dict):
        raise RuntimeError("Live WebSocket JSON message was not an object.")
    return message


def get_input_text(message: dict) -> str:
    texts = []
    for key in ("serverContent", "server_content"):
        content = message.get(key)
        if not isinstance(content, dict):
            continue
        for transcript_key in ("inputTranscription", "input_transcription"):
            item = content.get(transcript_key)
            if isinstance(item, dict) and isinstance(item.get("text"), str):
                texts.append(item["text"])
    for key in ("input_transcription", "inputTranscription"):
        item = message.get(key)
        if isinstance(item, dict) and isinstance(item.get("text"), str):
            texts.append(item["text"])
    return " ".join(texts)


def is_turn_complete(message: dict) -> bool:
    content = message.get("serverContent") or message.get("server_content") or {}
    return isinstance(content, dict) and bool(content.get("turnComplete") or content.get("turn_complete"))


def bounded_card(args: object) -> bool:
    if not isinstance(args, dict) or len(json.dumps(args, ensure_ascii=False)) > 8000:
        return False
    if args.get("type") not in ("steps", "key_details", "comparison"):
        return False
    if not isinstance(args.get("title"), str) or not (1 <= len(args["title"].strip()) <= 80):
        return False
    kind = args["type"]
    if kind == "steps":
        items = args.get("steps")
        return (
            set(args).issubset({"type", "title", "summary", "steps"})
            and isinstance(items, list) and 2 <= len(items) <= 5
            and all(isinstance(item, dict) and set(item) == {"label", "instruction"}
                    and isinstance(item["label"], str) and 1 <= len(item["label"].strip()) <= 60
                    and isinstance(item["instruction"], str) and 1 <= len(item["instruction"].strip()) <= 180
                    for item in items)
        )
    if kind == "key_details":
        items = args.get("details")
        return (
            set(args).issubset({"type", "title", "summary", "details", "sources"})
            and isinstance(items, list) and 1 <= len(items) <= 10
            and all(isinstance(item, dict) and set(item).issubset({"label", "value", "unit"})
                    and {"label", "value"}.issubset(item)
                    and isinstance(item["label"], str) and 1 <= len(item["label"].strip()) <= 60
                    and isinstance(item["value"], str) and 1 <= len(item["value"].strip()) <= 180
                    and ("unit" not in item or isinstance(item["unit"], str) and len(item["unit"]) <= 32)
                    for item in items)
            # Optional source metadata is sanitized by the browser; the list contract is independent of it.
        )
    options = args.get("options")
    if not (set(args).issubset({"type", "title", "summary", "options", "takeaway"})
            and isinstance(options, list) and 2 <= len(options) <= 4):
        return False
    for option in options:
        if not isinstance(option, dict) or set(option) != {"name", "attributes"}:
            return False
        if not isinstance(option["name"], str) or not (1 <= len(option["name"].strip()) <= 70):
            return False
        attrs = option["attributes"]
        if not isinstance(attrs, list) or not (1 <= len(attrs) <= 8):
            return False
        for item in attrs:
            if not isinstance(item, dict) or set(item) != {"label", "value"}:
                return False
            if not isinstance(item["label"], str) or not (1 <= len(item["label"].strip()) <= 50):
                return False
            if not isinstance(item["value"], str) or not (1 <= len(item["value"].strip()) <= 120):
                return False
    return True


def send_relay_keepalive(ws) -> None:
    """Keep the relay alive without injecting fake microphone PCM."""
    ws.send(json.dumps({"keepalive": True}))



def main() -> int:
    global PHASE
    if not BASE_URL.startswith("https://") or not AUTH_COOKIE.startswith("moina_session="):
        raise RuntimeError("HTTPS base URL and authenticated synthetic session are required.")
    PHASE = "connect_websocket"
    ws = websocket.create_connection(
        BASE_URL.replace("https://", "wss://", 1) + "/api/voice/socket",
        origin=BASE_URL, timeout=12, enable_multithread=True, cookie=AUTH_COOKIE,
    )
    try:
        PHASE = "setup_live_copilot"
        ws.send(json.dumps({"setup": {}, "copilot_mode": True}))
        deadline = time.time() + SETUP_WAIT_SECONDS
        while time.time() < deadline:
            try:
                message = recv_json_message(ws)
                if message is None:
                    continue
            except websocket.WebSocketTimeoutException:
                continue
            if message.get("error"):
                raise RuntimeError("Vertex AI rejected the Co-Pilot setup.")
            if message.get("setupComplete") or message.get("setup_complete"):
                break
        else:
            raise RuntimeError("Timed out waiting for Co-Pilot setup completion.")

        PHASE = "wait_for_initial_greeting"
        ws.send(json.dumps({"initial_greeting": True}))
        deadline = time.time() + GREETING_WAIT_SECONDS
        while time.time() < deadline:
            try:
                message = recv_json_message(ws)
                if message is None:
                    continue
            except websocket.WebSocketTimeoutException:
                continue
            if message.get("error"):
                raise RuntimeError("The Live Co-Pilot greeting turn failed.")
            if is_turn_complete(message) and not get_calls(message):
                break
        else:
            raise RuntimeError("Timed out waiting for the Co-Pilot greeting turn.")

        PHASE = "send_spoken_ranked_list_turn"
        ws.send(json.dumps({"text_input": PROMPT}))
        PHASE = "wait_for_grounded_spoken_answer"
        last_keepalive_at = time.monotonic()
        grounded_search_count = 0
        lookup_completed = False
        transcript_parts = []
        card_seen = False
        post_lookup_audio_bytes = 0
        final_complete = False
        deadline = time.time() + TURN_WAIT_SECONDS
        while time.time() < deadline:
            try:
                message = recv_json_message(ws)
                if message is None:
                    if time.monotonic() - last_keepalive_at >= 10:
                        send_relay_keepalive(ws)
                        last_keepalive_at = time.monotonic()
                    continue
            except websocket.WebSocketTimeoutException:
                if time.monotonic() - last_keepalive_at >= 10:
                    send_relay_keepalive(ws)
                    last_keepalive_at = time.monotonic()
                continue
            if message.get("error"):
                raise RuntimeError("The Live Co-Pilot returned a provider/protocol error.")
            status = message.get("live_search_status")
            if isinstance(status, dict) and status.get("state") == "lookup_complete":
                lookup_completed = True
            card_payload = message.get("grounded_response_card")
            if isinstance(card_payload, dict):
                details = card_payload.get("details")
                sources = card_payload.get("sources")
                if card_payload.get("type") != "key_details" or not isinstance(card_payload.get("title"), str):
                    raise RuntimeError("Grounded result card has an invalid type or title.")
                if not isinstance(details, list) or len(details) < 2:
                    raise RuntimeError("Grounded result card did not include structured ranked entries.")
                if not isinstance(sources, list) or not any(isinstance(source, dict) and isinstance(source.get("url"), str) and source["url"].startswith("https://") for source in sources):
                    raise RuntimeError("Grounded result card did not include a verified HTTPS source.")
                card_seen = True
            calls = get_calls(message)
            if any(isinstance(call, dict) and call.get("name") == "search_current_web" for call in calls):
                grounded_search_count += 1
            for call in calls:
                if isinstance(call, dict) and call.get("name") == "display_response_card":
                    args = call.get("args") or call.get("arguments")
                    if not isinstance(args, dict) or not isinstance(args.get("title"), str):
                        raise RuntimeError("Response-card tool call did not include a structured card payload.")
                    card_seen = True
                    ws.send(json.dumps({"tool_response": {"function_responses": [{"id": call.get("id"), "name": "display_response_card", "response": {"result": "The information card was rendered successfully by the synthetic client."}}]}}))
            spoken_text = get_text(message).strip()
            audio_bytes = get_audio_payload_bytes(message)
            if lookup_completed:
                if spoken_text and not calls:
                    transcript_parts.append(spoken_text)
                if not calls:
                    post_lookup_audio_bytes += audio_bytes
            turn_complete_now = is_turn_complete(message)
            if lookup_completed and turn_complete_now and not calls and card_seen:
                spoken_answer = " ".join(transcript_parts).strip()
                digit_count = sum(1 for char in spoken_answer if char.isdigit())
                if post_lookup_audio_bytes > 0 and len(spoken_answer) >= 160 and digit_count >= 4:
                    final_complete = True
                    break
            if not turn_complete_now and time.monotonic() - last_keepalive_at >= 10:
                send_relay_keepalive(ws)
                last_keepalive_at = time.monotonic()
        spoken_answer = " ".join(transcript_parts).strip()
        if grounded_search_count == 0:
            raise RuntimeError("The Co-Pilot did not invoke live web grounding for the IPL ranking request.")
        if not lookup_completed:
            raise RuntimeError("The Co-Pilot did not report that the web lookup completed.")
        if not card_seen:
            raise RuntimeError("The live search did not produce a structured information card with verified source links.")
        if not final_complete:
            raise RuntimeError(
                "Timed out waiting for a useful spoken ranked-list answer; "
                f"transcript_chars={len(spoken_answer)}, audio_bytes={post_lookup_audio_bytes}."
            )
        PHASE = "verified"
        print(
            "Synthetic grounded ranked-list voice test: PASS "
            f"(live grounding observed; spoken answer {len(spoken_answer)} transcript characters; "
            f"{post_lookup_audio_bytes} generated audio bytes; structured information card verified)."
        )
        return 0
    finally:
        try:
            ws.close()
        except Exception:
            pass


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print("Synthetic grounded ranked-list voice test: FAIL (stage=" + PHASE + ", " + type(exc).__name__ + ": " + str(exc)[:160] + ")")
        raise SystemExit(1)
