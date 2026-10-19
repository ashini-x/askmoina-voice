#!/usr/bin/env python3
"""Capture short, disposable listen-back samples from the deployed Gemini Live voice.

Input is synthetic text only. The script stores generated assistant audio WAVs and
metadata containing sample IDs/format, but never stores or prints the prompt,
transcript, authentication cookie, or input audio.
"""
import base64
import json
import os
import re
import time
import wave
from pathlib import Path

import websocket

BASE_URL = os.environ.get("BASE_URL", "https://askmoina-voice.thenewtongs.workers.dev").rstrip("/")
AUTH_COOKIE = os.environ.get("ASKMOINA_SYNTHETIC_COOKIE", "").strip()
OUTPUT_DIR = Path("artifacts/live-voice-samples")
SETUP_WAIT_SECONDS = 18
TURN_WAIT_SECONDS = 38
# Compare the same prompts across native prebuilt voices. Never use DSP pitch-shifting.
VOICE_CANDIDATES = ("Autonoe", "Laomedeia", "Sadachbia", "Puck", "Achird", "Enceladus", "Vindemiatrix", "Despina")
SAMPLES = [
    (
        "01-reference-phrase",
        "Say exactly these words, and no other words: I love you. Say them once in a naturally sweet, soft, youthful feminine voice, gently affectionate and bright, with relaxed human timing. Do not sing, whisper, exaggerate the pitch, or sound cartoonish or robotic.",
    ),
    (
        "02-assamese-english-gentle",
        "Aji mood tu bhal nai yaar. Reply gently in a natural Upper Assam Assamese-English mix, in one or two short sentences, without giving advice. Keep the same soft, sweet, caring vocal quality, with natural rhythm, clear words, and no forced high pitch.",
    ),
    (
        "03-assamese-english-celebration",
        "I got selected for the job! Bohut din dhori try kori asilu. Congratulate me warmly in a casual Upper Assam Assamese-English mix, with one short response. Sound sweet, bright and genuinely delighted, not theatrical or squeaky.",
    ),
]


def recv_json_message(ws):
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
        raise RuntimeError("Live WebSocket sent malformed JSON.")
    return message if isinstance(message, dict) else None


def is_setup_complete(message):
    return bool(message.get("setupComplete") or message.get("setup_complete"))


def is_turn_complete(message):
    content = message.get("serverContent") or message.get("server_content") or {}
    return isinstance(content, dict) and bool(content.get("turnComplete") or content.get("turn_complete"))


def audio_from_message(message):
    chunks = []
    sample_rate = None
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
            mime = str(inline.get("mimeType") or inline.get("mime_type") or "").lower()
            encoded = inline.get("data")
            if not (isinstance(encoded, str) and encoded and mime.startswith("audio/pcm")):
                continue
            match = re.search(r"rate=(\d+)", mime)
            rate = int(match.group(1)) if match else 24000
            raw = base64.b64decode(encoded, validate=True)
            if not raw:
                continue
            if sample_rate is not None and rate != sample_rate:
                raise RuntimeError("Live audio sample rate changed mid-turn.")
            sample_rate = rate
            chunks.append(raw)
    return chunks, sample_rate


def capture_sample(voice_name, sample_id, prompt):
    ws_url = (BASE_URL.replace("https://", "wss://", 1) +
              "/api/voice/socket?voice_preview=1&voice_name=" + voice_name)
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
        deadline = time.monotonic() + SETUP_WAIT_SECONDS
        while time.monotonic() < deadline:
            try:
                message = recv_json_message(ws)
            except websocket.WebSocketTimeoutException:
                continue
            if message is None:
                continue
            if message.get("error"):
                raise RuntimeError("Live setup failed.")
            if is_setup_complete(message):
                break
        else:
            raise RuntimeError("Timed out waiting for Live setup.")

        ws.send(json.dumps({"text_input": prompt}))
        deadline = time.monotonic() + TURN_WAIT_SECONDS
        last_keepalive = time.monotonic()
        chunks = []
        sample_rate = None
        complete = False
        while time.monotonic() < deadline:
            try:
                message = recv_json_message(ws)
            except websocket.WebSocketTimeoutException:
                if time.monotonic() - last_keepalive >= 10:
                    ws.send(json.dumps({"keepalive": True}))
                    last_keepalive = time.monotonic()
                continue
            if message is None:
                continue
            if message.get("error"):
                raise RuntimeError("Live response returned a provider/protocol error.")
            found_chunks, found_rate = audio_from_message(message)
            if found_chunks:
                if sample_rate is not None and found_rate != sample_rate:
                    raise RuntimeError("Live audio sample rate changed within sample.")
                sample_rate = found_rate
                chunks.extend(found_chunks)
            if is_turn_complete(message) and chunks:
                complete = True
                break
            if time.monotonic() - last_keepalive >= 10:
                ws.send(json.dumps({"keepalive": True}))
                last_keepalive = time.monotonic()
        if not complete or not chunks or not sample_rate:
            raise RuntimeError("Live response did not complete with generated PCM audio.")
        pcm = b"".join(chunks)
        if len(pcm) % 2:
            pcm = pcm[:-1]
        if len(pcm) < sample_rate // 2:
            raise RuntimeError("Generated sample was unexpectedly short.")
        path = OUTPUT_DIR / f"{sample_id}.wav"
        with wave.open(str(path), "wb") as target:
            target.setnchannels(1)
            target.setsampwidth(2)
            target.setframerate(sample_rate)
            target.writeframes(pcm)
        return {"sample_id": sample_id, "file": path.name, "sample_rate_hz": sample_rate, "audio_bytes": len(pcm)}
    finally:
        try:
            ws.close()
        except Exception:
            pass


def main():
    if not BASE_URL.startswith("https://") or not AUTH_COOKIE.startswith("moina_session="):
        raise RuntimeError("Authenticated production synthetic session is required.")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    results = []
    for voice_name in VOICE_CANDIDATES:
        for sample_id, prompt in SAMPLES:
            candidate_id = voice_name.lower() + "-" + sample_id
            results.append(capture_sample(voice_name, candidate_id, prompt))
            print("Voice sample captured: " + candidate_id)
    manifest = {
        "source": "AskMoina production Gemini Live voice preview",
        "voice_candidates": list(VOICE_CANDIDATES),
        "default_voice_unchanged": "Zephyr",
        "purpose": "Side-by-side native-voice audition against the owner's uploaded reference clip",
        "sample_count": len(results),
        "samples": results,
        "privacy": "Synthetic text input only. No input audio, transcripts, or prompt text saved.",
    }
    (OUTPUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print("Generated voice listen-back samples: PASS (" + str(len(results)) + " WAV files)")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print("Generated voice listen-back samples: WARN (" + type(exc).__name__ + ": " + str(exc)[:160] + ")")
        raise SystemExit(1)
