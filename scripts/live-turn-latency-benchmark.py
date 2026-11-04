#!/usr/bin/env python3
"""Production synthetic multi-turn audio latency benchmark.

Uses locally synthesized speech. A reader timestamps provider frames while audio streams.
Normal voice mode uses provider VAD, so PCM is sent continuously with trailing silence.
Never logs prompts, audio, or transcripts.
"""
import base64
import json
import os
import queue
import struct
import subprocess
import tempfile
import threading
import time
import wave

import websocket

BASE_URL = os.environ.get("BASE_URL", "https://askmoina-voice.thenewtongs.workers.dev").rstrip("/")
AUTH_COOKIE = os.environ.get("ASKMOINA_SYNTHETIC_COOKIE", "").strip()
SETUP_TIMEOUT_SECONDS = 18
TURN_TIMEOUT_SECONDS = 60
KEEPALIVE_INTERVAL_SECONDS = 8
TURN_COUNT = 20
CHUNK_BYTES = 1280
TRAILING_SILENCE_MILLISECONDS = 1_000
PROMPTS = [
    "What is two plus two?",
    "Name one moon fact.",
    "Give one study tip.",
    "How do I organize a desk?",
    "Explain photosynthesis simply.",
    "Say something encouraging.",
    "What do magnets attract?",
    "How can I save phone battery?",
    "Give one reading tip.",
    "How can I remember new words?",
    "Explain gravity simply.",
    "Suggest one short break.",
    "Why should I drink water?",
    "Give one English learning tip.",
    "How can I start my morning?",
    "How can I keep my desk tidy?",
    "How do plants grow?",
    "What causes a rainbow?",
    "Name one healthy sleep habit.",
    "Suggest one plan for tomorrow.",
]


