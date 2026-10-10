#!/usr/bin/env python3
"""Generate a small, isolated Gemini 3.8 TTS voice-design benchmark.

This script is intentionally separate from the production Worker. It requires
Google Application Default Credentials for the same Vertex AI project and writes
audio samples and a non-secret JSON report into tts-benchmark-output/.
"""
from __future__ import annotations

import base64
import json
import os
import time
import wave
from pathlib import Path
from typing import Any

from google import genai

OUT = Path("tts-benchmark-output")
PROJECT_ID = os.environ["GCP_PROJECT_ID"]
MODEL_FLASH = "gemini-3.8-flash-tts"
MODEL_LITE = "gemini-3.8-flash-lite-tts"

VOICE_DESIGNS = [
    {
        "key": "C",
        "display_name": "Moina Sweet Voice C - Soft and Unforced",
        "prompt": (
            "A naturally sweet, light male speaking voice with a gentle, slightly high "
            "register. Soft, smooth and warm, with delicate airy quality and rounded "
            "resonance. The delivery feels relaxed and effortless, like speaking to a "
            "friend: clear and bright without pushing the pitch, over-enunciating, or "
            "putting on a sugary or theatrical sweetness."
        ),
    },
]

ASSAMESE_BASELINE = "অ’! মই ম’ইনা। তোমাৰ লগত কথা পাতি ভাল লাগিল!"
ASSAMESE_EXCITED = "আজি এটা মজাৰ কথা কওঁ নেকি? <short pause> শুনা, এইটো বৰ ভাল লাগিব! <chuckle>"
ASSAMESE_CALM = "একো চিন্তা নকৰিবা। লাহে লাহে কৰিলেই হ’ব।"
ENGLISH_CONTROL = "Hey! I'm Moina! Guess what? I've got something fun to tell you!"


def audio_bytes(data: Any) -> bytes:
    if isinstance(data, bytes):
        return data
    if isinstance(data, bytearray):
        return bytes(data)
    if isinstance(data, str):
        return base64.b64decode(data)
    raise TypeError(f"Unexpected audio data type: {type(data).__name__}")


