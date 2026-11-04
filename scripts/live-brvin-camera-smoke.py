#!/usr/bin/env python3
"""Production synthetic for the camera Co-Pilot BRVIN retrieval path.

Creates a deterministic JPEG label fixture, sends it through the authenticated
camera Live session, and verifies that the answer reads the frame, cites BRVIN
physical PDF page 14, and produces spoken audio. Never prints transcripts or cookies.
"""
import base64
import io
import json
import os
import re
import time

from PIL import Image, ImageDraw, ImageFont
import websocket

BASE_URL = os.environ.get("BASE_URL", "https://askmoina-voice.thenewtongs.workers.dev").rstrip("/")
AUTH_COOKIE = os.environ.get("ASKMOINA_SYNTHETIC_COOKIE", "").strip()
PROMPT = (
    "Read the uppercase label shown in the latest camera frame and repeat it exactly. "
    "Then use the approved SSC BRVIN knowledge source to summarize physical PDF page 14. "
    "Cite the source book title and physical PDF page 14. Do not guess if either source is unavailable."
)


def make_camera_frame() -> str:
    image = Image.new("RGB", (480, 360), "white")
    draw = ImageDraw.Draw(image)
    try:
        title = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 27)
        body = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 23)
    except OSError:
        title = ImageFont.load_default()
        body = title
    draw.rectangle((8, 8, 472, 352), outline="black", width=4)
    draw.text((28, 65), "CAMERA BRVIN TEST", fill="black", font=title)
    draw.text((28, 155), "SSC STUDY BOOK", fill="black", font=body)
    draw.text((28, 198), "PDF PAGE 14", fill="black", font=title)
    output = io.BytesIO()
    image.save(output, format="JPEG", quality=60, optimize=True)
    encoded = base64.b64encode(output.getvalue()).decode("ascii")
    if len(encoded) > 48_000:
        raise RuntimeError("Generated camera fixture exceeded the bounded image size.")
    return encoded


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
        raise RuntimeError("Live WebSocket sent an invalid JSON text frame.") from None
    if not isinstance(message, dict):
        raise RuntimeError("Live WebSocket JSON message was not an object.")
    return message


def get_text(message: dict) -> str:
    collected = []
    for key in ("serverContent", "server_content"):
        content = message.get(key)
        if not isinstance(content, dict):
            continue
        for transcript_key in ("outputTranscription", "output_transcription"):
            item = content.get(transcript_key)
            if isinstance(item, dict) and isinstance(item.get("text"), str):
                collected.append(item["text"])
        for turn_key in ("modelTurn", "model_turn"):
            turn = content.get(turn_key)
            parts = turn.get("parts", []) if isinstance(turn, dict) else []
            if isinstance(parts, list):
                for part in parts:
                    if isinstance(part, dict) and isinstance(part.get("text"), str):
                        collected.append(part["text"])
    for key in ("output_transcription", "outputTranscription"):
        item = message.get(key)
        if isinstance(item, dict) and isinstance(item.get("text"), str):
            collected.append(item["text"])
    return " ".join(collected)


def get_audio_bytes(message: dict) -> int:
    total = 0
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
            data = inline.get("data")
            mime = str(inline.get("mimeType") or inline.get("mime_type") or "").lower()
            if isinstance(data, str) and data and mime.startswith("audio/"):
                try:
                    total += len(base64.b64decode(data, validate=True))
                except (ValueError, base64.binascii.Error):
                    continue
    return total


def main() -> int:
    if not BASE_URL.startswith("https://"):
        raise RuntimeError("Camera BRVIN smoke requires HTTPS.")
    if not AUTH_COOKIE.startswith("moina_session="):
        raise RuntimeError("Authenticated synthetic session is missing.")

    camera_frame = make_camera_frame()
    ws_url = BASE_URL.replace("https://", "wss://", 1) + "/api/voice/socket"
    ws = websocket.create_connection(
        ws_url, origin=BASE_URL, timeout=12, enable_multithread=True, cookie=AUTH_COOKIE
    )
    transcript = []
    audio_total = 0
    last_status = None
    last_keepalive_at = time.monotonic()
    try:
        ws.settimeout(0.5)
        ws.send(json.dumps({"setup": {}, "copilot_mode": True}))
        setup_complete = False
        setup_deadline = time.monotonic() + 20
        while time.monotonic() < setup_deadline:
            try:
                message = recv_json_message(ws)
            except websocket.WebSocketTimeoutException:
                continue
            if message is None:
                continue
            if message.get("error"):
                raise RuntimeError("The authenticated camera Live setup returned an error.")
            if message.get("setupComplete") or message.get("setup_complete"):
                setup_complete = True
                break
        if not setup_complete:
            raise RuntimeError("Timed out waiting for camera Co-Pilot setup.")

        # Co-Pilot mode accepts image/jpeg camera frames and uses explicit text turns.
        ws.send(json.dumps({
            "realtime_input": {"video": {"data": camera_frame, "mime_type": "image/jpeg"}}
        }))
        time.sleep(0.4)
        ws.send(json.dumps({"text_input": PROMPT}))

        complete_and_idle = False
        deadline = time.monotonic() + 95
        while time.monotonic() < deadline:
            try:
                message = recv_json_message(ws)
            except websocket.WebSocketTimeoutException:
                if time.monotonic() - last_keepalive_at >= 10:
                    ws.send(json.dumps({"keepalive": True}))
                    last_keepalive_at = time.monotonic()
                continue
            if message is None:
                continue
            if time.monotonic() - last_keepalive_at >= 10:
                ws.send(json.dumps({"keepalive": True}))
                last_keepalive_at = time.monotonic()
            if message.get("error"):
                raise RuntimeError("The camera Live session returned a provider error.")
            transcript.append(get_text(message))
            audio_total += get_audio_bytes(message)
            content = message.get("serverContent") or message.get("server_content") or {}
            if isinstance(content, dict):
                last_status = content.get("interactionStatus") or content.get("interaction_status")
                turn_complete = content.get("turnComplete") or content.get("turn_complete")
                if turn_complete and str(last_status).upper() == "IDLE":
                    complete_and_idle = True
                    break

        normalized = re.sub(r"\s+", " ", " ".join(transcript)).lower()
        has_camera_marker = "camera brvin test" in normalized
        has_book_citation = "fatman" in normalized
        has_page_citation = bool(re.search(r"(pdf\s*)?page\s*14\b", normalized))
        if not complete_and_idle:
            raise RuntimeError("Camera BRVIN response did not reach IDLE (status=" + str(last_status) + ").")
        if not has_camera_marker or not has_book_citation or not has_page_citation or audio_total <= 0:
            raise RuntimeError(
                "Camera BRVIN acceptance incomplete (cameraMarker=" + str(has_camera_marker) +
                ", bookCitation=" + str(has_book_citation) +
                ", page14Citation=" + str(has_page_citation) +
                ", generatedAudioBytes=" + str(audio_total) + ")."
            )
        print(json.dumps({
            "synthetic": "brvin_camera_copilot",
            "passed": True,
            "cameraMarker": True,
            "bookCitation": True,
            "physicalPdfPage14Citation": True,
            "generatedAudioBytes": audio_total,
        }))
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
        print("Synthetic camera BRVIN test: FAIL (" + type(exc).__name__ + ": " + str(exc)[:180] + ")")
        raise SystemExit(1)
