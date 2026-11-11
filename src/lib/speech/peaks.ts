/**
 * Audio level peaks for the waveform UI: an array of 0..1 values at PEAKS_RATE per second, on the
 * recording's clock (index i = seconds i / PEAKS_RATE after `Recording.started_at`).
 *
 *   runtime/recordings/<session_id>.peaks.json   { session_id, rate, duration_s, mode, peaks }
 *
 * Real path: the side panel measures the mic level (AnalyserNode RMS) while recording and uploads it.
 * Demo voice path: generated from a deterministic speech envelope over the word timings.
 */
import fs from "node:fs";
import path from "node:path";
import type { PillarMode, SpeechWord } from "@/contracts";
import { PP } from "@/lib/pillars";

export const PEAKS_RATE = 20;
const MAX_PEAKS = PEAKS_RATE * 60 * 60; // one hour

export interface PeaksFile {
  session_id: string;
  rate: number;
  duration_s: number;
  mode: PillarMode;
  peaks: number[];
}

export const peaksPath = (sessionId: string, dir = PP.recordings) => path.join(dir, `${sessionId}.peaks.json`);

/** Small deterministic hash -> [0, 1). */
function hash01(n: number): number {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/**
 * Speech-like level at time t inside a word: a syllable pulse (~4.5/s) with a soft attack and release, shaped
 * by a per-word loudness. Same inputs, same output.
 */
export function speechEnvelope(t: number, word: Pick<SpeechWord, "start" | "end">, wordIndex: number): number {
  const len = Math.max(0.05, word.end - word.start);
  const x = (t - word.start) / len; // 0..1 across the word
  if (x < 0 || x > 1) return 0;
  const edge = Math.min(1, x / 0.18, (1 - x) / 0.22); // attack / release
  const syllables = Math.max(1, Math.round(len * 4.5));
  const pulse = 0.62 + 0.38 * Math.abs(Math.sin(Math.PI * syllables * x + hash01(wordIndex) * 0.8));
  const loud = 0.55 + 0.4 * hash01(wordIndex * 7 + 3);
  return Math.max(0, Math.min(1, edge * pulse * loud));
}

/** Peaks for the demo voice: the speech envelope over the words, a quiet floor elsewhere. */
export function simulatedPeaks(words: SpeechWord[], durationS: number, rate = PEAKS_RATE): number[] {
  const end = Math.max(durationS, words.length ? words[words.length - 1].end + 0.5 : 0);
  const n = Math.min(MAX_PEAKS, Math.ceil(end * rate));
  const out = new Array<number>(n).fill(0);
  let w = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    while (w < words.length && words[w].end < t) w++;
    const floor = 0.02 + 0.015 * hash01(i);
    const v = w < words.length ? speechEnvelope(t, words[w], w) : 0;
    out[i] = Math.round(Math.max(floor, v) * 1000) / 1000;
  }
  return out;
}

/** Clamp untrusted peaks from the client: finite numbers in 0..1, at most an hour. */
export function sanitizePeaks(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_PEAKS).map((v) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000 : 0;
  });
}

export function writePeaks(file: PeaksFile, dir = PP.recordings): string {
  const f = peaksPath(file.session_id, dir);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(file) + "\n");
  return f;
}

export function readPeaks(sessionId: string, dir = PP.recordings): PeaksFile | null {
  const f = peaksPath(sessionId, dir);
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, "utf8")) as PeaksFile;
}