def save_voice_design_sample(sample_audio: Any, output_path: Path) -> None:
    """Voice design samples may be headerless 24-kHz 16-bit mono PCM."""
    data = audio_bytes(sample_audio.data)
    mime = (getattr(sample_audio, "mime_type", "") or "").lower()
    if mime.startswith("audio/l16") or mime.startswith("audio/pcm"):
        with wave.open(str(output_path), "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(24000)
            wf.writeframes(data)
    else:
        output_path.write_bytes(data)


def wav_metadata(path: Path) -> dict[str, Any]:
    result: dict[str, Any] = {"bytes": path.stat().st_size}
    try:
        with wave.open(str(path), "rb") as wf:
            result.update({
                "duration_seconds": round(wf.getnframes() / wf.getframerate(), 3),
                "sample_rate_hz": wf.getframerate(),
                "channels": wf.getnchannels(),
                "sample_width_bytes": wf.getsampwidth(),
            })
    except (wave.Error, EOFError):
        result["wav_metadata"] = "could_not_parse"
    return result


def json_safe(value: Any) -> Any:
    """Convert nested SDK/Pydantic metadata to plain JSON-serializable values."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    model_dump = getattr(value, "model_dump", None)
    if callable(model_dump):
        try:
            return json_safe(model_dump(mode="json"))
        except (TypeError, ValueError):
            pass
    enum_value = getattr(value, "value", None)
    if enum_value is not None and enum_value is not value:
        return json_safe(enum_value)
    # Keep a useful diagnostic representation if an SDK type is unfamiliar.
    return str(value)


def token_usage(response: Any) -> dict[str, Any]:
    usage = getattr(response, "usage_metadata", None)
    if usage is None:
        return {}
    output: dict[str, Any] = {}
    for field in (
        "prompt_token_count",
        "candidates_token_count",
        "total_token_count",
        "prompt_tokens_details",
        "candidates_tokens_details",
    ):
        value = getattr(usage, field, None)
        if value is not None:
            output[field] = json_safe(value)
    return output


def get_audio_from_response(response: Any) -> bytes:
    candidates = getattr(response, "candidates", None) or []
    for candidate in candidates:
        content = getattr(candidate, "content", None)
        for part in (getattr(content, "parts", None) or []):
            inline = getattr(part, "inline_data", None)
            if inline is not None and getattr(inline, "data", None) is not None:
                return audio_bytes(inline.data)
    raise RuntimeError("TTS response contained no inline audio data")


def generate_clip(
    client: Any,
    model: str,
    voice_id: str,
    text: str,
    output_name: str,
    style: str | None = None,
) -> dict[str, Any]:
    part: dict[str, Any] = {"text": text}
    if style:
        part["speech_metadata"] = {"style": style}
    started = time.perf_counter()
    response = client.models.generate_content(
        model=model,
        contents=[{"role": "user", "parts": [part]}],
        config={
            "response_modalities": ["AUDIO"],
            "speech_config": {"voice_config": {"voice": voice_id}},
        },
    )
    elapsed = time.perf_counter() - started
    output_path = OUT / output_name
    output_path.write_bytes(get_audio_from_response(response))
    return {
        "file": output_name,
        "model": model,
        "voice_id": voice_id,
        "elapsed_seconds": round(elapsed, 3),
        "style": style or "baseline (no style direction)",
        **wav_metadata(output_path),
        "usage": token_usage(response),
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    client = genai.Client(enterprise=True, project=PROJECT_ID, location="global")
    report: dict[str, Any] = {
        "project_id": PROJECT_ID,
        "model_flash": MODEL_FLASH,
        "model_lite": MODEL_LITE,
        "note": (
            "Single-candidate refinement focused on softer, effortless sweetness. "
            "Only one Assamese baseline and one English control clip are generated to "
            "minimize billable calls. Assamese naturalness requires native-speaker listening."
        ),
        "voice_designs": [],
        "voice_design_failures": [],
        "clips": [],
        "multi_speaker": None,
    }

    voice_ids: dict[str, str] = {}
    for design in VOICE_DESIGNS:
        try:
            started = time.perf_counter()
            voice = client.voices.create(
                store=True,
                voice={
                    "type": "VOICE_TYPE_PROMPTED",
                    "display_name": design["display_name"],
                    "gender": "male",
                    "prompted": {"input": design["prompt"]},
                },
                timeout=60,
            )
            elapsed = time.perf_counter() - started
            if not getattr(voice, "id", None) or getattr(voice, "sample_audio", None) is None:
                raise RuntimeError("Voice API response did not contain both an ID and sample audio.")
            voice_ids[design["key"]] = voice.id
            sample_name = f"voice_{design['key']}_design_sample.wav"
            save_voice_design_sample(voice.sample_audio, OUT / sample_name)
            report["voice_designs"].append({
                "key": design["key"],
                "display_name": design["display_name"],
                "voice_id": voice.id,
                "prompt": design["prompt"],
                "create_elapsed_seconds": round(elapsed, 3),
                "sample_file": sample_name,
                **wav_metadata(OUT / sample_name),
                "usage": json_safe(getattr(voice, "usage", None)),
            })
        except Exception as exc:
            report["voice_design_failures"].append({
                "key": design["key"],
                "display_name": design["display_name"],
                "error_type": type(exc).__name__,
                "error": str(exc)[:1200],
            })
            print(f"Voice candidate {design['key']} failed ({type(exc).__name__}); continuing with any successful candidates.")

    if not voice_ids:
        report_path = OUT / "benchmark-report.json"
        report_path.write_text(json.dumps(json_safe(report), ensure_ascii=False, indent=2), encoding="utf-8")
        raise RuntimeError("No voice candidates were created successfully; see benchmark-report.json.")

    candidate_key, candidate_voice_id = next(iter(voice_ids.items()))
    report["clips"].append(generate_clip(
        client, MODEL_FLASH, candidate_voice_id, ASSAMESE_BASELINE,
        f"voice_{candidate_key}_assamese_baseline_flash.wav",
    ))
    report["clips"].append(generate_clip(
        client, MODEL_FLASH, candidate_voice_id, ENGLISH_CONTROL,
        f"voice_{candidate_key}_english_control_flash.wav",
    ))
    report["multi_speaker"] = {
        "status": "not_run",
        "reason": "This refinement tests voice quality only; skipped extra paid comparison calls.",
    }

    report_path = OUT / "benchmark-report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "status": "completed",
        "report": str(report_path),
        "designed_voice_ids": voice_ids,
        "clips_generated": len(report["clips"]) + 1,
        "voice_design_samples": len(report["voice_designs"]),
        "voice_design_failures": len(report["voice_design_failures"]),
        "project_id": PROJECT_ID,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
