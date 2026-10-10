import type { Env } from "../config/env";
import { getGoogleAccessToken } from "../auth/google";
import { buildPersonalizedSystemInstruction } from "./memory-context";
import { SYSTEM_INSTRUCTION } from "./assistant-instruction";

export const TTS_PROTOTYPE_VOICE_ID = "voice_6f4c602c-c79d-4a54-9bb1-c1549aab9c05";
export const TTS_PROTOTYPE_CONVERSATION_MODEL = "gemini-3.8-flash";
export const TTS_PROTOTYPE_SPEECH_MODEL = "gemini-3.8-flash-tts";
export const TTS_PROTOTYPE_MAX_AUDIO_BASE64_CHARS = 1_000_000;
const MAX_HISTORY_ITEMS = 12;
const MAX_HISTORY_TEXT_CHARS = 1_200;
const MAX_MEMORY_CONTEXT_CHARS = 3_000;

export interface TtsPrototypeHistoryItem {
  role: "user" | "model";
  text: string;
}

export interface TtsPrototypeInput {
  audioWavBase64: string;
  history: TtsPrototypeHistoryItem[];
  memoryContext: string;
}

export interface TtsPrototypeResult {
  userTranscript: string;
  reply: string;
  audioWavBase64: string;
  audioMimeType: string;
  voiceId: string;
  timings: {
    conversationMs: number;
    speechSynthesisMs: number;
    totalMs: number;
  };
}

export class TtsPrototypeError extends Error {
  constructor(
    readonly code: string,
    readonly status?: number,
  ) {
    super(code);
    this.name = "TtsPrototypeError";
  }
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type TokenProvider = (env: Env) => Promise<string>;

export function normalizeTtsPrototypeInput(value: unknown): TtsPrototypeInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TtsPrototypeError("invalid_request", 400);
  }

  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["audio_wav_base64", "history", "memory_context"].includes(key))) {
    throw new TtsPrototypeError("invalid_request", 400);
  }

  const audioWavBase64 = input.audio_wav_base64;
  if (
    typeof audioWavBase64 !== "string" ||
    audioWavBase64.length < 60 ||
    audioWavBase64.length > TTS_PROTOTYPE_MAX_AUDIO_BASE64_CHARS ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(audioWavBase64)
  ) {
    throw new TtsPrototypeError("invalid_audio", 400);
  }

  let header: string;
  try {
    header = atob(audioWavBase64.slice(0, 64));
  } catch {
    throw new TtsPrototypeError("invalid_audio", 400);
  }
  if (header.slice(0, 4) !== "RIFF" || header.slice(8, 12) !== "WAVE") {
    throw new TtsPrototypeError("audio_must_be_wav", 400);
  }

  const rawHistory = input.history === undefined ? [] : input.history;
  if (!Array.isArray(rawHistory) || rawHistory.length > MAX_HISTORY_ITEMS) {
    throw new TtsPrototypeError("invalid_history", 400);
  }

  const history: TtsPrototypeHistoryItem[] = [];
  let historyChars = 0;
  for (const item of rawHistory) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new TtsPrototypeError("invalid_history", 400);
    }
    const candidate = item as Record<string, unknown>;
    if (
      Object.keys(candidate).some((key) => !["role", "text"].includes(key)) ||
      (candidate.role !== "user" && candidate.role !== "model") ||
      typeof candidate.text !== "string"
    ) {
      throw new TtsPrototypeError("invalid_history", 400);
    }
    const text = candidate.text.trim().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, MAX_HISTORY_TEXT_CHARS);
    if (!text) continue;
    historyChars += text.length;
    if (historyChars > 6_000) throw new TtsPrototypeError("history_too_large", 400);
    history.push({ role: candidate.role, text });
  }

  const memoryContext = typeof input.memory_context === "string"
    ? input.memory_context.trim().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, MAX_MEMORY_CONTEXT_CHARS)
    : "";
  if (input.memory_context !== undefined && typeof input.memory_context !== "string") {
    throw new TtsPrototypeError("invalid_memory_context", 400);
  }

  return { audioWavBase64, history, memoryContext };
}

function modelText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || !candidates[0] || typeof candidates[0] !== "object") return "";
  const content = (candidates[0] as { content?: { parts?: unknown } }).content;
  if (!content || !Array.isArray(content.parts)) return "";
  return content.parts
    .filter((part): part is { text: string } => Boolean(part) && typeof part === "object" && typeof (part as { text?: unknown }).text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function parseConversationResult(text: string): { userTranscript: string; reply: string; vocalStyle: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) throw new TtsPrototypeError("conversation_response_invalid", 502);
    try {
      value = JSON.parse(text.slice(start, end + 1));
    } catch {
      throw new TtsPrototypeError("conversation_response_invalid", 502);
    }
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TtsPrototypeError("conversation_response_invalid", 502);
  }
  const parsed = value as Record<string, unknown>;
  const userTranscript = typeof parsed.userTranscript === "string" ? parsed.userTranscript.trim().slice(0, 2_000) : "";
  const reply = typeof parsed.reply === "string" ? parsed.reply.trim().slice(0, 4_000) : "";
  const vocalStyle = typeof parsed.vocalStyle === "string" ? parsed.vocalStyle.trim().slice(0, 240) : "";
  if (!userTranscript || !reply) throw new TtsPrototypeError("conversation_response_invalid", 502);
  return {
    userTranscript,
    reply,
    vocalStyle: vocalStyle || "natural, warm, clear conversational delivery",
  };
}

