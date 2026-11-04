#!/usr/bin/env python3
"""Authenticated Live voice memory smoke test.

Supplies synthetic personal context through the private setup field, submits a
text turn to avoid conflating speech-recognition variability with memory use,
and verifies that the assistant both says the selected name and produces audio.
The test prints only pass/fail status, never the returned transcript.
"""
import json
import os
import time

import websocket

BASE_URL = os.environ.get("BASE_URL", "https://askmoina-voice.thenewtongs.workers.dev").rstrip("/")
AUTH_COOKIE = os.environ.get("ASKMOINA_SYNTHETIC_COOKIE", "").strip()
PROMPT = "What preferred name do you have for me?"
MEMORY = "Preferred name: Mira. The user's preferred name is Mira. Address the user as Mira. When asked what name to use, answer Mira."
MAX_WAIT_SECONDS = 45


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
    import base64
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
            mime = str(inline.get("mimeType") or inline.get("mime_type") or "").lower()
            if isinstance(data, str) and data and mime.startswith("audio/"):
                try:
                    total += len(base64.b64decode(data, validate=True))
                except (ValueError, base64.binascii.Error):
                    continue
    return total


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


def main() -> int:
    if not BASE_URL.startswith("https://"):
        raise RuntimeError("HTTPS base URL is required.")
    if not AUTH_COOKIE.startswith("moina_session="):
        raise RuntimeError("Authenticated synthetic session missing; refusing anonymous voice access.")

    ws_url = BASE_URL.replace("https://", "wss://", 1) + "/api/voice/socket"
    ws = websocket.create_connection(ws_url, origin=BASE_URL, timeout=12, enable_multithread=True, cookie=AUTH_COOKIE)
    try:
        ws.settimeout(0.5)
        ws.send(json.dumps({"setup": {}, "memory_context": MEMORY}))
        setup_deadline = time.monotonic() + 18
        while time.monotonic() < setup_deadline:
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

        # Use a text user turn so this test measures saved-context personalization,
        # not microphone synthesis or automatic VAD. The expected assistant response
        # must still contain generated spoken audio.
        ws.send(json.dumps({"text_input": PROMPT}))

        transcript = ""
        total_audio_bytes = 0
        turn_complete = False
        deadline = time.monotonic() + MAX_WAIT_SECONDS
        last_keepalive_at = time.monotonic()
        while time.monotonic() < deadline:
            try:
                msg = recv_json_message(ws)
                if msg is None:
                    if time.monotonic() - last_keepalive_at >= 10:
                        ws.send(json.dumps({"keepalive": True}))
                        last_keepalive_at = time.monotonic()
                    continue
            except websocket.WebSocketTimeoutException:
                if time.monotonic() - last_keepalive_at >= 10:
                    ws.send(json.dumps({"keepalive": True}))
                    last_keepalive_at = time.monotonic()
                continue
            if msg.get("error"):
                raise RuntimeError("The live voice session returned an error.")
            transcript += " " + get_text(msg)
            total_audio_bytes += get_audio_payload_bytes(msg)
            content = msg.get("serverContent") or msg.get("server_content") or {}
            if isinstance(content, dict) and (content.get("turnComplete") or content.get("turn_complete")):
                turn_complete = True
                break

        if not turn_complete:
            raise RuntimeError("Timed out waiting for a completed spoken reply.")
        if "mira" not in transcript.lower():
            raise RuntimeError("The spoken reply did not use the selected preferred name.")
        if total_audio_bytes <= 0:
            raise RuntimeError("The personalized reply completed without generated audio.")
        print("Synthetic live voice memory test: PASS (spoken response used the selected preferred name and generated " + str(total_audio_bytes) + " audio bytes).")
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
        print("Synthetic live voice memory test: FAIL (" + type(exc).__name__ + ": " + str(exc)[:180] + ")")
        raise SystemExit(1)
