#!/usr/bin/env python3
"""Production voice-session memory smoke test with synthetic selected context.

The test uses the deterministic text-input path in a real authenticated voice
session so speech recognition does not confound the memory-context assertion.
It prints only pass/fail status, never the returned transcript.
"""
import json
import os
import time

import websocket

BASE_URL = os.environ.get("BASE_URL", "https://askmoina-voice.thenewtongs.workers.dev").rstrip("/")
AUTH_COOKIE = os.environ.get("ASKMOINA_SYNTHETIC_COOKIE", "").strip()
PROMPT = "Use my preferred name from the selected personal context to greet me."
MEMORY = "My preferred name is Mira."
MAX_WAIT_SECONDS = 35


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


def recv_json_message(ws):
    """Read JSON control frames and safely skip unrelated binary media frames."""
    frame = ws.recv()
    if frame in ("", None):
        return None
    was_binary = isinstance(frame, bytes)
    if was_binary:
        try:
            frame = frame.decode("utf-8")
        except UnicodeDecodeError:
            return None
    try:
        message = json.loads(frame)
    except (TypeError, json.JSONDecodeError):
        if was_binary:
            return None
        raise RuntimeError("Live WebSocket sent an invalid JSON text frame.") from None
    if not isinstance(message, dict):
        raise RuntimeError("Live WebSocket JSON message was not an object.")
    return message


def send_relay_keepalive(ws) -> None:
    """Keep the Worker relay alive while the assistant completes its spoken turn."""
    ws.send(json.dumps({"keepalive": True}))


def main() -> int:
    base_origin = BASE_URL
    ws_url = BASE_URL.replace("https://", "wss://", 1) + "/api/voice/socket"
    if ws_url == BASE_URL + "/api/voice/socket":
        raise RuntimeError("BASE_URL must use https://")
    if not AUTH_COOKIE.startswith("moina_session="):
        raise RuntimeError("Authenticated synthetic session missing; refusing anonymous voice access.")
    ws = websocket.create_connection(ws_url, origin=base_origin, timeout=12, enable_multithread=True, cookie=AUTH_COOKIE)
    try:
        ws.settimeout(0.5)
        ws.send(json.dumps({"setup": {}, "memory_context": MEMORY}))
        setup_deadline = time.time() + 18
        while time.time() < setup_deadline:
            try:
                msg = recv_json_message(ws)
                if msg is None:
                    continue
            except websocket.WebSocketTimeoutException:
                continue
            if msg.get("error"):
                raise RuntimeError("Vertex AI rejected the voice setup.")
            if msg.get("setupComplete") or msg.get("setup_complete"):
                break
        else:
            raise RuntimeError("Timed out waiting for Vertex AI setup completion.")

        # Use the deterministic text-input path inside the authenticated Live voice
        # session. The memory assertion is about setup context reaching the model,
        # not speech recognition; the separate spoken-turn synthetic covers audio input.
        ws.send(json.dumps({"text_input": PROMPT}))

        transcript = ""
        interaction_idle = False
        last_interaction_status = None
        deadline = time.monotonic() + MAX_WAIT_SECONDS
        last_keepalive_at = time.monotonic()
        while time.monotonic() < deadline:
            try:
                msg = recv_json_message(ws)
                if msg is None:
                    if time.monotonic() - last_keepalive_at >= 10:
                        send_relay_keepalive(ws)
                        last_keepalive_at = time.monotonic()
                    continue
            except websocket.WebSocketTimeoutException:
                if time.monotonic() - last_keepalive_at >= 10:
                    send_relay_keepalive(ws)
                    last_keepalive_at = time.monotonic()
                continue
            if time.monotonic() - last_keepalive_at >= 10:
                send_relay_keepalive(ws)
                last_keepalive_at = time.monotonic()
            if msg.get("error"):
                raise RuntimeError("The live voice session returned an error.")
            transcript += " " + get_text(msg)
            content = msg.get("serverContent") or msg.get("server_content") or {}
            if isinstance(content, dict):
                last_interaction_status = content.get("interactionStatus") or content.get("interaction_status")
                turn_complete = content.get("turnComplete") or content.get("turn_complete")
                if turn_complete and str(last_interaction_status).upper() == "IDLE":
                    interaction_idle = True
                    break
        if not interaction_idle:
            raise RuntimeError(
                "Timed out waiting for Live interaction IDLE (status=" +
                str(last_interaction_status) + ")."
            )
        if "mira" in transcript.lower():
            print("Synthetic live voice memory test: PASS (reply transcript used the selected name).")
            return 0
        raise RuntimeError("The live reply transcript did not contain the selected memory name.")
    finally:
        try:
            ws.close()
        except Exception:
            pass


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        # Avoid dumping raw model transcripts, HTTP payloads, or credentials into CI logs.
        print("Synthetic live voice memory test: FAIL (" + type(exc).__name__ + ": " + str(exc)[:180] + ")")
        raise SystemExit(1)
