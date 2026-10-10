#!/usr/bin/env python3
"""Prototype a text-brain + Candidate A streaming-TTS response, with no production deployment.

This keeps Gemini Live as the conversational brain but uses the Candidate A custom TTS
voice for the audible response. Measurements are sequential and are not a production SLA.
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
LIVE_LOCATION = os.getenv("GEMINI_LOCATION", "us-central1")
LIVE_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-live")
TTS_MODEL = "gemini-3.8-flash-tts"
CANDIDATE_A_VOICE_ID = "voice_6f4c602c-c79d-4a54-9bb1-c1549aab9c05"
OUT = Path("live-candidate-a-output")
OUTPUT_WAV = OUT / "candidate-a-brain-plus-tts.wav"
REPORT = OUT / "candidate-a-brain-plus-tts-report.json"

SYSTEM_INSTRUCTION = """
You are AskMoina, a warm, respectful AI voice companion for people in Assam.
Respond in natural, conversational Assamese. Be concise, friendly, bright, soft,
and unforced. Do not pretend to be human.

EXPRESSIVE SPEECH: Let the conversational context decide whether an audible vocal
event is appropriate. For a genuinely funny or joyful moment, a small <chuckle>,
<giggle>, or <laugh> may fit. For reassurance, a gentle <sigh> or <breath> may fit
only if it sounds natural. Use <whispering> only when the content genuinely calls
for a whisper. Other available event styles include <argh>, <heavy breath>,
<exhales>, <cackle>, <cheer>, <cough>, <cry>, <gasp>, <groan>, <growl>, <grunt>,
<hiss>, <laughter>, <moan>, <pant>, <pff>, <phew>, <scream>, <shout>, <shriek>,
<sigh>, <sneeze>, <snicker>, <snort>, <sob>, <throat-clearing>, <tsk>, and
<whimper>. Use only a tag that makes sense; never insert them just to decorate a
turn, never laugh at grief or distress, and do not speak the tag names aloud.
Do not wrap these tags in square brackets.
""".strip()

USER_PROMPT = (
    "মইনাই, আজি মোৰ ছাগলীয়ে মোৰ পৰীক্ষাৰ এডমিট কাৰ্ডটো মুখত লৈ দৌৰি গ’ল! "
    "এই ঘটনাটো শুনি স্বাভাৱিক, বন্ধুত্বপূৰ্ণ আৰু অলপ মজাৰ ধৰণে অসমীয়াত উত্তৰ দিয়া। "
    "সঁচাকৈ হাঁহি আহিলে মাথোঁ তেতিয়াহে হাঁহিবা।"
)


def audio_bytes(value: Any) -> bytes:
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


async def get_live_text() -> tuple[str, float]:
    client = genai.Client(vertexai=True, project=PROJECT_ID, location=LIVE_LOCATION)
    started = time.perf_counter()
    parts: list[str] = []
    config = types.LiveConnectConfig(
        response_modalities=["TEXT"],
        system_instruction=types.Content(parts=[types.Part(text=SYSTEM_INSTRUCTION)]),
    )
    async with client.aio.live.connect(model=LIVE_MODEL, config=config) as session:
        await session.send_client_content(
            turns=types.Content(
                role="user",
                parts=[types.Part(text=USER_PROMPT)],
            ),
            turn_complete=True,
        )

        async def collect() -> None:
            async for message in session.receive():
                server_content = getattr(message, "server_content", None)
                if server_content is None:
                    continue
                model_turn = getattr(server_content, "model_turn", None)
                for part in (getattr(model_turn, "parts", None) or []):
                    text = getattr(part, "text", None)
                    if text:
                        parts.append(text)
                if getattr(server_content, "turn_complete", False):
                    break

        await asyncio.wait_for(collect(), timeout=45)

    elapsed = time.perf_counter() - started
    output_text = "".join(parts).strip()
    if not output_text:
        raise RuntimeError("Gemini Live finished without returning text.")
    return output_text, elapsed


def synthesize_candidate_a_stream(text: str) -> tuple[bytes, dict[str, Any]]:
    """Stream Candidate A audio; record when the first TTS audio chunk arrives."""
    client = genai.Client(enterprise=True, project=PROJECT_ID, location="global")
    started = time.perf_counter()
    first_audio_seconds: float | None = None
    chunks: list[bytes] = []
    mime_types: list[str] = []

    response_stream = client.models.generate_content_stream(
        model=TTS_MODEL,
        contents=[{
            "role": "user",
            "parts": [{
                "text": text,
                "speech_metadata": {
                    "style": (
                        "Natural conversational Assamese; warm, light, bright, softly "
                        "airy and sweet, relaxed and unforced. Preserve any valid inline "
                        "vocal-event tags and perform them only where contextually appropriate."
                    )
                },
            }],
        }],
        config={
            "response_modalities": ["AUDIO"],
            "speech_config": {
                "voice_config": {"voice": CANDIDATE_A_VOICE_ID}
            },
        },
    )

    for response_chunk in response_stream:
        candidates = getattr(response_chunk, "candidates", None) or []
        for candidate in candidates:
            content = getattr(candidate, "content", None)
            for part in (getattr(content, "parts", None) or []):
                inline = getattr(part, "inline_data", None)
                if inline is None or getattr(inline, "data", None) is None:
                    continue
                chunk_data = audio_bytes(inline.data)
                if chunk_data:
                    if first_audio_seconds is None:
                        first_audio_seconds = time.perf_counter() - started
                    chunks.append(chunk_data)
                if getattr(inline, "mime_type", None):
                    mime_types.append(inline.mime_type)

    elapsed = time.perf_counter() - started
    if not chunks:
        raise RuntimeError("Candidate A TTS did not return any audio chunks.")
    return b"".join(chunks), {
        "model": TTS_MODEL,
        "voice_id": CANDIDATE_A_VOICE_ID,
        "first_audio_ms": round(first_audio_seconds * 1000, 1) if first_audio_seconds is not None else None,
        "stream_complete_ms": round(elapsed * 1000, 1),
        "audio_bytes": sum(map(len, chunks)),
        "chunk_count": len(chunks),
        "mime_types_seen": sorted(set(mime_types)),
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    try:
        live_text, brain_elapsed = asyncio.run(get_live_text())
        tts_started = time.perf_counter()
        pcm, tts_metrics = synthesize_candidate_a_stream(live_text)
        end_to_end = time.perf_counter() - started

        with wave.open(str(OUTPUT_WAV), "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(24000)
            wf.writeframes(pcm)
        with wave.open(str(OUTPUT_WAV), "rb") as wf:
            output_duration = wf.getnframes() / wf.getframerate()

        report = {
            "status": "success",
            "architecture": "Gemini Live text response -> Candidate A Gemini Flash TTS audio stream",
            "live_model": LIVE_MODEL,
            "live_location": LIVE_LOCATION,
            "tts_model": TTS_MODEL,
            "candidate_a_voice_id": CANDIDATE_A_VOICE_ID,
            "user_prompt": USER_PROMPT,
            "live_response_text": live_text,
            "timing": {
                "live_brain_text_complete_ms": round(brain_elapsed * 1000, 1),
                "candidate_a_tts_first_audio_ms_after_tts_start": tts_metrics["first_audio_ms"],
                "candidate_a_tts_stream_complete_ms": tts_metrics["stream_complete_ms"],
                "total_time_to_first_audio_ms_estimate": round(
                    brain_elapsed * 1000 + (tts_metrics["first_audio_ms"] or 0), 1
                ),
                "total_end_to_end_ms": round(end_to_end * 1000, 1),
            },
            "audio_output": {
                "file": OUTPUT_WAV.name,
                "duration_seconds": round(output_duration, 3),
                "bytes": len(pcm),
                "sample_rate_hz": 24000,
                "channels": 1,
                **tts_metrics,
            },
            "limitations": [
                "This prototype waits for the complete Live text response before starting TTS.",
                "It tests one turn, not continuous duplex conversation or barge-in.",
                "A real implementation must stream TTS chunks promptly to the browser and cancel TTS on interruption.",
                "Measure latency on repeated turns before considering any rollout."
            ],
            "production_changed": False,
        }
    except Exception as exc:
        report = {
            "status": "failed",
            "error_type": type(exc).__name__,
            "error": str(exc)[:2500],
            "production_changed": False,
        }
        REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(report, ensure_ascii=False))
        raise SystemExit(1)

    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
