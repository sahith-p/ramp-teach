/**
 * The demo voice path (provider "simulated", mode "scripted"): no audio and no speech model. Word timings
 * are built from the narration steps' timestamps and text at a steady speaking rate, so the film can show a
 * word-timed transcript and speech-to-click links. Deterministic: same recording, same transcript.
 *
 * A narration step's `ts` is taken as the moment the narrator started the line (the film's stand-in
 * dictation delivers the whole phrase when the line starts). A line never runs into the next one: if it
 * would, its words are compressed to end just before the next line starts.
 */
import type { Recording, SpeechTranscript, SpeechWord } from "@/contracts";
import { alignUtterances, type AlignOptions } from "./align";
import { keytermsFromRecording } from "./keyterms";
import { round3, stepTime } from "./time";

/** Speaking rate of the demo voice, words per second. */
export const SIM_WORDS_PER_SECOND = 2.6;
/** Gap kept before the next narration line (s). */
const LINE_GAP = 0.15;
/** Share of each word slot that is voiced (the rest is the gap between words). */
const VOICED = 0.82;

/** Word timings for one line of narration starting at `start`, ending no later than `limit`. */
export function lineWords(text: string, start: number, limit = Infinity, wps = SIM_WORDS_PER_SECOND): SpeechWord[] {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return [];
  // Longer words take a little longer: slot ~ (0.6 + 0.08 * letters), scaled so the line averages `wps`.
  const weights = parts.map((w) => 0.6 + 0.08 * w.replace(/[^A-Za-z0-9]/g, "").length);
  const total = weights.reduce((a, b) => a + b, 0);
  let span = parts.length / wps;
  if (start + span > limit - LINE_GAP) span = Math.max(0.2 * parts.length, limit - LINE_GAP - start);
  const words: SpeechWord[] = [];
  let t = start;
  parts.forEach((w, i) => {
    const slot = (weights[i] / total) * span;
    words.push({ text: w, start: round3(t), end: round3(t + slot * VOICED), confidence: 1 });
    t += slot;
  });
  return words;
}

/** All words of the recording's narration, in time order. */
export function simulatedWords(recording: Pick<Recording, "started_at" | "steps">): SpeechWord[] {
  const lines = recording.steps
    .filter((s) => s.kind === "narration" && typeof s.detail.text === "string" && s.detail.text.trim())
    .map((s) => ({ text: String(s.detail.text), start: stepTime(recording, s) }))
    .sort((a, b) => a.start - b.start);
  return lines.flatMap((l, i) => lineWords(l.text, l.start, lines[i + 1]?.start ?? Infinity));
}

export function simulatedTranscript(recording: Recording, opts: AlignOptions & { keyterms?: string[] } = {}): SpeechTranscript {
  return {
    provider: "simulated",
    model: null,
    mode: "scripted",
    language: "en",
    keyterms: opts.keyterms ?? keytermsFromRecording(recording),
    utterances: alignUtterances(simulatedWords(recording), recording, opts),
    request_id: null,
  };
}
