#!/usr/bin/env python3
"""Check whether Gemini Live accepts Candidate A's existing prompted voice ID directly.

This is a one-turn isolated test only. It does not use replicated_voice_config and
does not deploy or update production.
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import time
import wave
from pathlib import Path
from typing import Any

from google import genai
from google.genai import types

PROJECT_ID = os.environ["GCP_PROJECT_ID"]
LOCATION = os.getenv("GEMINI_LOCATION", "us-central1")
MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-live")
VOICE_ID = "voice_6f4c602c-c79d-4a54-9bb1-c1549aab9c05"
OUT = Path("live-candidate-a-output")
OUTPUT_WAV = OUT / "candidate-a-direct-live-voice.wav"
REPORT = OUT / "candidate-a-direct-live-voice-report.json"
PROMPT = (
    "মইনাই, অসমীয়াত মোক এটা সৰু, বন্ধুত্বপূৰ্ণ সম্ভাষণ দিয়া। "
    "স্বাভাৱিক, কোমল, উজ্জ্বল আৰু উষ্ণ ধৰণে কথা কোৱা।"
)
SYSTEM_INSTRUCTION = (
    "You are AskMoina, a warm AI voice companion for people in Assam. "
    "Respond in natural conversational Assamese, briefly and warmly. "
    "Use a light, bright, soft, airy, unforced speaking style. Do not pretend to be human."
)


def get_audio_bytes(value: Any) -> bytes:
    if isinstance(value, bytes):
        return value
    if isinstance(value, bytearray):
        return bytes(value)
    if isinstance(value, str):
        try:
            return base64.b64decode(value)
        except Exception:
            return value.encode("latin1")
    raise TypeError(f"Unexpected audio data type: {type(value).__name__}")


async def run() -> dict[str, Any]:
    OUT.mkdir(parents=True, exist_ok=True)
    client = genai.Client(vertexai=True, project=PROJECT_ID, location=LOCATION)
    started = time.perf_counter()
    first_audio: float | None = None
    audio: list[bytes] = []
    text_parts: list[str] = []
    mime_types: list[str] = []

    config = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        system_instruction=types.Content(parts=[types.Part(text=SYSTEM_INSTRUCTION)]),
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(voice=VOICE_ID)
        ),
    )

    async with client.aio.live.connect(model=MODEL, config=config) as session:
        await session.send_client_content(
            turns=types.Content(role="user", parts=[types.Part(text=PROMPT)]),
            turn_complete=True,
        )

        async def collect() -> None:
            nonlocal first_audio
            async for message in session.receive():
                server = getattr(message, "server_content", None)
                if server is None:
                    continue
                model_turn = getattr(server, "model_turn", None)
                for part in (getattr(model_turn, "parts", None) or []):
                    text = getattr(part, "text", None)
                    if text:
                        text_parts.append(text)
                    inline = getattr(part, "inline_data", None)
                    data = getattr(inline, "data", None) if inline else None
                    if data is not None:
                        b = get_audio_bytes(data)
                        if b:
                            if first_audio is None:
                                first_audio = time.perf_counter() - started
                            audio.append(b)
                        if getattr(inline, "mime_type", None):
                            mime_types.append(inline.mime_type)
                if getattr(server, "turn_complete", False):
                    break

        await asyncio.wait_for(collect(), timeout=50)

    elapsed = time.perf_counter() - started
    if not audio:
        raise RuntimeError("Live accepted the setup but returned no audio using the Candidate A voice ID.")

    pcm = b"".join(audio)
    with wave.open(str(OUTPUT_WAV), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(24000)
        wf.writeframes(pcm)
    with wave.open(str(OUTPUT_WAV), "rb") as wf:
        duration = wf.getnframes() / wf.getframerate()

    return {
        "status": "success",
        "method": "voice_config.voice = Candidate A's existing prompted voice ID",
        "model": MODEL,
        "location": LOCATION,
        "voice_id": VOICE_ID,
        "first_audio_ms": round(first_audio * 1000, 1) if first_audio is not None else None,
        "total_response_ms": round(elapsed * 1000, 1),
        "audio_file": OUTPUT_WAV.name,
        "audio_duration_seconds": round(duration, 3),
        "audio_bytes": len(pcm),
        "audio_mime_types_seen": sorted(set(mime_types)),
        "text_parts_seen": text_parts,
        "production_changed": False,
        "note": "Single-turn feasibility test; listening and interruption testing are still required.",
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    try:
        result = asyncio.run(run())
    except Exception as exc:
        result = {
            "status": "failed",
            "error_type": type(exc).__name__,
            "error": str(exc)[:2500],
            "production_changed": False,
        }
        REPORT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(result, ensure_ascii=False))
        raise SystemExit(1)
    REPORT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
