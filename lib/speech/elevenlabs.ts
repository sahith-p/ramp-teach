/**
 * ElevenLabs speech to text (the real voice path, mode "real").
 *
 * Batch transcription, Scribe v2:
 *   POST https://api.elevenlabs.io/v1/speech-to-text            (multipart/form-data, header `xi-api-key`)
 *     model_id=scribe_v2  file=<audio>  timestamps_granularity=word  tag_audio_events=false
 *     language_code=<ISO-639-1/3, optional>  keyterms=<term> (repeated field, one per term)
 *   200 -> { language_code, language_probability, text, words: [{ text, start, end, type, speaker_id?, logprob,
 *            characters? }], transcription_id?, audio_duration_secs? }
 *   words[].type is "word" | "spacing" | "audio_event"; logprob is in [-inf, 0] (higher = more confident).
 *   Docs: https://elevenlabs.io/docs/api-reference/speech-to-text/convert
 *
 * Single-use token for client-side Realtime streaming (Scribe v2 Realtime):
 *   POST https://api.elevenlabs.io/v1/single-use-token/realtime_scribe   (header `xi-api-key`) -> { token }
 *   The token expires after 15 minutes and is consumed on use. The browser then opens
 *   wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=scribe_v2_realtime&token=...&audio_format=pcm_16000
 *     &commit_strategy=vad&keyterms=...   and sends {message_type:"input_audio_chunk", audio_base_64, commit, sample_rate};
 *   it receives {message_type:"partial_transcript"|"committed_transcript", text}.
 *   Docs: https://elevenlabs.io/docs/api-reference/tokens/create
 *         https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime
 *
 * elevenlabs.io was not reachable from the build session, so every field name above was checked against the
 * official SDK generated from ElevenLabs' API definition (@elevenlabs/elevenlabs-js 2.77.0:
 * api/resources/speechToText/client/Client.js, api/types/SpeechToTextChunkResponseModel.d.ts,
 * api/types/SpeechToTextWordResponseModel.d.ts, api/resources/tokens/resources/singleUse/client/Client.js,
 * wrapper/realtime/scribe.js + connection.js). The SDK reads the request id from the `x-request-id` header.
 *
 * The key comes from process.env.ELEVENLABS_API_KEY only. It is never logged or returned.
 */
import type { Recording, SpeechTranscript, SpeechWord } from "@/contracts";
import { alignUtterances, type AlignOptions } from "./align";
import { round3 } from "./time";

export const ELEVENLABS_API = "https://api.elevenlabs.io";
export const ELEVENLABS_STT_MODEL = "scribe_v2";
export const ELEVENLABS_REALTIME_MODEL = "scribe_v2_realtime";
export const ELEVENLABS_REALTIME_WS = "wss://api.elevenlabs.io/v1/speech-to-text/realtime";
export const PROVIDER_LABEL = "ElevenLabs Scribe v2";

export function elevenLabsKey(): string | null {
  const k = process.env.ELEVENLABS_API_KEY;
  return k && k.trim() ? k.trim() : null;
}

export class ElevenLabsError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly requestId: string | null,
  ) {
    super(message);
    this.name = "ElevenLabsError";
  }
}

/** The fields of the batch response we use (see header comment). */
export interface ElevenLabsWord {
  text: string;
  start?: number;
  end?: number;
  type: "word" | "spacing" | "audio_event" | string;
  speaker_id?: string;
  logprob?: number;
}
export interface ElevenLabsResponse {
  language_code?: string;
  language_probability?: number;
  text?: string;
  words?: ElevenLabsWord[];
  transcription_id?: string;
  audio_duration_secs?: number;
}

/** logprob in [-inf, 0] -> confidence in [0, 1]. */
export const confidenceFromLogprob = (lp: number | undefined) =>
  typeof lp === "number" && Number.isFinite(lp) ? Math.min(1, Math.max(0, Math.exp(Math.min(0, lp)))) : undefined;

/**
 * Batch response -> SpeechWords, shifted by `offset` seconds (where the audio take starts on the recording's
 * clock). Spacing and audio events are dropped; words without timing are skipped.
 */
export function wordsFromElevenLabs(res: ElevenLabsResponse, offset = 0): SpeechWord[] {
  const out: SpeechWord[] = [];
  for (const w of res.words ?? []) {
    if (w.type !== "word" || !w.text?.trim()) continue;
    if (typeof w.start !== "number" || typeof w.end !== "number") continue;
    const word: SpeechWord = { text: w.text.trim(), start: round3(w.start + offset), end: round3(w.end + offset) };
    const c = confidenceFromLogprob(w.logprob);
    if (c !== undefined) word.confidence = Math.round(c * 1000) / 1000;
    out.push(word);
  }
  return out;
}

