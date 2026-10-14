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
    "Use web search to check the latest official Android release. "
    "In one short sentence, give a version or release detail and name an official source."
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


def recv_json_message(ws):
    """Read JSON control frames while safely skipping separate binary audio frames.

    Gemini Live can interleave audio media frames with structured tool/control
    messages. Binary frames that are not JSON are media, not protocol errors.
    Malformed JSON text frames still fail loudly so protocol regressions remain visible.
    """
    frame = ws.recv()
    if frame == "":
        return None
    if isinstance(frame, bytes):
        try:
            frame_text = frame.decode("utf-8")
        except UnicodeDecodeError:
            return None
        try:
            message = json.loads(frame_text)
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
    prompts = [
        (
            "Use web search to verify the latest stable Android version from an official Android source. "
            "In one short sentence, give the current version or release detail and name the official source."
        ),
        (
            "Use web search to verify the latest stable Python release from python.org. "
            "In one short sentence, give the current version and name python.org as the source."
        ),
        (
            "Use web search to verify the latest stable Google Chrome desktop release from an official Chrome source. "
            "In one short sentence, give the current version or release detail and name the official source."
        ),
    ]
    completed_searches = 0
    try:
        ws.send(json.dumps({"setup": {}}))
        setup_deadline = time.time() + SETUP_WAIT_SECONDS
        while time.time() < setup_deadline:
            try:
                message = recv_json_message(ws)
                if message is None:
                    continue
            except websocket.WebSocketTimeoutException:
                continue
            if message.get("error"):
                raise RuntimeError("Vertex AI rejected the Live setup.")
            if message.get("setupComplete") or message.get("setup_complete"):
                break
        else:
            raise RuntimeError("Timed out waiting for Live setup completion.")

        # Exercise repeated searches in one real production session. Each explicit
        # current-information turn must invoke the web tool and receive a grounded answer
        # before the next turn begins; only status and counters are printed, never queries.
        for search_index, prompt in enumerate(prompts, start=1):
            ws.send(json.dumps({"text_input": prompt}))
            tool_called = False
            transcript = ""
            turn_complete = False
            deadline = time.time() + TURN_WAIT_SECONDS
            while time.time() < deadline:
                try:
                    message = recv_json_message(ws)
                    if message is None:
                        continue
                except websocket.WebSocketTimeoutException:
                    continue
                if message.get("error"):
                    raise RuntimeError(f"The Live session returned a protocol/provider error on search {search_index}.")
                message_has_tool_call = has_grounding_tool_call(message)
                tool_called = tool_called or message_has_tool_call
                transcript += " " + extract_text(message)
                content = message.get("serverContent") or message.get("server_content") or {}
                if (
                    isinstance(content, dict)
                    and (content.get("turnComplete") or content.get("turn_complete"))
                    and tool_called
                    and not message_has_tool_call
                ):
                    turn_complete = True
                    break

            lowered = transcript.lower()
            if not tool_called:
                raise RuntimeError(f"Live API did not call search_current_web for explicit search {search_index}.")
            if not turn_complete:
                raise RuntimeError(f"Timed out waiting for grounded answer {search_index} to complete.")
            if any(phrase in lowered for phrase in ("temporarily unavailable", "could not be verified", "no live search")):
                raise RuntimeError(f"Grounded search {search_index} returned an unavailable/unverified response.")
            if len(lowered.strip()) < 16:
                raise RuntimeError(f"Grounded answer {search_index} did not contain enough readable response text.")
            completed_searches += 1
            print(f"Synthetic grounded search {search_index}/3: PASS")

        print(f"Synthetic live web grounding test: PASS ({completed_searches} sequential searches in one authenticated Live session).")
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