def synthesize_pcm_16k(text: str) -> tuple[bytes, int]:
    with tempfile.NamedTemporaryFile(suffix=".wav") as wav_file:
        subprocess.run(
            ["espeak-ng", "-v", "en-us", "-s", "140", "-w", wav_file.name, text],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        with wave.open(wav_file.name, "rb") as source:
            channels = source.getnchannels()
            sample_width = source.getsampwidth()
            source_rate = source.getframerate()
            raw = source.readframes(source.getnframes())
    if channels != 1 or sample_width != 2 or source_rate <= 0 or len(raw) < 4:
        raise RuntimeError("unsupported synthetic speech format")
    if source_rate == 16000:
        return trim_encoder_tail(raw)
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
    return trim_encoder_tail(bytes(output))


def trim_encoder_tail(pcm: bytes) -> tuple[bytes, int]:
    """Remove only trailing near-silence from the synthetic voice fixture.

    espeak WAVs commonly contain their own quiet tail. Keeping that tail inside
    the measured "speech" payload can make a correct early provider response look
    like negative latency. Keep 120 ms after the last meaningful 10 ms PCM frame,
    then append our separately controlled silence window in send_synthetic_turn().
    """
    if len(pcm) < 4:
        return pcm
    aligned = pcm[: len(pcm) - (len(pcm) % 2)]
    frame_bytes = 16000 * 2 // 100  # 10 ms at 16 kHz mono PCM16
    last_active_end = 0
    for offset in range(0, len(aligned), frame_bytes):
        frame = aligned[offset:offset + frame_bytes]
        if len(frame) < 2:
            break
        count = len(frame) // 2
        samples = struct.unpack("<" + "h" * count, frame[:count * 2])
        peak = max(abs(sample) for sample in samples)
        rms = (sum(sample * sample for sample in samples) / count) ** 0.5
        if peak >= 160 or rms >= 55:
            last_active_end = offset + len(frame)
    if last_active_end == 0:
        return aligned, len(aligned)
    # Keep 120 ms of natural audio tail, but expose the end of meaningful speech
    # separately. The assistant can start responding during this quiet tail.
    keep_through = min(len(aligned), last_active_end + (16000 * 2 * 120 // 1000))
    trimmed = aligned[: keep_through - (keep_through % 2)]
    return trimmed, min(last_active_end, len(trimmed))


def receive_json(ws):
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


def turn_complete(message: dict) -> bool:
    content = message.get("serverContent") or message.get("server_content") or {}
    return isinstance(content, dict) and bool(content.get("turnComplete") or content.get("turn_complete"))


def interaction_status(message: dict) -> str | None:
    content = message.get("serverContent") or message.get("server_content") or {}
    if not isinstance(content, dict):
        return None
    value = content.get("interactionStatus") or content.get("interaction_status")
    return value.upper() if isinstance(value, str) else None


def turn_is_idle(message: dict, turn_complete_seen: bool = False) -> bool:
    """Wait for IDLE even when Live emits it in a later serverContent message."""
    return (turn_complete(message) or turn_complete_seen) and interaction_status(message) == "IDLE"


def generated_audio_bytes(message: dict) -> int:
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


def chunk_reaches_speech_end(offset: int, chunk_length: int, speech_end_offset: int) -> bool:
    """True for the chunk containing the last meaningful speech sample."""
    return offset < speech_end_offset <= offset + chunk_length


def speech_end_to_first_audio_ms(first_audio_at: float, speech_end_at: float) -> int:
    """Return signed latency; negative means assistant audio began before user speech ended."""
    return round((first_audio_at - speech_end_at) * 1000)


def percentile(values: list[int], fraction: float):
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int((len(ordered) * fraction + 0.999999) - 1)))
    return ordered[index]


def reader_loop(ws, events: queue.Queue, stop_reader: threading.Event):
    while not stop_reader.is_set():
        try:
            message = receive_json(ws)
        except websocket.WebSocketTimeoutException:
            continue
        except Exception as exc:
            if not stop_reader.is_set():
                events.put((time.monotonic(), {"__reader_error": type(exc).__name__}))
            return
        if message is not None:
            events.put((time.monotonic(), message))


def drain_until_quiet(events: queue.Queue, quiet_seconds: float = 0.65):
    quiet_deadline = time.monotonic() + quiet_seconds
    while time.monotonic() < quiet_deadline:
        remaining = quiet_deadline - time.monotonic()
        try:
            _at, message = events.get(timeout=min(0.15, max(0.01, remaining)))
        except queue.Empty:
            return
        quiet_deadline = time.monotonic() + quiet_seconds
        if "__reader_error" in message:
            raise RuntimeError("Live WebSocket reader failed while draining a completed turn")


def send_relay_keepalive_if_due(ws, last_keepalive_at: float, now: float | None = None) -> float:
    """Refresh the Worker idle watchdog during provider-side response generation."""
    current = time.monotonic() if now is None else now
    if current - last_keepalive_at < KEEPALIVE_INTERVAL_SECONDS:
        return last_keepalive_at
    ws.send(json.dumps({"keepalive": True}))
    return current


def send_synthetic_turn(ws, events: queue.Queue, prompt: str, turn_number: int) -> tuple[int, int]:
    speech, speech_end_offset = synthesize_pcm_16k(prompt)
    if not speech or speech_end_offset <= 0 or speech_end_offset > len(speech):
        raise RuntimeError("empty synthetic speech or invalid speech boundary")
    silence_bytes = 16000 * 2 * TRAILING_SILENCE_MILLISECONDS // 1000
    pcm = speech + bytes(silence_bytes)
    speech_end_at = None

    for offset in range(0, len(pcm), CHUNK_BYTES):
        chunk = pcm[offset:offset + CHUNK_BYTES]
        # Timestamp the last meaningful speech sample, not the preserved 120 ms
        # quiet tail. Set the timestamp before send so the reader thread cannot
        # record a valid first-audio frame before this boundary due to a race.
        if speech_end_at is None and chunk_reaches_speech_end(offset, len(chunk), speech_end_offset):
            speech_end_at = time.monotonic()
        ws.send(json.dumps({
            "realtime_input": {
                "audio": {
                    "data": base64.b64encode(chunk).decode("ascii"),
                    "mime_type": "audio/pcm;rate=16000",
                }
            }
        }))
        time.sleep(len(chunk) / (16000 * 2))

    if speech_end_at is None:
        raise RuntimeError("synthetic speech boundary was not observed")

    deadline = time.monotonic() + TURN_TIMEOUT_SECONDS
    first_audio_at = None
    audio_bytes = 0
    completed = False
    messages_seen = 0
    last_interaction_status = None
    saw_turn_complete = False
    last_keepalive_at = time.monotonic()
    while time.monotonic() < deadline:
        try:
            received_at, message = events.get(timeout=0.5)
        except queue.Empty:
            last_keepalive_at = send_relay_keepalive_if_due(ws, last_keepalive_at)
            continue
        last_keepalive_at = send_relay_keepalive_if_due(ws, last_keepalive_at)
        if "__reader_error" in message:
            raise RuntimeError("Live WebSocket closed during synthetic turn " + str(turn_number))
        messages_seen += 1
        if message.get("error"):
            raise RuntimeError("provider/protocol error during synthetic turn " + str(turn_number))
        count = generated_audio_bytes(message)
        if count:
            audio_bytes += count
            if first_audio_at is None:
                # Keep early audio too: Live may begin responding during a natural
                # VAD pause before the last meaningful input frame has been sent.
                first_audio_at = received_at
        if turn_complete(message):
            saw_turn_complete = True
        last_interaction_status = interaction_status(message) or last_interaction_status
        # turnComplete and IDLE may arrive in separate serverContent messages.
        # Do not inject the next utterance until the complete interaction is idle.
        if turn_is_idle(message, turn_complete_seen=saw_turn_complete):
            completed = True
            break

    if not completed or audio_bytes <= 0 or first_audio_at is None:
        raise RuntimeError(
            "synthetic turn " + str(turn_number) + " did not reach IDLE with generated audio " +
            "(completed=" + str(completed) + ", interaction_status=" + str(last_interaction_status) +
            ", audio_bytes=" + str(audio_bytes) + ", messages=" + str(messages_seen) + ")"
        )
    latency_ms = speech_end_to_first_audio_ms(first_audio_at, speech_end_at)
    print("turn=" + str(turn_number).zfill(2) +
          " speech_end_to_first_audio_ms=" + str(latency_ms) +
          " audio_bytes=" + str(audio_bytes))
    drain_until_quiet(events, quiet_seconds=1.0)
    return latency_ms, audio_bytes


def main() -> int:
    if not BASE_URL.startswith("https://") or not AUTH_COOKIE.startswith("moina_session="):
        raise RuntimeError("HTTPS URL and synthetic authenticated session are required")
    ws_url = BASE_URL.replace("https://", "wss://", 1) + "/api/voice/socket"
    ws = websocket.create_connection(
        ws_url, origin=BASE_URL, timeout=12, enable_multithread=True, cookie=AUTH_COOKIE
    )
    stop_reader = threading.Event()
    events: queue.Queue = queue.Queue()
    reader = None
    samples = []
    try:
        ws.settimeout(0.5)
        ws.send(json.dumps({"setup": {}}))
        deadline = time.monotonic() + SETUP_TIMEOUT_SECONDS
        last_keepalive_at = time.monotonic()
        while time.monotonic() < deadline:
            try:
                message = receive_json(ws)
            except websocket.WebSocketTimeoutException:
                last_keepalive_at = send_relay_keepalive_if_due(ws, last_keepalive_at)
                continue
            if message is None:
                last_keepalive_at = send_relay_keepalive_if_due(ws, last_keepalive_at)
                continue
            last_keepalive_at = send_relay_keepalive_if_due(ws, last_keepalive_at)
            if message.get("error"):
                raise RuntimeError("provider rejected synthetic benchmark setup")
            if message.get("setupComplete") or message.get("setup_complete"):
                break
        else:
            raise RuntimeError("synthetic benchmark setup timed out")

        reader = threading.Thread(target=reader_loop, args=(ws, events, stop_reader), daemon=True)
        reader.start()
        for index, prompt in enumerate(PROMPTS[:TURN_COUNT], start=1):
            latency_ms, _ = send_synthetic_turn(ws, events, prompt, index)
            samples.append(latency_ms)
            if index < TURN_COUNT:
                time.sleep(1.0)

        print(json.dumps({
            "benchmark": "m1-synthetic-turn-latency-v3",
            "turns_completed": len(samples),
            "turns_requested": TURN_COUNT,
            "speech_end_to_first_audio_ms": {
                "p50": percentile(samples, 0.50),
                "p90": percentile(samples, 0.90),
                "p95": percentile(samples, 0.95),
                "min": min(samples) if samples else None,
                "max": max(samples) if samples else None,
            },
            "early_response_turns": sum(1 for value in samples if value < 0),
            "note": "Synthetic short, single-clause English PCM turns with normal automatic VAD. Negative latency means the assistant began speaking before the final meaningful PCM frame. This is not an Assamese naturalness score.",
        }, sort_keys=True))
        if len(samples) != TURN_COUNT:
            raise RuntimeError("incomplete benchmark sample set")
        return 0
    finally:
        stop_reader.set()
        try:
            ws.close()
        except Exception:
            pass
        if reader:
            reader.join(timeout=2)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print("M1 synthetic turn-latency benchmark: FAIL (" +
              type(exc).__name__ + ": " + str(exc)[:220] + ")")
        raise SystemExit(1)