export interface TranscribeOptions {
  keyterms?: string[];
  language?: string | null;
  /** Where this audio starts on the recording's clock (s). */
  offset?: number;
  fetchImpl?: typeof fetch;
  /** Override for tests; defaults to ELEVENLABS_API_KEY. */
  apiKey?: string;
  signal?: AbortSignal;
}

export interface ElevenLabsResult {
  words: SpeechWord[];
  language: string | null;
  request_id: string | null;
  duration_s: number | null;
  text: string;
}

/** Transcribe one audio file with Scribe v2 (batch). Throws ElevenLabsError on a non-2xx answer. */
export async function transcribeElevenLabs(audio: Buffer | Uint8Array, mime: string, opts: TranscribeOptions = {}): Promise<ElevenLabsResult> {
  const key = opts.apiKey ?? elevenLabsKey();
  if (!key) throw new ElevenLabsError("ELEVENLABS_API_KEY is not set", 503, null);
  const form = new FormData();
  form.append("model_id", ELEVENLABS_STT_MODEL);
  const bytes = new Uint8Array(audio.byteLength);
  bytes.set(audio);
  form.append("file", new Blob([bytes], { type: mime || "audio/webm" }), `audio.${extForMime(mime)}`);
  form.append("timestamps_granularity", "word");
  form.append("tag_audio_events", "false");
  if (opts.language) form.append("language_code", opts.language);
  for (const k of opts.keyterms ?? []) form.append("keyterms", k);

  const res = await (opts.fetchImpl ?? fetch)(`${ELEVENLABS_API}/v1/speech-to-text`, {
    method: "POST",
    headers: { "xi-api-key": key },
    body: form,
    signal: opts.signal,
  });
  const headerId = res.headers.get("x-request-id") ?? res.headers.get("request-id");
  if (!res.ok) {
    let detail = "";
    try {
      const j = (await res.json()) as { detail?: { message?: string } | string };
      detail = typeof j.detail === "string" ? j.detail : (j.detail?.message ?? "");
    } catch {
      /* not json */
    }
    throw new ElevenLabsError(`ElevenLabs speech to text failed (${res.status})${detail ? `: ${detail}` : ""}`, res.status, headerId);
  }
  const body = (await res.json()) as ElevenLabsResponse;
  return {
    words: wordsFromElevenLabs(body, opts.offset ?? 0),
    language: body.language_code ?? null,
    request_id: headerId ?? body.transcription_id ?? null,
    duration_s: typeof body.audio_duration_secs === "number" ? body.audio_duration_secs : null,
    text: body.text ?? "",
  };
}

/** Several takes of one recording -> one SpeechTranscript with aligned utterances. */
export function elevenLabsTranscript(
  results: ElevenLabsResult[],
  recording: Recording,
  keyterms: string[],
  opts: AlignOptions = {},
): SpeechTranscript {
  const words = results.flatMap((r) => r.words).sort((a, b) => a.start - b.start);
  return {
    provider: "elevenlabs",
    model: ELEVENLABS_STT_MODEL,
    mode: "real",
    language: results.find((r) => r.language)?.language ?? null,
    keyterms,
    utterances: alignUtterances(words, recording, opts),
    request_id: results.map((r) => r.request_id).filter(Boolean).join(",") || null,
  };
}

/** A single-use token for Scribe v2 Realtime in the browser. */
export async function createRealtimeToken(opts: { fetchImpl?: typeof fetch; apiKey?: string } = {}): Promise<string> {
  const key = opts.apiKey ?? elevenLabsKey();
  if (!key) throw new ElevenLabsError("ELEVENLABS_API_KEY is not set", 503, null);
  const res = await (opts.fetchImpl ?? fetch)(`${ELEVENLABS_API}/v1/single-use-token/realtime_scribe`, {
    method: "POST",
    headers: { "xi-api-key": key },
  });
  if (!res.ok) throw new ElevenLabsError(`ElevenLabs token request failed (${res.status})`, res.status, res.headers.get("x-request-id"));
  const j = (await res.json()) as { token?: string };
  if (!j.token) throw new ElevenLabsError("ElevenLabs token response had no token", 502, null);
  return j.token;
}

export function extForMime(mime: string | undefined | null): string {
  const m = String(mime ?? "").toLowerCase();
  if (m.includes("ogg")) return "ogg";
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "m4a";
  if (m.includes("wav")) return "wav";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  return "webm";
}
