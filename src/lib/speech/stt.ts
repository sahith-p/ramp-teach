/**
 * The STT step behind POST /api/stt: save the audio, pick a provider, transcribe, align, write peaks.
 *
 * Provider choice:
 *   ElevenLabs Scribe v2   audio present and ELEVENLABS_API_KEY set                     (mode "real")
 *   simulated              the operator is scripted (the film) or there is no audio      (mode "scripted")
 *   none                   audio from a person but no key: 503, the audio is still saved
 */
import fs from "node:fs";
import path from "node:path";
import { RecordingSchema, type Recording, type RecordingAudio, type SpeechTranscript } from "@/contracts";
import { PP, rel } from "@/lib/pillars";
import { transcriptWords } from "./align";
import { ElevenLabsError, elevenLabsKey, elevenLabsTranscript, extForMime, PROVIDER_LABEL, transcribeElevenLabs, type ElevenLabsResult } from "./elevenlabs";
import { keytermsFromRecording } from "./keyterms";
import { PEAKS_RATE, sanitizePeaks, simulatedPeaks, writePeaks } from "./peaks";
import { simulatedTranscript } from "./simulated";
import { recordingDuration } from "./time";

export type Operator = "human" | "scripted_playwright";

export interface AudioTake {
  bytes: Uint8Array;
  mime: string;
  /** Where the take starts on the recording's clock (s). */
  offset_s: number;
  /** Take length (s) as measured by the recorder, if known. */
  duration_s?: number;
}

export interface SttInput {
  recording: unknown;
  operator?: string;
  audio?: AudioTake[];
  /** Mic levels measured by the panel (0..1 at PEAKS_RATE/s on the recording's clock). */
  peaks?: unknown;
  /** Terms the content script collected from the recorded pages. */
  pageTerms?: unknown;
  language?: string | null;
}

export interface SttDeps {
  /** Folder for audio, peaks and the enriched recording (default runtime/recordings). */
  dir?: string;
  fetchImpl?: typeof fetch;
}

export type SttResult =
  | { status: 200; body: { recording: Recording; provider_label: string | null; peaks_path: string; audio_paths: string[] } }
  | { status: 400 | 413 | 502 | 503; body: { error: string; audio_paths?: string[]; request_id?: string | null } };

export const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
const SESSION_RE = /^[A-Za-z0-9_-]{1,80}$/;

export const providerLabel = (s: SpeechTranscript | undefined) => (s?.provider === "elevenlabs" ? PROVIDER_LABEL : null);

export async function runStt(input: SttInput, deps: SttDeps = {}): Promise<SttResult> {
  const dir = deps.dir ?? PP.recordings;
  const parsed = RecordingSchema.safeParse(input.recording);
  if (!parsed.success) return { status: 400, body: { error: "recording does not match RecordingSchema" } };
  const recording = parsed.data;
  if (!SESSION_RE.test(recording.session_id)) return { status: 400, body: { error: "bad session_id" } };
  const operator: Operator = input.operator === "scripted_playwright" ? "scripted_playwright" : "human";
  const takes = (input.audio ?? []).filter((t) => t.bytes.byteLength > 0);
  const total = takes.reduce((n, t) => n + t.bytes.byteLength, 0);
  if (total > MAX_AUDIO_BYTES) return { status: 413, body: { error: "audio too large (50 MB max)" } };

  // 1. Save the audio: <id>.webm, then <id>.take2.webm, ...
  fs.mkdirSync(dir, { recursive: true });
  const audioFiles = takes.map((t, i) => {
    const f = path.join(dir, `${recording.session_id}${i === 0 ? "" : `.take${i + 1}`}.${extForMime(t.mime)}`);
    fs.writeFileSync(f, t.bytes);
    return f;
  });
  const audio_paths = audioFiles.map((f) => rel(f));

  const pageTerms = Array.isArray(input.pageTerms) ? input.pageTerms.filter((x): x is string => typeof x === "string").slice(0, 500) : [];
  const keyterms = keytermsFromRecording(recording, pageTerms);
  const language = typeof input.language === "string" && /^[a-z]{2,3}$/i.test(input.language) ? input.language.toLowerCase() : null;

  // 2. Pick the provider and transcribe.
  let speech: SpeechTranscript;
  let audioMeta: RecordingAudio | undefined;
  if (takes.length && elevenLabsKey()) {
    const results: ElevenLabsResult[] = [];
    try {
      for (const t of takes) {
        results.push(await transcribeElevenLabs(t.bytes, t.mime, { keyterms, language, offset: t.offset_s, fetchImpl: deps.fetchImpl }));
      }
    } catch (e) {
      const err = e instanceof ElevenLabsError ? e : null;
      return {
        status: 502,
        body: { error: err?.message ?? "ElevenLabs speech to text failed", audio_paths, request_id: err?.requestId ?? null },
      };
    }
    speech = elevenLabsTranscript(results, recording, keyterms);
    const duration = takes.reduce((n, t, i) => n + (t.duration_s ?? results[i].duration_s ?? 0), 0);
    audioMeta = { path: audio_paths[0], mime: takes[0].mime || "audio/webm", duration_s: Math.round(duration * 1000) / 1000 };
  } else if (operator === "scripted_playwright" || !takes.length) {
    speech = simulatedTranscript(recording, { keyterms });
    if (takes.length) {
      const duration = takes.reduce((n, t) => n + (t.duration_s ?? 0), 0);
      audioMeta = { path: audio_paths[0], mime: takes[0].mime || "audio/webm", duration_s: Math.round(duration * 1000) / 1000 };
    }
  } else {
    return {
      status: 503,
      body: {
        error: "Speech to text is not configured: set ELEVENLABS_API_KEY to transcribe recorded audio. The audio was saved.",
        audio_paths,
      },
    };
  }

  const enriched = RecordingSchema.parse({ ...recording, speech, ...(audioMeta ? { audio: audioMeta } : {}) });

  // 3. Peaks for the waveform: measured mic levels when real, the demo voice envelope otherwise.
  const words = transcriptWords(speech.utterances);
  const lastWord = words.length ? words[words.length - 1].end : 0;
  const duration = Math.max(recordingDuration(recording), lastWord, audioMeta?.duration_s ?? 0);
  const measured = sanitizePeaks(input.peaks);
  const real = speech.provider === "elevenlabs";
  const peaks = real && measured.length ? measured : real ? [] : simulatedPeaks(words, duration);
  const peaksFile = writePeaks(
    { session_id: recording.session_id, rate: PEAKS_RATE, duration_s: Math.round(duration * 1000) / 1000, mode: real ? "deterministic" : "scripted", peaks },
    dir,
  );

  // 4. Keep the enriched recording next to its audio (lib/pillars.ts listRecordings reads this folder).
  fs.writeFileSync(path.join(dir, `${recording.session_id}.json`), JSON.stringify(enriched, null, 2) + "\n");

  return { status: 200, body: { recording: enriched, provider_label: providerLabel(speech), peaks_path: rel(peaksFile), audio_paths } };
}
