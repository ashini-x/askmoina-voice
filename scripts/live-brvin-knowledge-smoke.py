#!/usr/bin/env python3
"""Production synthetic for AskMoina Gemini Live -> BRVIN v2 exact-page retrieval.

Uses the normal authenticated Live WebSocket and the server-side Gemini function
handler. The raw function call is deliberately hidden from the browser relay;
the acceptance condition is the resulting answer with BRVIN's book/PDF-page
citation. No transcript, prompt or user data is printed.
"""
import json
import os
import re
import time

import websocket

BASE_URL = os.environ.get("BASE_URL", "https://askmoina-voice.thenewtongs.workers.dev").rstrip("/")
AUTH_COOKIE = os.environ.get("ASKMOINA_SYNTHETIC_COOKIE", "").strip()
PROMPT = (
    "In my approved SSC study book, summarize the contents of physical PDF page 14. "
    "Use the BRVIN knowledge source for the exact page. Keep the explanation concise, "
    "and cite the book title and physical PDF page. Do not use web search or guess if "
    "the source page is unavailable."
)
SETUP_WAIT_SECONDS = 20
TURN_WAIT_SECONDS = 85


def recv_json_message(ws):
    """Skip interleaved binary audio frames while preserving strict JSON control parsing."""
    frame = ws.recv()
    if frame == "":
        return None
    if isinstance(frame, bytes):
        try:
            frame = frame.decode("utf-8")
        except UnicodeDecodeError:
            return None
        try:
            message = json.loads(frame)
        except json.JSONDecodeError:
            return None
    else:
        try:
            message = json.loads(frame)
        except json.JSONDecodeError:
            raise RuntimeError("Live WebSocket sent an invalid JSON text frame.") from None
    if not isinstance(message, dict):
        raise RuntimeError("Live WebSocket JSON message was not an object.")
    return message


def extract_text(message: dict) -> str:
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
    for transcript_key in ("output_transcription", "outputTranscription"):
        item = message.get(transcript_key)
        if isinstance(item, dict) and isinstance(item.get("text"), str):
            collected.append(item["text"])
    return " ".join(collected)


def turn_complete(message: dict) -> bool:
    content = message.get("serverContent") or message.get("server_content") or {}
    return isinstance(content, dict) and bool(content.get("turnComplete") or content.get("turn_complete"))


def main() -> int:
    if not BASE_URL.startswith("https://"):
        raise RuntimeError("Production BRVIN smoke requires HTTPS.")
    if not AUTH_COOKIE.startswith("moina_session="):
        raise RuntimeError("Authenticated synthetic session is missing.")

    ws_url = BASE_URL.replace("https://", "wss://", 1) + "/api/voice/socket"
    ws = websocket.create_connection(
        ws_url,
        origin=BASE_URL,
        timeout=12,
        enable_multithread=True,
        cookie=AUTH_COOKIE,
    )
    transcript_parts = []
    messages_seen = 0
    completed_turns = 0
    last_keepalive = time.monotonic()
    try:
        ws.send(json.dumps({"setup": {}}))
        setup_deadline = time.time() + SETUP_WAIT_SECONDS
        while time.time() < setup_deadline:
            try:
                message = recv_json_message(ws)
            except websocket.WebSocketTimeoutException:
                continue
            if message is None:
                continue
            if message.get("error"):
                raise RuntimeError("The Live provider rejected BRVIN smoke setup.")
            if message.get("setupComplete") or message.get("setup_complete"):
                break
        else:
            raise RuntimeError("Timed out waiting for authenticated Live setup.")

        # An explicitly numbered physical PDF page is the unambiguous exact-page
        # path. This should invoke search_brvin_knowledge with page_numbers=[14].
        ws.send(json.dumps({"text_input": PROMPT}))
        deadline = time.time() + TURN_WAIT_SECONDS
        while time.time() < deadline:
            try:
                message = recv_json_message(ws)
            except websocket.WebSocketTimeoutException:
                if time.monotonic() - last_keepalive >= 10:
                    ws.send(json.dumps({"keepalive": True}))
                    last_keepalive = time.monotonic()
                continue
            if message is None:
                if time.monotonic() - last_keepalive >= 10:
                    ws.send(json.dumps({"keepalive": True}))
                    last_keepalive = time.monotonic()
                continue

            messages_seen += 1
            if time.monotonic() - last_keepalive >= 10:
                ws.send(json.dumps({"keepalive": True}))
                last_keepalive = time.monotonic()
            if message.get("error"):
                raise RuntimeError("The authenticated Live session returned a provider error.")

            answer = extract_text(message).strip()
            if answer:
                transcript_parts.append(answer)
            if turn_complete(message):
                completed_turns += 1
                normalized = re.sub(r"\s+", " ", " ".join(transcript_parts)).lower()
                has_book = "fatman" in normalized
                has_page_citation = bool(re.search(r"(pdf\s*)?page\s*14\b", normalized))
                has_substantive_answer = len(normalized) >= 80
                if has_book and has_page_citation and has_substantive_answer:
                    print(json.dumps({
                        "synthetic": "brvin_exact_page",
                        "passed": True,
                        "messages": messages_seen,
                        "completedTurns": completed_turns,
                        "bookCitation": True,
                        "physicalPdfPage14Citation": True,
                    }))
                    return 0

        normalized = re.sub(r"\s+", " ", " ".join(transcript_parts)).lower()
        raise RuntimeError(
            "The BRVIN exact-page answer did not provide the required book/PDF-page citation "
            "(messages=" + str(messages_seen) +
            ", completedTurns=" + str(completed_turns) +
            ", bookCitation=" + str("fatman" in normalized) +
            ", page14Citation=" + str(bool(re.search(r"(pdf\s*)?page\s*14\b", normalized))) +
            ", transcriptChars=" + str(len(normalized)) + ")."
        )
    finally:
        try:
            ws.close()
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
