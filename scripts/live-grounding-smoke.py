#!/usr/bin/env python3
"""Synthetic production test of the real Live → web-tool → grounded-search path.

This sends a bounded text turn through the same public Live WebSocket and tool
handler used by normal voice. Using text deliberately isolates grounding/tool
execution from audio VAD and speech-recognition variability. It never prints the
assistant's transcript or any search query.
"""
import json
import os
import time

import websocket

BASE_URL = os.environ.get("BASE_URL", "https://askmoina-voice.thenewtongs.workers.dev").rstrip("/")
AUTH_COOKIE = os.environ.get("ASKMOINA_SYNTHETIC_COOKIE", "").strip()
PROMPT = (
    "Search the web for the latest official Android release. "
    "Tell me the version number, its release date, and the name of one official source."
)
SETUP_WAIT_SECONDS = 18
TURN_WAIT_SECONDS = 55


def extract_text(message: dict) -> str:
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
    for key in ("output_transcription", "outputTranscription"):
        item = message.get(key)
        if isinstance(item, dict) and isinstance(item.get("text"), str):
            texts.append(item["text"])
    return " ".join(texts)


def has_grounding_tool_call(message: dict) -> bool:
    for key in ("toolCall", "tool_call"):
        frame = message.get(key)
        if not isinstance(frame, dict):
            continue
        calls = frame.get("functionCalls") or frame.get("function_calls") or []
        if any(isinstance(call, dict) and call.get("name") == "search_current_web" for call in calls):
            return True
    calls = message.get("functionCalls") or message.get("function_calls") or []
    return any(isinstance(call, dict) and call.get("name") == "search_current_web" for call in calls)


def main() -> int:
    ws_url = BASE_URL.replace("https://", "wss://", 1) + "/api/voice/socket"
    if not ws_url.startswith("wss://"):
        raise RuntimeError("BASE_URL must use https://")
    if not AUTH_COOKIE.startswith("moina_session="):
        raise RuntimeError("Authenticated synthetic session missing; refusing anonymous voice access.")
    ws = websocket.create_connection(ws_url, origin=BASE_URL, timeout=12, enable_multithread=True, cookie=AUTH_COOKIE)
    tool_called = False
    transcript = ""
    turn_complete = False
    try:
        ws.send(json.dumps({"setup": {}}))
        setup_deadline = time.time() + SETUP_WAIT_SECONDS
        while time.time() < setup_deadline:
            try:
                message = json.loads(ws.recv())
            except websocket.WebSocketTimeoutException:
                continue
            if message.get("error"):
                raise RuntimeError("Vertex AI rejected the Live setup.")
            if message.get("setupComplete") or message.get("setup_complete"):
                break
        else:
            raise RuntimeError("Timed out waiting for Live setup completion.")

        # This is a synthetic text turn carried through the production Live
        # WebSocket, not a direct call to the grounding helper.
        ws.send(json.dumps({"text_input": PROMPT}))
        deadline = time.time() + TURN_WAIT_SECONDS
        while time.time() < deadline:
            try:
                message = json.loads(ws.recv())
            except websocket.WebSocketTimeoutException:
                continue
            if message.get("error"):
                raise RuntimeError("The Live session returned a protocol/provider error.")
            tool_called = tool_called or has_grounding_tool_call(message)
            transcript += " " + extract_text(message)
            content = message.get("serverContent") or message.get("server_content") or {}
            if isinstance(content, dict) and (content.get("turnComplete") or content.get("turn_complete")):
                turn_complete = True
                if tool_called:
                    break

        lowered = transcript.lower()
        if not tool_called:
            raise RuntimeError("Live API did not call search_current_web for the explicit current-information request.")
        if not turn_complete:
            raise RuntimeError("Timed out waiting for the grounded Live answer to complete.")
        if any(phrase in lowered for phrase in ("temporarily unavailable", "could not be verified", "no live search")):
            raise RuntimeError("Grounded search returned an unavailable/unverified response.")
        if "android" not in lowered:
            raise RuntimeError("Completed answer did not address the requested Android release.")
        if not any(word in lowered for word in ("source", "official", "developer", "blog", "release", "version")):
            raise RuntimeError("Completed answer did not state a version/release detail or source.")
        print("Synthetic live web grounding test: PASS (Live tool invoked and grounded answer completed).")
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
        print("Synthetic live web grounding test: FAIL (" + type(exc).__name__ + ": " + str(exc)[:200] + ")")
        raise SystemExit(1)
