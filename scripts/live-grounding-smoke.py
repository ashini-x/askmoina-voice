#!/usr/bin/env python3
"""Synthetic production voice test for on-demand Google Search grounding.

The test speaks a current-information query through the public Live API and checks
that the Worker handled the declared search tool and that the assistant completed
a grounded, non-failure answer. It never prints the returned transcript.
"""
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
PROMPT = "Search Google for the latest Android release. Say its version, release date, and one official source."
MAX_WAIT_SECONDS = 55
SETUP_WAIT_SECONDS = 18


def synthesize_pcm_16k() -> bytes:
    with tempfile.NamedTemporaryFile(suffix=".wav") as wav:
        subprocess.run(
            ["espeak-ng", "-v", "en-us", "-s", "125", "-w", wav.name, PROMPT],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        with wave.open(wav.name, "rb") as source:
            channels = source.getnchannels()
            sample_width = source.getsampwidth()
            source_rate = source.getframerate()
            data = source.readframes(source.getnframes())
        if channels != 1 or sample_width != 2:
            raise RuntimeError("Synthetic speech generator returned an unsupported WAV format.")
        sample_count = len(data) // 2
        samples = struct.unpack("<" + "h" * sample_count, data)
        output_count = int(sample_count * 16000 / source_rate)
        output = bytearray(output_count * 2)
        for i in range(output_count):
            position = i * source_rate / 16000
            left = min(int(position), sample_count - 1)
            right = min(left + 1, sample_count - 1)
            fraction = position - left
            value = int(samples[left] * (1 - fraction) + samples[right] * fraction)
            struct.pack_into("<h", output, i * 2, max(-32768, min(32767, value)))
        # Normalize espeak output so browser-independent speech volume does not
        # fall below Live API voice-activity detection. Add a short trailing-silence
        # segment before audio_stream_end to make the synthetic turn boundary explicit.
        resampled = struct.unpack("<" + "h" * output_count, output)
        peak = max((abs(sample) for sample in resampled), default=0)
        gain = min(3.0, 24_000 / max(peak, 1))
        for index, sample in enumerate(resampled):
            struct.pack_into("<h", output, index * 2, max(-32_768, min(32_767, int(sample * gain))))
        return bytes(output) + (b"\x00" * 16_000)


def extract_text(message: dict) -> str:
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


def extract_input_text(message: dict) -> str:
    texts = []
    for key in ("serverContent", "server_content"):
        content = message.get(key)
        if not isinstance(content, dict):
            continue
        for transcript_key in ("inputTranscription", "input_transcription"):
            item = content.get(transcript_key)
            if isinstance(item, dict) and isinstance(item.get("text"), str):
                texts.append(item["text"])
    item = message.get("input_transcription") or message.get("inputTranscription")
    if isinstance(item, dict) and isinstance(item.get("text"), str):
        texts.append(item["text"])
    return " ".join(texts)


def has_grounding_tool_call(message: dict) -> bool:
    for key in ("toolCall", "tool_call"):
        frame = message.get(key)
        if not isinstance(frame, dict):
            continue
        calls = frame.get("functionCalls") or frame.get("function_calls") or []
        if any(isinstance(call, dict) and call.get("name") == "search_current_web" for call in calls):
            return True
    # Some Live protocol variants place functionCalls at the top level.
    calls = message.get("functionCalls") or message.get("function_calls") or []
    return any(isinstance(call, dict) and call.get("name") == "search_current_web" for call in calls)


def main() -> int:
    base_origin = BASE_URL
    ws_url = BASE_URL.replace("https://", "wss://", 1) + "/api/voice/socket"
    if not ws_url.startswith("wss://"):
        raise RuntimeError("BASE_URL must use https://")
    pcm = synthesize_pcm_16k()
    ws = websocket.create_connection(ws_url, origin=base_origin, timeout=12, enable_multithread=True)
    tool_called = False
    transcript = ""
    input_transcript = ""
    turn_complete = False
    try:
        ws.send(json.dumps({"setup": {}}))
        setup_deadline = time.time() + SETUP_WAIT_SECONDS
        while time.time() < setup_deadline:
            try:
                msg = json.loads(ws.recv())
            except websocket.WebSocketTimeoutException:
                continue
            if msg.get("error"):
                raise RuntimeError("Vertex AI rejected the synthetic voice setup.")
            if msg.get("setupComplete") or msg.get("setup_complete"):
                break
        else:
            raise RuntimeError("Timed out waiting for synthetic Live API setup.")

        chunk_bytes = 1600 * 2  # 100 ms at 16 kHz, mono, 16-bit PCM
        for offset in range(0, len(pcm), chunk_bytes):
            chunk = pcm[offset:offset + chunk_bytes]
            ws.send(json.dumps({
                "realtime_input": {
                    "audio": {
                        "data": base64.b64encode(chunk).decode("ascii"),
                        "mime_type": "audio/pcm;rate=16000",
                    }
                }
            }))
            time.sleep(0.1)
        ws.send(json.dumps({"realtime_input": {"audio_stream_end": True}}))

        deadline = time.time() + MAX_WAIT_SECONDS
        while time.time() < deadline:
            try:
                msg = json.loads(ws.recv())
            except websocket.WebSocketTimeoutException:
                continue
            if msg.get("error"):
                raise RuntimeError("The synthetic Live API turn returned an error.")
            tool_called = tool_called or has_grounding_tool_call(msg)
            input_transcript += " " + extract_input_text(msg)
            transcript += " " + extract_text(msg)
            content = msg.get("serverContent") or msg.get("server_content") or {}
            if isinstance(content, dict) and (content.get("turnComplete") or content.get("turn_complete")):
                turn_complete = True
                if tool_called and "android" in transcript.lower():
                    break

        lowered = transcript.lower()
        if "android" not in input_transcript.lower() or "search" not in input_transcript.lower():
            raise RuntimeError("Synthetic speech was not fully recognized by Live API; grounding tool assertion is inconclusive.")
        if not tool_called:
            raise RuntimeError("Live API recognized the synthetic prompt but did not call search_current_web.")
        if not turn_complete:
            raise RuntimeError("Timed out before the synthetic grounded answer completed.")
        if "temporarily unavailable" in lowered or "could not be verified" in lowered or "no live search" in lowered:
            raise RuntimeError("Grounded search returned an unavailable/unverified response.")
        if "android" not in lowered:
            raise RuntimeError("Completed answer did not mention Android as requested.")
        if not any(word in lowered for word in ("source", "official", "developer", "blog", "release")):
            raise RuntimeError("Completed answer did not identify a source or release detail.")
        print("Synthetic live web grounding test: PASS (tool invoked and a current-information answer completed).")
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
        print("Synthetic live web grounding test: FAIL (" + type(exc).__name__ + ": " + str(exc)[:200] + ")")
        raise SystemExit(1)
