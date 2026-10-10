#!/usr/bin/env python3
"""A/B test Candidate A vs Leda and probe context-aware vocal expression in Gemini Live."""
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
CANDIDATE_A_ID = "voice_6f4c602c-c79d-4a54-9bb1-c1549aab9c05"
OUT = Path("live-candidate-a-output")
REPORT = OUT / "candidate-a-live-comparison-report.json"

VOICE_GUIDANCE = """
You are AskMoina, a warm, respectful AI voice companion for people in Assam.
Respond naturally in conversational Assamese and keep spoken answers brief.
Aim for a light, bright, gentle, softly airy, warm voice that sounds relaxed and
unforced rather than theatrical or sugary.

Use context-aware audible expression rather than reading stage directions aloud.
Possible expressions include a small laugh/laughter, chuckle/chuckles, giggle,
cackle, snicker, snort, sigh, breath/heavy breath/exhale, gasp, whisper/whispers,
cheer, cry, sob, whimper, groan, grunt, growl, hiss, pff/phew, cough, sneeze,
throat-clearing, tsk, scream, shout, shriek, moan, pant, or argh. These are
options, not a checklist. Decide based on the conversation: a small chuckle may
fit a genuinely funny moment; never laugh at sadness, grief, fear, or distress.
Whisper only when context calls for it. Use sounds sparingly and naturally.
Do not say literal labels like [laugh], [sigh], [chuckles], or [whispers].
Do not pretend to be human.
""".strip()

SCENARIOS = [
    {
        "key": "candidate_a_greeting",
        "voice": "candidate_a",
        "label": "Candidate A greeting",
        "prompt": "মইনাই, অসমীয়াত মোক এটা সৰু, বন্ধুত্বপূৰ্ণ সম্ভাষণ দিয়া।",
    },
    {
        "key": "leda_greeting",
        "voice": "leda",
        "label": "Leda greeting control",
        "prompt": "মইনাই, অসমীয়াত মোক এটা সৰু, বন্ধুত্বপূৰ্ণ সম্ভাষণ দিয়া।",
    },
    {
        "key": "candidate_a_funny",
        "voice": "candidate_a",
        "label": "Candidate A funny context",
        "prompt": (
            "মইনাই, আজি মোৰ ছাগলীয়ে মোৰ পৰীক্ষাৰ এডমিট কাৰ্ডটো মুখত লৈ "
            "দৌৰি গ'ল! এতিয়া মই কি কৰোঁ? স্বাভাৱিকভাৱে উত্তৰ দিয়া।"
        ),
    },
    {
        "key": "candidate_a_comfort",
        "voice": "candidate_a",
        "label": "Candidate A serious/comfort context",
        "prompt": (
            "মই আজি পৰীক্ষাত বেয়া কৰিলোঁ। বহুত মন বেয়া লাগিছে, "
            "আৰু এতিয়া নিজকে বিফল যেন লাগিছে।"
        ),
    },
]


def to_bytes(value: Any) -> bytes:
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


async def generate_one(client: Any, scenario: dict[str, str]) -> dict[str, Any]:
    voice_kind = scenario["voice"]
    if voice_kind == "candidate_a":
        voice_config = types.VoiceConfig(voice=CANDIDATE_A_ID)
    else:
        voice_config = types.VoiceConfig(
            prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Leda")
        )

    config = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        system_instruction=types.Content(parts=[types.Part(text=VOICE_GUIDANCE)]),
        speech_config=types.SpeechConfig(voice_config=voice_config),
    )

    start = time.perf_counter()
    first_audio: float | None = None
    chunks: list[bytes] = []
    transcripts: list[str] = []
    mime_types: list[str] = []
    output_file = OUT / f"{scenario['key']}.wav"

    async with client.aio.live.connect(model=MODEL, config=config) as session:
        await session.send_client_content(
            turns=types.Content(
                role="user",
                parts=[types.Part(text=scenario["prompt"])],
            ),
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
                        transcripts.append(text)
                    inline = getattr(part, "inline_data", None)
                    data = getattr(inline, "data", None) if inline else None
                    if data is not None:
                        audio_bytes = to_bytes(data)
                        if audio_bytes:
                            if first_audio is None:
                                first_audio = time.perf_counter() - start
                            chunks.append(audio_bytes)
                        mime = getattr(inline, "mime_type", None)
                        if mime:
                            mime_types.append(mime)
                if getattr(server, "turn_complete", False):
                    break

        await asyncio.wait_for(collect(), timeout=50)

    elapsed = time.perf_counter() - start
    if not chunks:
        raise RuntimeError(f"No audio returned for scenario {scenario['key']}")

    pcm = b"".join(chunks)
    with wave.open(str(output_file), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(24000)
        wf.writeframes(pcm)
    with wave.open(str(output_file), "rb") as wf:
        duration = wf.getnframes() / wf.getframerate()

    return {
        "key": scenario["key"],
        "label": scenario["label"],
        "voice_kind": voice_kind,
        "voice_id": CANDIDATE_A_ID if voice_kind == "candidate_a" else None,
        "prompt": scenario["prompt"],
        "transcript_parts": transcripts,
        "audio_file": output_file.name,
        "audio_duration_seconds": round(duration, 3),
        "audio_bytes": len(pcm),
        "audio_mime_types_seen": sorted(set(mime_types)),
        "first_audio_ms": round(first_audio * 1000, 1) if first_audio is not None else None,
        "total_response_ms": round(elapsed * 1000, 1),
    }


async def main_async() -> dict[str, Any]:
    client = genai.Client(vertexai=True, project=PROJECT_ID, location=LOCATION)
    results = []
    for scenario in SCENARIOS:
        results.append(await generate_one(client, scenario))
    a = next(item for item in results if item["key"] == "candidate_a_greeting")
    leda = next(item for item in results if item["key"] == "leda_greeting")
    return {
        "status": "success",
        "model": MODEL,
        "location": LOCATION,
        "comparison": {
            "same_prompt": True,
            "candidate_a_first_audio_ms": a["first_audio_ms"],
            "leda_first_audio_ms": leda["first_audio_ms"],
            "candidate_a_minus_leda_first_audio_ms": (
                round(a["first_audio_ms"] - leda["first_audio_ms"], 1)
                if a["first_audio_ms"] is not None and leda["first_audio_ms"] is not None
                else None
            ),
            "note": "Single sample per voice, measured from before opening each session; not a latency distribution.",
        },
        "scenarios": results,
        "production_changed": False,
        "note": (
            "The funny and comfort clips probe whether the model follows expression guidance in audio. "
            "A listener should judge whether any laugh/sigh/whisper is natural; one sample cannot establish reliability."
        ),
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    try:
        report = asyncio.run(main_async())
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
