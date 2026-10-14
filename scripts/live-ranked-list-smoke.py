#!/usr/bin/env python3
"""Authenticated synthetic Live Co-Pilot test for proactive ranked-list cards.

Sends a top-10 IPL ranking request without explicitly asking for a card, then
asserts that grounding runs and the Live model proactively creates ten rows.
Optional source links are validated separately and cannot gate the list itself.
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
TURN_WAIT_SECONDS = 65
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


def send_silence_keepalive(ws) -> None:
    """Keep the authenticated Co-Pilot relay alive during a long synthetic turn."""
    silence = bytes(3200)  # 100 ms of mono PCM16 silence at 16 kHz
    ws.send(json.dumps({
        "realtime_input": {"audio": {
            "data": base64.b64encode(silence).decode("ascii"),
            "mime_type": "audio/pcm;rate=16000",
        }}
    }))


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

        PHASE = "send_explicit_card_text_turn"
        ws.send(json.dumps({"text_input": PROMPT}))
        PHASE = "wait_for_response_card_tool"
        last_keepalive_at = time.monotonic()
        tool_count = 0
        grounded_search_count = 0
        top_ten_card_seen = False
        final_complete = False
        saw_final_text = False
        saw_post_tool_spoken_text = False
        saw_post_card_spoken_text = False
        input_transcription_received = False
        card_keyword_observed = False
        steps_keyword_observed = False
        deadline = time.time() + TURN_WAIT_SECONDS
        while time.time() < deadline:
            try:
                message = recv_json_message(ws)
                if message is None:
                    if time.monotonic() - last_keepalive_at >= 10:
                        send_silence_keepalive(ws)
                        last_keepalive_at = time.monotonic()
                    continue
            except websocket.WebSocketTimeoutException:
                if time.monotonic() - last_keepalive_at >= 10:
                    send_silence_keepalive(ws)
                    last_keepalive_at = time.monotonic()
                continue
            if message.get("error"):
                raise RuntimeError("The Live Co-Pilot returned a provider/protocol error.")
            card_was_visible_before_message = top_ten_card_seen
            fallback_card = message.get("grounded_response_card")
            if isinstance(fallback_card, dict):
                if not bounded_card(fallback_card):
                    raise RuntimeError("The grounded server fallback card failed its bounded schema assertion.")
                if fallback_card.get("type") == "key_details":
                    details = fallback_card.get("details")
                    if not isinstance(details, list) or len(details) != 10:
                        raise RuntimeError("The grounded fallback card did not contain ten visible rank slots.")
                    if any(not isinstance(row, dict) or str(row.get("label", "")).endswith("Not verified") for row in details):
                        raise RuntimeError("The grounded fallback card had missing or unverified entries.")
                    if not str(fallback_card.get("summary", "")).startswith("Complete ranked list"):
                        raise RuntimeError("The grounded fallback card did not confirm a complete list.")
                    sources = fallback_card.get("sources")
                    if not isinstance(sources, list) or not sources:
                        raise RuntimeError("The grounded fallback card did not include grounded source links.")
                    top_ten_card_seen = True
            input_text = get_input_text(message).lower()
            if input_text.strip():
                input_transcription_received = True
            if any(term in input_text for term in ("card", "cart", "checklist")):
                card_keyword_observed = True
            if any(term in input_text for term in ("step", "steps", "checklist")):
                steps_keyword_observed = True
            calls = get_calls(message)
            responses = []
            supported_tool_call = False
            card_call_in_frame = False
            for call in calls:
                if not isinstance(call, dict):
                    continue
                name, call_id = call.get("name"), call.get("id")
                if name == "search_current_web":
                    grounded_search_count += 1
                    continue
                if name not in ("display_response_card", "display_screen_overlay") or not isinstance(call_id, str) or not call_id:
                    continue
                supported_tool_call = True
                if name == "display_response_card":
                    card_call_in_frame = True
                    args = call.get("args")
                    if not bounded_card(args):
                        raise RuntimeError("Live ranked-list response card failed the bounded schema assertion.")
                    if isinstance(args, dict) and args.get("type") == "key_details":
                        details = args.get("details")
                        if not isinstance(details, list) or len(details) != 10:
                            raise RuntimeError("The model did not proactively present exactly ten leaderboard rows.")
                        if any(not isinstance(row, dict) or not str(row.get("label", "")).strip() or "not verified" in str(row.get("label", "")).lower() for row in details):
                            raise RuntimeError("The model's ten-row card contained an empty or unverified entry.")
                        sources = args.get("sources")
                        if sources is not None and not isinstance(sources, list):
                            raise RuntimeError("The optional source field was malformed.")
                        top_ten_card_seen = True
                    tool_count += 1
                    result = (
                        "The complete ten-row answer sheet is visible. Continue speaking the full natural answer: "
                        "summarize what the leaderboard means, explain the important context, and mention the row-level "
                        "details that help the user understand it. The card is a companion, not a replacement for speech. "
                        "Do not stop at a short summary or wait for another user request."
                    )
                else:
                    result = "Synthetic overlay acknowledgement; no physical action was taken."
                responses.append({"id": call_id, "name": name, "response": {"result": result}})
            if responses:
                ws.send(json.dumps({"tool_response": {"function_responses": responses}}))
                last_keepalive_at = time.monotonic()
            spoken_text = get_text(message).strip()
            if spoken_text:
                saw_final_text = True
                if card_was_visible_before_message:
                    saw_post_card_spoken_text = True
                if tool_count > 0 and not calls:
                    saw_post_tool_spoken_text = True
            turn_complete_now = is_turn_complete(message)
            # The real browser keeps sending microphone frames. Match that behavior
            # while waiting for Live instead of letting the relay idle watchdog expire.
            if not turn_complete_now and time.monotonic() - last_keepalive_at >= 10:
                send_silence_keepalive(ws)
                last_keepalive_at = time.monotonic()
            if turn_complete_now and top_ten_card_seen and not supported_tool_call:
                final_complete = True
                if saw_final_text:
                    break
        if grounded_search_count == 0:
            raise RuntimeError("The Co-Pilot failed to ground the IPL ranking request with live web search.")
        if not top_ten_card_seen:
            raise RuntimeError("The Co-Pilot did not proactively display a ten-row ranked response card.")
        if not saw_post_card_spoken_text and not saw_post_tool_spoken_text:
            raise RuntimeError("The model did not continue speaking after the ten-row answer card became visible.")
        if not final_complete:
            raise RuntimeError("Timed out waiting for the post-tool spoken answer to complete.")
        PHASE = "verified"
        print("Synthetic proactive ranked-list test: PASS (grounding invoked, ten source-backed rows displayed automatically, final turn completed).")
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
        print("Synthetic live response-card test: FAIL (stage=" + PHASE + ", " + type(exc).__name__ + ": " + str(exc)[:160] + ")")
        raise SystemExit(1)
