#!/usr/bin/env python3
"""Capture controlled, disposable Gemini Live voice auditions on production.

Uses two identical synthetic text prompts for each native voice. It does not
record input audio or write transcripts/prompt text to artifacts.
"""
import base64
import http.cookiejar
import json
import os
import re
import time
import urllib.parse
import urllib.request
import wave
from pathlib import Path

import websocket

BASE_URL = os.environ.get(
    "BASE_URL", "https://askmoina-voice.thenewtongs.workers.dev"
).rstrip("/")
OUTPUT_DIR = Path("artifacts/voice-reference-audition")
SETUP_WAIT_SECONDS = 18
TURN_WAIT_SECONDS = 35

VOICES = [
    ("leda", "Leda"),
    ("aoede", "Aoede"),
    ("achernar", "Achernar"),
    ("zephyr", "Zephyr"),
]

# Keep the text and delivery brief identical for each voice so that timbre is
# the main variable. These are synthetic prompts, not recordings of the user.
SAMPLES = [
    (
        "love-you",
        "Say exactly these words: I love you. Use a naturally sweet, bright, "
        "light feminine tone with rounded vowels and gentle upward intonation. "
        "Keep it sincere and natural, not singing, not a cartoon imitation, "
        "and do not exaggerate pitch.",
    ),
    (
        "assamese-english",
        "Say one short, gentle response in a natural everyday Upper Assam "
        "Assamese-English mix to: Aji mood tu bhal nai yaar. Keep the delivery "
        "sweet, delicate, bright and warm with relaxed human rhythm. No advice, "
        "no forced high pitch, no exaggerated sing-song style.",
    ),
]


def login_admin():
    username = os.environ.get("ADMIN_DASHBOARD_USER", "").strip()
    password = os.environ.get("ADMIN_DASHBOARD_PASSWORD", "")
    if not username or not password:
        raise RuntimeError(
            "GitHub Actions secrets ADMIN_DASHBOARD_USER and "
            "ADMIN_DASHBOARD_PASSWORD are required for the protected voice audition."
        )
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    payload = json.dumps({"username": username, "password": password}).encode("utf-8")
    request = urllib.request.Request(
        BASE_URL + "/admin/login",
        data=payload,
        method="POST",
        headers={
            "Origin": BASE_URL,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Cache-Control": "no-store",
        },
    )
    with opener.open(request, timeout=20) as response:
        data = json.loads(response.read().decode("utf-8"))
    if not isinstance(data, dict) or data.get("ok") is not True:
        raise RuntimeError("Admin login was rejected; no audition was run.")
    cookies = {cookie.name: cookie.value for cookie in jar}
    if not cookies.get("moina_admin_session"):
        raise RuntimeError("Admin login succeeded without the expected session cookie.")
    cookie_header = "; ".join(name + "=" + value for name, value in cookies.items())
    return cookie_header, opener


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
    return isinstance(content, dict) and bool(
        content.get("turnComplete") or content.get("turn_complete")
    )


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


def capture_sample(cookie_header, voice_name, sample_id, prompt):
    query = urllib.parse.urlencode({
        "voice_preview": "1",
        "voice_name": voice_name,
    })
    ws_url = (
        BASE_URL.replace("https://", "wss://", 1)
        + "/api/voice/socket?"
        + query
    )
    ws = websocket.create_connection(
        ws_url,
        origin=BASE_URL,
        timeout=12,
        enable_multithread=True,
        cookie=cookie_header,
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
                raise RuntimeError("Live setup failed for " + voice_name + ".")
            if is_setup_complete(message):
                break
        else:
            raise RuntimeError("Timed out waiting for Live setup for " + voice_name + ".")

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
                raise RuntimeError("Live response failed for " + voice_name + ".")
            found_chunks, found_rate = audio_from_message(message)
            if found_chunks:
                if sample_rate is not None and found_rate != sample_rate:
                    raise RuntimeError("Audio sample rate changed within " + sample_id + ".")
                sample_rate = found_rate
                chunks.extend(found_chunks)
            if is_turn_complete(message) and chunks:
                complete = True
                break
            if time.monotonic() - last_keepalive >= 10:
                ws.send(json.dumps({"keepalive": True}))
                last_keepalive = time.monotonic()
        if not complete or not chunks or not sample_rate:
            raise RuntimeError("No complete generated audio for " + voice_name + "/" + sample_id + ".")
        pcm = b"".join(chunks)
        if len(pcm) % 2:
            pcm = pcm[:-1]
        if len(pcm) < sample_rate // 3:
            raise RuntimeError("Generated clip was unexpectedly short for " + sample_id + ".")
        path = OUTPUT_DIR / (voice_name.lower() + "-" + sample_id + ".wav")
        with wave.open(str(path), "wb") as target:
            target.setnchannels(1)
            target.setsampwidth(2)
            target.setframerate(sample_rate)
            target.writeframes(pcm)
        return {
            "sample_id": sample_id,
            "voice": voice_name,
            "file": path.name,
            "sample_rate_hz": sample_rate,
            "audio_bytes": len(pcm),
        }
    finally:
        try:
            ws.close()
        except Exception:
            pass


def logout_admin(cookie_header):
    request = urllib.request.Request(
        BASE_URL + "/admin/logout",
        data=b"{}",
        method="POST",
        headers={
            "Origin": BASE_URL,
            "Cookie": cookie_header,
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=12):
            pass
    except Exception:
        # Cookie expiry and worker-side validation still protect the short-lived
        # session; never fail the already captured audition solely on logout.
        pass


def main():
    if not BASE_URL.startswith("https://"):
        raise RuntimeError("Production audition requires HTTPS.")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    cookie_header, _ = login_admin()
    results = []
    try:
        for voice_id, voice_name in VOICES:
            for sample_id, prompt in SAMPLES:
                result = capture_sample(cookie_header, voice_name, sample_id, prompt)
                results.append(result)
                print("Captured native voice audition: " + voice_id + "/" + sample_id)
    finally:
        logout_admin(cookie_header)

    manifest = {
        "source": "AskMoina production Gemini Live",
        "purpose": "Same-prompt native voice comparison against an owner-provided reference clip",
        "voices": [name for _, name in VOICES],
        "samples": results,
        "privacy": "Synthetic text input only; no owner voice/audio or prompt transcript is saved.",
        "audio_processing": "Native model audio; no pitch shifting or speed modification.",
    }
    (OUTPUT_DIR / "manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8"
    )
    if len(results) != len(VOICES) * len(SAMPLES):
        raise RuntimeError("Expected every native-voice sample before publication.")
    print("Voice reference audition: PASS (" + str(len(results)) + " WAV samples)")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(
            "Voice reference audition: FAIL ("
            + type(exc).__name__
            + ": "
            + str(exc)[:180]
            + ")"
        )
        raise SystemExit(1)