function inlineAudio(payload: unknown): { data: string; mimeType: string } | null {
  if (!payload || typeof payload !== "object") return null;
  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || !candidates[0] || typeof candidates[0] !== "object") return null;
  const content = (candidates[0] as { content?: { parts?: unknown } }).content;
  if (!content || !Array.isArray(content.parts)) return null;
  for (const part of content.parts) {
    if (!part || typeof part !== "object") continue;
    const item = part as { inlineData?: { data?: unknown; mimeType?: unknown }; inline_data?: { data?: unknown; mime_type?: unknown } };
    const audio = item.inlineData ?? item.inline_data;
    if (audio && typeof audio.data === "string" && audio.data.length > 0) {
      const mimeType = typeof audio.mimeType === "string" ? audio.mimeType : typeof audio.mime_type === "string" ? audio.mime_type : "audio/wav";
      if (mimeType.toLowerCase().startsWith("audio/")) return { data: audio.data, mimeType };
    }
  }
  return null;
}

export async function generateTtsPrototypeTurn(
  env: Env,
  input: TtsPrototypeInput,
  options: {
    fetchImpl?: FetchLike;
    tokenProvider?: TokenProvider;
    signal?: AbortSignal;
  } = {},
): Promise<TtsPrototypeResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const tokenProvider = options.tokenProvider ?? getGoogleAccessToken;
  const startedAt = Date.now();
  const projectId = env.GCP_PROJECT_ID?.trim();
  if (!projectId) throw new TtsPrototypeError("project_not_configured", 503);

  const accessToken = await tokenProvider(env);
  const baseUrl = `https://aiplatform.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/locations/global/publishers/google/models/`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  const recentHistory = input.history.slice(-MAX_HISTORY_ITEMS).map((item) => ({
    role: item.role,
    parts: [{ text: item.text }],
  }));
  const audioInstruction = [
    "Listen to the user's audio, transcribe what they actually said, and respond conversationally to that utterance.",
    "Respond in the language the user spoke. For Assamese, use clear, natural conversational Assamese; preserve natural Assamese-English code-switching.",
    "The reply must be concise and spoken naturally, like a warm voice companion for Assam. Do not claim personal experiences.",
    "Return only JSON with exactly these fields: userTranscript (the user's words, written in their language), reply (the response to speak), and vocalStyle (a brief, context-aware delivery direction for speech synthesis).",
    "Do not include markdown fences or any text outside the JSON.",
  ].join("\n");

  let conversationResponse: Response;
  try {
    conversationResponse = await fetchImpl(`${baseUrl}${TTS_PROTOTYPE_CONVERSATION_MODEL}:generateContent`, {
      method: "POST",
      headers,
      signal: options.signal,
      body: JSON.stringify({
        systemInstruction: {
          parts: [{
            text: buildPersonalizedSystemInstruction(SYSTEM_INSTRUCTION, input.memoryContext) +
              "\n\nFor this prototype, produce text suitable for the assistant's next spoken turn. Avoid verbose explanations.",
          }],
        },
        contents: [
          ...recentHistory,
          {
            role: "user",
            parts: [
              { text: audioInstruction },
              { inlineData: { mimeType: "audio/wav", data: input.audioWavBase64 } },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              userTranscript: { type: "STRING" },
              reply: { type: "STRING" },
              vocalStyle: { type: "STRING" },
            },
            required: ["userTranscript", "reply", "vocalStyle"],
          },
          maxOutputTokens: 512,
          temperature: 0.7,
        },
      }),
    });
  } catch (error) {
    if (options.signal?.aborted) throw new TtsPrototypeError("request_cancelled", 499);
    throw new TtsPrototypeError("conversation_request_failed", 502);
  }
  if (!conversationResponse.ok) throw new TtsPrototypeError("conversation_model_failed", 502);
  const conversationPayload = await conversationResponse.json().catch(() => null);
  const parsed = parseConversationResult(modelText(conversationPayload));
  const conversationMs = Date.now() - startedAt;

  if (options.signal?.aborted) throw new TtsPrototypeError("request_cancelled", 499);
  const voiceId = env.TTS_PROTOTYPE_VOICE_ID?.trim() || TTS_PROTOTYPE_VOICE_ID;
  const speechStyle = [
    "Keep Moina's designed baseline voice light, bright, sweet, crisp, gently airy, and warm.",
    "Do not exaggerate pitch, breathiness, or emotion. Keep pronunciation clear and conversational.",
    `Delivery for this turn: ${parsed.vocalStyle}.`,
  ].join(" ");

  let speechResponse: Response;
  const speechStartedAt = Date.now();
  try {
    speechResponse = await fetchImpl(`${baseUrl}${TTS_PROTOTYPE_SPEECH_MODEL}:generateContent`, {
      method: "POST",
      headers,
      signal: options.signal,
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [{
            text: parsed.reply,
            speechMetadata: { style: speechStyle },
          }],
        }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { voice: voiceId },
          },
        },
      }),
    });
  } catch {
    if (options.signal?.aborted) throw new TtsPrototypeError("request_cancelled", 499);
    throw new TtsPrototypeError("speech_request_failed", 502);
  }
  if (!speechResponse.ok) throw new TtsPrototypeError("speech_model_failed", 502);
  const speechPayload = await speechResponse.json().catch(() => null);
  const audio = inlineAudio(speechPayload);
  if (!audio) throw new TtsPrototypeError("speech_audio_missing", 502);

  return {
    userTranscript: parsed.userTranscript,
    reply: parsed.reply,
    audioWavBase64: audio.data,
    audioMimeType: audio.mimeType || "audio/wav",
    voiceId,
    timings: {
      conversationMs,
      speechSynthesisMs: Date.now() - speechStartedAt,
      totalMs: Date.now() - startedAt,
    },
  };
}
