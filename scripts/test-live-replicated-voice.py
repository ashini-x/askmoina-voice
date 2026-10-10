#!/usr/bin/env python3
"""Isolated feasibility test: use Candidate A's TTS audio sample as a Gemini Live voice.

This script must only run from the experimental branch/workflow. It never deploys a
Worker or modifies production settings.
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

MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-live")
PROJECT_ID = os.environ["GCP_PROJECT_ID"]
LOCATION = os.getenv("GEMINI_LOCATION", "us-central1")
INPUT_SAMPLE = Path("candidate-a-input/voice_A_design_sample.wav")
OUT = Path("live-candidate-a-output")
OUTPUT_WAV = OUT / "candidate-a-live-response.wav"
REPORT = OUT / "live-voice-test-report.json"
TEST_PROMPT = (
    "মইনাই, অসমীয়াত মোক এটা সৰু, বন্ধুত্বপূৰ্ণ সম্ভাষণ দিয়া। "
    "স্বাভাৱিকভাৱে কথা কোৱা, আৰু মাতটো কোমল, উজ্জ্বল, উষ্ণ আৰু সহজ যেন ৰাখিবা।"
)
SYSTEM_INSTRUCTION = """
You are Moina, a warm and respectful AI voice companion for people in Assam.
Respond in natural, conversational Assamese for this test. Keep the greeting brief.
Use a light, gentle, bright, warm speaking style. Sound relaxed and unforced, not
theatrical or overly sugary. Do not claim to be human.
""".strip()


def load_pcm_sample(path: Path) -> tuple[bytes, dict[str, Any]]:
    with wave.open(str(path), "rb") as wf:
        channels = wf.getnchannels()
        rate = wf.getframerate()
        width = wf.getsampwidth()
        frames = wf.getnframes()
        duration = frames / rate
        pcm = wf.readframes(frames)
    meta = {
        "file": path.name,
        "duration_seconds": round(duration, 3),
        "sample_rate_hz": rate,
        "channels": channels,
        "sample_width_bytes": width,
        "mime_type": f"audio/pcm;rate={rate}",
    }
    if channels != 1 or rate != 24000 or width != 2:
        raise ValueError(f"Candidate A sample must be mono 24-kHz 16-bit PCM: {meta}")
    if not 10 <= duration <= 20:
        raise ValueError(f"Candidate A sample must be 10-20 seconds: {meta}")
    return pcm, meta


async def run_test() -> dict[str, Any]:
    OUT.mkdir(parents=True, exist_ok=True)
    pcm, sample_meta = load_pcm_sample(INPUT_SAMPLE)
    client = genai.Client(vertexai=True, project=PROJECT_ID, location=LOCATION)
    started = time.perf_counter()
    first_audio_seconds: float | None = None
    audio_chunks: list[bytes] = []
    observed_text: list[str] = []
    output_mime_types: list[str] = []

    config = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        system_instruction=types.Content(
            parts=[types.Part(text=SYSTEM_INSTRUCTION)]
        ),
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                replicated_voice_config=types.ReplicatedVoiceConfig(
                    voice_sample_audio=base64.b64encode(pcm).decode("ascii"),
                    mime_type=sample_meta["mime_type"],
                )
            )
        ),
    )

    async with client.aio.live.connect(model=MODEL, config=config) as session:
        await session.send_client_content(
            turns=types.Content(
                role="user",
                parts=[types.Part(text=TEST_PROMPT)],
            ),
            turn_complete=True,
        )

        async def collect_response() -> None:
            nonlocal first_audio_seconds
            async for message in session.receive():
                server_content = getattr(message, "server_content", None)
                if server_content is None:
                    continue
                model_turn = getattr(server_content, "model_turn", None)
                for part in (getattr(model_turn, "parts", None) or []):
                    text = getattr(part, "text", None)
                    if text:
                        observed_text.append(text)
                    inline = getattr(part, "inline_data", None)
                    data = getattr(inline, "data", None) if inline else None
                    if data is not None:
                        if isinstance(data, str):
                            try:
                                data = base64.b64decode(data)
                            except Exception:
                                data = data.encode("latin1")
                        if data:
                            if first_audio_seconds is None:
                                first_audio_seconds = time.perf_counter() - started
                            audio_chunks.append(bytes(data))
                        mime = getattr(inline, "mime_type", None)
                        if mime:
                            output_mime_types.append(mime)
                if getattr(server_content, "turn_complete", False):
                    break

        await asyncio.wait_for(collect_response(), timeout=50)

    elapsed = time.perf_counter() - started
    if not audio_chunks:
        raise RuntimeError(
            "The Live session connected but returned no audio for the Candidate A voice test."
        )

    output_bytes = b"".join(audio_chunks)
    with wave.open(str(OUTPUT_WAV), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(24000)
        wf.writeframes(output_bytes)

    with wave.open(str(OUTPUT_WAV), "rb") as wf:
        output_duration = wf.getnframes() / wf.getframerate()

    return {
        "status": "success",
        "model": MODEL,
        "location": LOCATION,
        "voice_mode": "replicated_voice_config",
        "sample": sample_meta,
        "prompt": TEST_PROMPT,
        "audio_output": {
            "file": OUTPUT_WAV.name,
            "bytes": len(output_bytes),
            "duration_seconds": round(output_duration, 3),
            "sample_rate_hz": 24000,
            "channels": 1,
            "mime_types_seen": sorted(set(output_mime_types)),
        },
        "timing": {
            "first_audio_ms": round(first_audio_seconds * 1000, 1)
            if first_audio_seconds is not None
            else None,
            "total_response_ms": round(elapsed * 1000, 1),
        },
        "text_parts_seen": observed_text,
        "note": (
            "This is an isolated single-turn test, not a production latency benchmark. "
            "Successful synthesis proves access and basic voice replication only; "
            "native-speaker listening is needed to judge voice similarity and Assamese quality."
        ),
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    try:
        result = asyncio.run(run_test())
    except Exception as exc:
        result = {
            "status": "failed",
            "model": MODEL,
            "location": LOCATION,
            "error_type": type(exc).__name__,
            "error": str(exc)[:2500],
            "note": (
                "No production configuration was changed. If the error says the feature "
                "is unavailable or unsupported, this Google Cloud project may not be enabled "
                "for Gemini Live replicated voices."
            ),
        }
        REPORT.write_text(
            json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(json.dumps(result, ensure_ascii=False))
        raise SystemExit(1)

    REPORT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
