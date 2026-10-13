#!/usr/bin/env python3
"""Authenticated synthetic Live Co-Pilot test for the RC2 response-card tool."""
import base64
import json
import os
import struct
import subprocess
import tempfile
import time
import wave

import websocket

BASE_URL = os.environ.get("BASE_URL", "https://askmoina-voice.thenewtongs.workers.dev").rstrip("/")
AUTH_COOKIE = os.environ.get("ASKMOINA_SYNTHETIC_COOKIE", "").strip()
PROMPT = (
    "Please make a response card with three steps for organizing pens. "
    "Then tell me step one out loud."
)
SETUP_WAIT_SECONDS = 18
GREETING_WAIT_SECONDS = 22
TURN_WAIT_SECONDS = 65
PHASE = "startup"


def synthesize_pcm_16k() -> bytes:
    with tempfile.NamedTemporaryFile(suffix=".wav") as wav_file:
        subprocess.run(
            ["espeak-ng", "-v", "en-us", "-s", "115", "-w", wav_file.name, PROMPT],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        with wave.open(wav_file.name, "rb") as source:
            channels, sample_width, source_rate = source.getnchannels(), source.getsampwidth(), source.getframerate()
            data = source.readframes(source.getnframes())
    if channels != 1 or sample_width != 2 or source_rate <= 0:
        raise RuntimeError("Synthetic speech generator returned an unsupported WAV format.")
    sample_count = len(data) // 2
    samples = struct.unpack("<" + "h" * sample_count, data)
    output_count = int(sample_count * 16000 / source_rate)
    output = bytearray(output_count * 2)
    for index in range(output_count):
        position = index * source_rate / 16000
        left = min(int(position), sample_count - 1)
        right = min(left + 1, sample_count - 1)
        fraction = position - left
        value = int(samples[left] * (1 - fraction) + samples[right] * fraction)
        struct.pack_into("<h", output, index * 2, max(-32768, min(32767, value)))
    return bytes(output)


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
            set(args).issubset({"type", "title", "summary", "details"})
            and isinstance(items, list) and 1 <= len(items) <= 8
            and all(isinstance(item, dict) and set(item).issubset({"label", "value", "unit"})
                    and {"label", "value"}.issubset(item)
                    and isinstance(item["label"], str) and 1 <= len(item["label"].strip()) <= 60
                    and isinstance(item["value"], str) and 1 <= len(item["value"].strip()) <= 180
                    and ("unit" not in item or isinstance(item["unit"], str) and len(item["unit"]) <= 32)
                    for item in items)
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


def send_speech(ws, pcm: bytes) -> None:
    chunk_bytes = 1600 * 2  # 100 ms of mono PCM16 at 16 kHz
    for offset in range(0, len(pcm), chunk_bytes):
        chunk = pcm[offset:offset + chunk_bytes]
        ws.send(json.dumps({
            "realtime_input": {"audio": {
                "data": base64.b64encode(chunk).decode("ascii"),
                "mime_type": "audio/pcm;rate=16000",
            }}
        }))
        # Pace frames to their real duration instead of sending faster than real time.
        time.sleep(len(chunk) / 32_000)
    ws.send(json.dumps({"realtime_input": {"audio_stream_end": True}}))


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
    PHASE = "synthesize_prompt"
    pcm = synthesize_pcm_16k()
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

        PHASE = "send_synthetic_prompt_audio"
        send_speech(ws, pcm)
        PHASE = "wait_for_response_card_tool"
        last_keepalive_at = time.monotonic()
        tool_count = 0
        final_complete = False
        saw_final_text = False
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
                if name not in ("display_response_card", "display_screen_overlay") or not isinstance(call_id, str) or not call_id:
                    continue
                supported_tool_call = True
                if name == "display_response_card":
                    card_call_in_frame = True
                    if not bounded_card(call.get("args")):
                        raise RuntimeError("Live response-card call failed the bounded schema assertion.")
                    tool_count += 1
                    result = (
                        "The RC2 response-card payload passed schema validation. The card tray is not part "
                        "of RC2 yet; continue with concise spoken guidance and do not say that a card is visible."
                    )
                else:
                    result = "Synthetic overlay acknowledgement; no physical action was taken."
                responses.append({"id": call_id, "name": name, "response": {"result": result}})
            if responses:
                ws.send(json.dumps({"tool_response": {"function_responses": responses}}))
                last_keepalive_at = time.monotonic()
            if get_text(message):
                saw_final_text = True
            turn_complete_now = is_turn_complete(message)
            # The real browser keeps sending microphone frames. Match that behavior
            # while waiting for Live instead of letting the relay idle watchdog expire.
            if not turn_complete_now and time.monotonic() - last_keepalive_at >= 10:
                send_silence_keepalive(ws)
                last_keepalive_at = time.monotonic()
            if turn_complete_now and tool_count > 0 and not supported_tool_call:
                final_complete = True
                if saw_final_text:
                    break
        if tool_count == 0:
            raise RuntimeError(
                "The live model did not call display_response_card "
                "(input_transcription_received=" + str(input_transcription_received).lower()
                + ", card_keyword_observed=" + str(card_keyword_observed).lower()
                + ", steps_keyword_observed=" + str(steps_keyword_observed).lower() + ")."
            )
        if not final_complete:
            raise RuntimeError("Timed out waiting for the post-tool spoken answer to complete.")
        PHASE = "verified"
        print("Synthetic live response-card test: PASS (tool called, payload bounded, protocol acknowledged, final turn completed).")
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
