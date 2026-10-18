#!/usr/bin/env python3
"""Production synthetic turn-latency benchmark.

Uses locally synthesized, non-user speech and records timings only. It never
stores or prints input audio, model audio, transcripts, prompts, or credentials.
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
AUTH_COOKIE = os.environ.get("ASKMOINA_SYNTHETIC_COOKIE", "").strip()
SETUP_TIMEOUT_SECONDS = 18
TURN_TIMEOUT_SECONDS = 24
TURN_COUNT = 20
CHUNK_BYTES = 1280  # 40 ms of 16 kHz mono PCM16
PROMPTS = [
    "What is two plus two? Please answer in one short sentence.",
    "Tell me one fun fact about the moon.",
    "Give me one simple study tip for a tired student.",
    "What is one easy way to organize a desk?",
    "Explain photosynthesis in very simple words.",
    "Say something encouraging before an exam.",
    "Tell me one interesting fact about ordinary household magnets.",
    "Name one simple way to save phone battery.",
    "Give me one tip for staying focused while reading.",
    "What is one easy way to remember a new word?",
    "Explain gravity in one short sentence.",
    "Suggest one small thing to do when I need a break.",
    "Why is drinking water important? Keep it brief.",
    "Give me one beginner tip for learning English.",
    "What is one way to make a morning routine easier?",
    "Explain a rainbow in simple words.",
    "Suggest one way to keep a study table tidy.",
    "What is one useful habit for better sleep?",
    "Tell me one interesting fact about plants.",
    "Give me one short idea for planning tomorrow.",
]


def synthesize_pcm_16k(text: str) -> bytes:
    """Create throwaway, English synthetic speech and resample it to PCM16/16 kHz."""
    with tempfile.NamedTemporaryFile(suffix=".wav") as wav_file:
        subprocess.run(
            ["espeak-ng", "-v", "en-us", "-s", "140", "-w", wav_file.name, text],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        with wave.open(wav_file.name, "rb") as source:
            channels = source.getnchannels()
            sample_width = source.getsampwidth()
            source_rate = source.getframerate()
            raw = source.readframes(source.getnframes())

    if channels != 1 or sample_width != 2 or source_rate <= 0 or len(raw) < 4:
        raise RuntimeError("unsupported synthetic speech format")
    if source_rate == 16000:
        return raw

    source_count = len(raw) // 2
    samples = struct.unpack("<" + "h" * source_count, raw)
    target_count = max(1, round(source_count * 16000 / source_rate))
    output = bytearray(target_count * 2)
    for index in range(target_count):
        position = index * source_rate / 16000
        left = min(int(position), source_count - 1)
        right = min(left + 1, source_count - 1)
        fraction = position - left
        value = int(samples[left] * (1 - fraction) + samples[right] * fraction)
        struct.pack_into("<h", output, index * 2, max(-32768, min(32767, value)))
    return bytes(output)


def receive_json(ws):
    """Skip binary/non-JSON media frames; retain only structured control frames."""
    frame = ws.recv()
    if frame in ("", None):
        return None
    if isinstance(frame, bytes):
        try:
            frame = frame.decode("utf-8")
        except UnicodeDecodeError:
            return None
    try:
        value = json.loads(frame)
    except (TypeError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


def setup_complete(message: dict) -> bool:
    return bool(message.get("setupComplete") or message.get("setup_complete"))


def turn_complete(message: dict) -> bool:
    content = message.get("serverContent") or message.get("server_content") or {}
    return isinstance(content, dict) and bool(content.get("turnComplete") or content.get("turn_complete"))


def generated_audio_bytes(message: dict) -> int:
    """Count audio bytes in memory only; never persist or print their payload."""
    total = 0
    for key in ("serverContent", "server_content"):
        content = message.get(key)
        if not isinstance(content, dict):
            continue
        model_turn = content.get("modelTurn") or content.get("model_turn")
        parts = model_turn.get("parts", []) if isinstance(model_turn, dict) else []
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


def percentile(values: list[int], fraction: float):
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int((len(ordered) * fraction + 0.999999) - 1)))
    return ordered[index]


def send_synthetic_turn(ws, prompt: str, turn_number: int) -> tuple[int, int]:
    pcm = synthesize_pcm_16k(prompt)
    if not pcm:
        raise RuntimeError("empty synthetic speech")
    ws.send(json.dumps({"realtime_input": {"activity_start": True}}))

    # Stream at approximately real-time cadence, with the same PCM format as the app.
    for offset in range(0, len(pcm), CHUNK_BYTES):
        chunk = pcm[offset:offset + CHUNK_BYTES]
        ws.send(json.dumps({
            "realtime_input": {
                "audio": {
                    "data": base64.b64encode(chunk).decode("ascii"),
                    "mime_type": "audio/pcm;rate=16000",
                }
            }
        }))
        time.sleep(len(chunk) / (16000 * 2))

    boundary_at = time.monotonic()
    ws.send(json.dumps({"realtime_input": {"activity_end": True}}))
    deadline = time.monotonic() + TURN_TIMEOUT_SECONDS
    first_audio_at = None
    audio_bytes = 0
    completed = False

    while time.monotonic() < deadline:
        try:
            message = receive_json(ws)
        except websocket.WebSocketTimeoutException:
            continue
        if message is None:
            continue
        if message.get("error"):
            raise RuntimeError("provider/protocol error")
        count = generated_audio_bytes(message)
        if count:
            audio_bytes += count
            if first_audio_at is None:
                first_audio_at = time.monotonic()
        if turn_complete(message):
            completed = True
            break

    if not completed or first_audio_at is None or audio_bytes <= 0:
        raise RuntimeError("synthetic turn did not complete with generated audio")
    latency_ms = round((first_audio_at - boundary_at) * 1000)
    # Only a turn ordinal and timings are emitted; never the prompt/transcript/audio.
    print(f"turn={turn_number:02d} boundary_to_first_audio_ms={latency_ms} audio_bytes={audio_bytes}")
    return latency_ms, audio_bytes


def main() -> int:
    if not BASE_URL.startswith("https://") or not AUTH_COOKIE.startswith("moina_session="):
        raise RuntimeError("HTTPS URL and synthetic authenticated session are required")
    ws_url = BASE_URL.replace("https://", "wss://", 1) + "/api/voice/socket"
    samples = []
    ws = websocket.create_connection(
        ws_url,
        origin=BASE_URL,
        timeout=12,
        enable_multithread=True,
        cookie=AUTH_COOKIE,
    )
    try:
        ws.settimeout(0.5)
        ws.send(json.dumps({"setup": {}}))
        deadline = time.monotonic() + SETUP_TIMEOUT_SECONDS
        while time.monotonic() < deadline:
            try:
                message = receive_json(ws)
            except websocket.WebSocketTimeoutException:
                continue
            if message is None:
                continue
            if message.get("error"):
                raise RuntimeError("provider rejected synthetic benchmark setup")
            if setup_complete(message):
                break
        else:
            raise RuntimeError("synthetic benchmark setup timed out")

        for index, prompt in enumerate(PROMPTS[:TURN_COUNT], start=1):
            latency_ms, _ = send_synthetic_turn(ws, prompt, index)
            samples.append(latency_ms)

        print(json.dumps({
            "benchmark": "m1-synthetic-turn-latency-v1",
            "turns_completed": len(samples),
            "turns_requested": TURN_COUNT,
            "boundary_to_first_audio_ms": {
                "p50": percentile(samples, 0.50),
                "p90": percentile(samples, 0.90),
                "p95": percentile(samples, 0.95),
                "min": min(samples) if samples else None,
                "max": max(samples) if samples else None,
            },
            "note": "Synthetic English input; latency benchmark only, not an Assamese naturalness score.",
        }, sort_keys=True))
        if len(samples) != TURN_COUNT:
            raise RuntimeError("incomplete benchmark sample set")
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
        print("M1 synthetic turn-latency benchmark: FAIL (" + type(exc).__name__ + ")")
        raise SystemExit(1)
