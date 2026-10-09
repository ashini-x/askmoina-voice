#!/usr/bin/env python3
"""Short production voice smoke test with synthesized, non-user speech.

The test sends a synthetic question and a selected-memory context through the
public Worker. It prints only pass/fail status, never the returned transcript.
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
PROMPT = "Please tell me the name I asked you to call me."
MEMORY = "My name is Raaz, so call me Raaz when you interact with me."
MAX_WAIT_SECONDS = 35


def synthesize_pcm_16k() -> bytes:
    with tempfile.NamedTemporaryFile(suffix=".wav") as wav:
        subprocess.run(
            ["espeak-ng", "-v", "en-us", "-s", "135", "-w", wav.name, PROMPT],
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
        return bytes(output)


def get_text(message: dict) -> str:
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


def main() -> int:
    base_origin = BASE_URL
    ws_url = BASE_URL.replace("https://", "wss://", 1) + "/api/voice/socket"
    if ws_url == BASE_URL + "/api/voice/socket":
        raise RuntimeError("BASE_URL must use https://")
    pcm = synthesize_pcm_16k()
    ws = websocket.create_connection(ws_url, origin=base_origin, timeout=12, enable_multithread=True)
    try:
        ws.send(json.dumps({"setup": {}, "memory_context": MEMORY}))
        setup_deadline = time.time() + 18
        while time.time() < setup_deadline:
            try:
                msg = json.loads(ws.recv())
            except websocket.WebSocketTimeoutException:
                continue
            if msg.get("error"):
                raise RuntimeError("Vertex AI rejected the voice setup.")
            if msg.get("setupComplete") or msg.get("setup_complete"):
                break
        else:
            raise RuntimeError("Timed out waiting for Vertex AI setup completion.")

        # Stream 100 ms chunks, matching the browser's 16 kHz mono PCM protocol.
        chunk_bytes = 1600 * 2
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
            time.sleep(0.07)
        ws.send(json.dumps({"realtime_input": {"audio_stream_end": True}}))

        transcript = ""
        turn_complete = False
        deadline = time.time() + MAX_WAIT_SECONDS
        while time.time() < deadline:
            try:
                msg = json.loads(ws.recv())
            except websocket.WebSocketTimeoutException:
                continue
            if msg.get("error"):
                raise RuntimeError("The live voice session returned an error.")
            transcript += " " + get_text(msg)
            content = msg.get("serverContent") or msg.get("server_content") or {}
            if isinstance(content, dict) and (content.get("turnComplete") or content.get("turn_complete")):
                turn_complete = True
                if "raaz" in transcript.lower():
                    break
        if "raaz" in transcript.lower():
            print("Synthetic live voice memory test: PASS (reply transcript used the selected name).")
            return 0
        if not turn_complete:
            raise RuntimeError("Timed out waiting for a completed model reply.")
        raise RuntimeError("The live reply transcript did not contain the selected memory name.")
    finally:
        try:
            ws.close()
        except Exception:
            pass


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        # Avoid dumping raw model transcripts, HTTP payloads, or credentials into CI logs.
        print("Synthetic live voice memory test: FAIL (" + type(exc).__name__ + ": " + str(exc)[:180] + ")")
        raise SystemExit(1)
