export type ParsedLiveClientInput =
  | { kind: "audio"; data: string }
  | { kind: "video"; data: string }
  | { kind: "audio_stream_end" }
  | { kind: "tool_response"; ids: string[] };

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_MEDIA_BASE64_CHARS = 12_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * Parse the deliberately small browser-to-live-session protocol. Normal voice
 * sessions can send PCM audio only; the camera and the one display-only tool
 * are available only when the server accepted copilot_mode during setup.
 */
export function parseLiveClientInput(value: unknown, copilotMode: boolean): ParsedLiveClientInput | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);

  if (keys.length === 1 && isRecord(value.tool_response)) {
    if (!copilotMode) return null;
    const rawResponses = value.tool_response.function_responses;
    if (!Array.isArray(rawResponses) || rawResponses.length < 1 || rawResponses.length > 4) return null;
    const ids: string[] = [];
    for (const rawResponse of rawResponses) {
      if (!isRecord(rawResponse)) return null;
      if (
        Object.keys(rawResponse).some((key) => key !== "id" && key !== "name") ||
        typeof rawResponse.id !== "string" ||
        rawResponse.id.length < 1 ||
        rawResponse.id.length > 128 ||
        /[\u0000-\u001f\u007f]/.test(rawResponse.id) ||
        rawResponse.name !== "display_screen_overlay"
      ) return null;
      ids.push(rawResponse.id);
    }
    return { kind: "tool_response", ids };
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
