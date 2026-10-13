export type ParsedLiveClientInput =
  | { kind: "audio"; data: string }
  | { kind: "video"; data: string }
  | { kind: "text_input"; text: string }
  | { kind: "initial_greeting" }
  | { kind: "target_selection"; x: number; y: number }
  | { kind: "audio_stream_end" }
  | { kind: "tool_response"; responses: Array<{ id: string; name: "display_screen_overlay" | "display_response_card"; result: string }> };

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_MEDIA_BASE64_CHARS = 12_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * Parse the deliberately small browser-to-live-session protocol. Authenticated
 * voice and Co-Pilot sessions accept bounded text turns as well as PCM audio;
 * camera frames, target selection, and display-only tools remain Co-Pilot-only.
 */
export function parseLiveClientInput(value: unknown, copilotMode: boolean): ParsedLiveClientInput | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);

  if (keys.length === 1 && value.initial_greeting === true) {
    return copilotMode ? { kind: "initial_greeting" } : null;
  }

  if (keys.length === 1 && isRecord(value.tool_response)) {
    if (!copilotMode) return null;
    const rawResponses = value.tool_response.function_responses;
    if (!Array.isArray(rawResponses) || rawResponses.length < 1 || rawResponses.length > 4) return null;
    const responses: Array<{ id: string; name: "display_screen_overlay" | "display_response_card"; result: string }> = [];
    for (const rawResponse of rawResponses) {
      if (!isRecord(rawResponse)) return null;
      if (
        Object.keys(rawResponse).some((key) => key !== "id" && key !== "name" && key !== "response") ||
        typeof rawResponse.id !== "string" ||
        rawResponse.id.length < 1 ||
        rawResponse.id.length > 128 ||
        /[\u0000-\u001f\u007f]/.test(rawResponse.id) ||
        (rawResponse.name !== "display_screen_overlay" && rawResponse.name !== "display_response_card")
      ) return null;
      let result = rawResponse.name === "display_response_card"
        ? "The response-card payload passed the RC2 contract; visual rendering is not available in this release."
        : "The on-screen target prompt or approximate overlay was handled by the client.";
      if (rawResponse.response !== undefined) {
        if (!isRecord(rawResponse.response) ||
            Object.keys(rawResponse.response).some((key) => key !== "result") ||
            typeof rawResponse.response.result !== "string") return null;
        result = rawResponse.response.result;
      }
      if (
        result.length > 3_000 ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result)
      ) return null;
      responses.push({ id: rawResponse.id, name: rawResponse.name, result });
    }
    return { kind: "tool_response", responses };
  }

  if (keys.length === 1 && isRecord(value.target_selection)) {
    if (!copilotMode) return null;
    const selection = value.target_selection;
    if (
      Object.keys(selection).some((key) => key !== "x" && key !== "y") ||
      typeof selection.x !== "number" ||
      typeof selection.y !== "number" ||
      !Number.isFinite(selection.x) ||
      !Number.isFinite(selection.y) ||
      selection.x < 0 || selection.x >= 1 ||
      selection.y < 0 || selection.y >= 1
    ) return null;
    return { kind: "target_selection", x: selection.x, y: selection.y };
  }

  if (keys.length === 1 && typeof value.text_input === "string") {
    const text = value.text_input.trim();
    if (
      !text ||
      text.length > 1_500 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)
    ) return null;
    return { kind: "text_input", text };
  }

  if (keys.length !== 1 || !isRecord(value.realtime_input)) return null;
  const realtimeInput = value.realtime_input;
  const inputKeys = Object.keys(realtimeInput);
  if (inputKeys.length !== 1) return null;

  if (inputKeys[0] === "audio_stream_end" && realtimeInput.audio_stream_end === true) {
    return { kind: "audio_stream_end" };
  }

  const isVideo = inputKeys[0] === "video";
  if (!isVideo && inputKeys[0] !== "audio") return null;
  if (isVideo && !copilotMode) return null;

  const media = isRecord(realtimeInput[isVideo ? "video" : "audio"])
    ? realtimeInput[isVideo ? "video" : "audio"] as Record<string, unknown>
    : null;
  if (!media) return null;
  if (Object.keys(media).some((key) => key !== "data" && key !== "mime_type")) return null;
  if (typeof media.data !== "string" || media.data.length < 4 || media.data.length > MAX_MEDIA_BASE64_CHARS) return null;
  if (!BASE64_PATTERN.test(media.data)) return null;
  if (media.mime_type !== (isVideo ? "image/jpeg" : "audio/pcm;rate=16000")) return null;
  return { kind: isVideo ? "video" : "audio", data: media.data };
}
