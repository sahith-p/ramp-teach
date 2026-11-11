/**
 * Speech to click alignment (deterministic, no model).
 *
 *   words  ->  utterances (sentences: end punctuation, a long pause, or a length cap)
 *          ->  step_refs: the recorded DOM steps each utterance is about
 *
 * A step is linked when it falls in the utterance's time window AND shares a meaningful token with it
 * (a number, an ID like E-104, a name, or a word from the clicked element's text, selector or URL).
 * When nothing matches lexically, the single closest interactive step (click / input / change / submit)
 * inside a tighter window is linked instead, so "this one" style narration still points at the click.
 */
import type { Recording, RecordingStep, SpeechWord, Utterance } from "@/contracts";
import { round3, stepTime } from "./time";

export const LOW_CONFIDENCE = 0.6;

export interface AlignOptions {
  /** Words with confidence below this are listed in `low_confidence` (default 0.6). */
  lowConfidence?: number;
  /** A gap between words at least this long (s) ends an utterance (default 1.2). */
  pauseSplit?: number;
  /** Hard cap on words per utterance (default 40). */
  maxWords?: number;
  /** Seconds before the utterance start that a step may still be linked (default 6). */
  preWindow?: number;
  /** Seconds after the utterance end that a step may still be linked (default 1.5). */
  postWindow?: number;
  /** Most step refs per utterance (default 3). */
  maxRefs?: number;
}

const INTERACTIVE = new Set(["click", "input", "change", "submit"]);

/** Function words and selector/URL plumbing that never count as a lexical match. */
const STOP = new Set(
  (
    "a an the and or but if then than so to of in on at by for from with without into onto over under up down out off " +
    "is are was were be been being am do does did done has have had having it its it's this that these those there here " +
    "i i'm me my we our us you your he she they them their his her him what which who whom when where why how all any " +
    "each every some no nobody not none can can't cannot could should would will won't just also only same other again " +
    "very too more most much many one two first next last now new get got make made go going see look check checking " +
    "against about want need like okay ok yes yeah um uh " +
    // selector / URL plumbing
    "div span main section form button input select textarea label nth type of-type href data field name id class " +
    "tbody thead tr td th table li ul ol nav header footer aside article http https localhost www com html portal"
  ).split(/\s+/),
);

/** Light stemmer so "hours" ~ "approved_hours", "billed" ~ "bill", "timecards" ~ "timecard". */
export function stem(w: string): string {
  let s = w.replace(/'s$/, "");
  if (/^\d/.test(s)) return s;
  if (s.length > 5 && s.endsWith("ing")) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith("ed")) s = s.slice(0, -2);
  if (s.length > 3 && s.endsWith("s") && !s.endsWith("ss")) s = s.slice(0, -1);
  return s;
}

/**
 * Meaningful tokens of a text: lowercase words (stemmed, minus stop words, at least 3 letters), numbers,
 * and compact IDs ("E-104", "E 104", "e104" all give "e104").
 */
export function tokens(text: string | undefined | null): Set<string> {
  const out = new Set<string>();
  if (!text) return out;
  const t = String(text).toLowerCase();
  for (const m of t.matchAll(/\b([a-z]{1,5})[-\s]?(\d{2,6})\b/g)) out.add(m[1] + m[2]);
  for (const raw of t.split(/[^a-z0-9']+/)) {
    const w = raw.replace(/^'+|'+$/g, "");
    if (!w || STOP.has(w)) continue;
    if (/^\d+$/.test(w)) {
      out.add(String(Number(w)));
      continue;
    }
    if (w.length < 3) continue;
    const s = stem(w);
    if (s.length >= 3 && !STOP.has(s)) out.add(s);
  }
  return out;
}

/** Tokens a DOM step offers for matching. Page titles count only for navigate steps (every step carries one). */
export function stepTokens(step: RecordingStep): Set<string> {
  const d = step.detail;
  const parts: string[] = [];
  if (d.text) parts.push(d.text);
  if (d.value && d.value !== "[redacted]") parts.push(d.value);
  if (d.selector) {
    // Attribute values only: [data-field="approved_hours"] -> "approved hours", a[href="/portal/employees/E-104?..."] -> path.
    for (const m of d.selector.matchAll(/="([^"]*)"/g)) parts.push(m[1].replace(/_/g, " "));
  }
  if (d.url) {
    try {
      const u = new URL(d.url);
      parts.push(u.pathname.split("/").join(" "));
      for (const [k, v] of u.searchParams) parts.push(`${k} ${v}`);
    } catch {
      /* not a URL */
    }
  }
  if (d.event === "navigate" && d.title) parts.push(d.title);
  return tokens(parts.join(" "));
}

const ENDS_SENTENCE = /[.!?]["')\]]*$/;

/** Split a word stream into utterance word groups. */
export function splitUtterances(words: SpeechWord[], opts: AlignOptions = {}): SpeechWord[][] {
  const pause = opts.pauseSplit ?? 1.2;
  const maxWords = opts.maxWords ?? 40;
  const groups: SpeechWord[][] = [];
  let cur: SpeechWord[] = [];
  const sorted = [...words].filter((w) => w.text.trim()).sort((a, b) => a.start - b.start);
  sorted.forEach((w, i) => {
    cur.push(w);
    const next = sorted[i + 1];
    const gap = next ? next.start - w.end : Infinity;
    if (ENDS_SENTENCE.test(w.text) || gap >= pause || cur.length >= maxWords) {
      groups.push(cur);
      cur = [];
    }
  });
  if (cur.length) groups.push(cur);
  return groups;
}

/** Link one utterance to recording steps. Returns step indices, ascending. */
export function linkSteps(
  utt: { text: string; start: number; end: number },
  recording: Pick<Recording, "started_at" | "steps">,
  opts: AlignOptions = {},
): number[] {
  const pre = opts.preWindow ?? 6;
  const post = opts.postWindow ?? 1.5;
  const maxRefs = opts.maxRefs ?? 3;
  const said = tokens(utt.text);
  const distance = (t: number) => (t < utt.start ? utt.start - t : t > utt.end ? t - utt.end : 0);

  const lexical: { i: number; score: number; dist: number }[] = [];
  let nearest: { i: number; dist: number } | null = null;
  recording.steps.forEach((step, i) => {
    if (step.kind !== "dom") return;
    const t = stepTime(recording, step);
    if (t < utt.start - pre || t > utt.end + post) return;
    const dist = distance(t);
    let score = 0;
    for (const tok of stepTokens(step)) if (said.has(tok)) score++;
    if (score > 0) lexical.push({ i, score, dist });
    const ev = step.detail.event ?? "";
    if (INTERACTIVE.has(ev) && t >= utt.start - 3 && t <= utt.end + 1 && (!nearest || dist < nearest.dist)) {
      nearest = { i, dist };
    }
  });

  if (lexical.length) {
    return lexical
      .sort((a, b) => b.score - a.score || a.dist - b.dist || a.i - b.i)
      .slice(0, maxRefs)
      .map((x) => x.i)
      .sort((a, b) => a - b);
  }
  const n = nearest as { i: number; dist: number } | null;
  return n ? [n.i] : [];
}

/** Words to utterances, each linked to its steps, with low-confidence words listed. */
export function alignUtterances(
  words: SpeechWord[],
  recording: Pick<Recording, "started_at" | "steps">,
  opts: AlignOptions = {},
): Utterance[] {
  const threshold = opts.lowConfidence ?? LOW_CONFIDENCE;
  return splitUtterances(words, opts).map((ws, k) => {
    const text = ws.map((w) => w.text.trim()).join(" ");
    const start = round3(ws[0].start);
    const end = round3(ws[ws.length - 1].end);
    return {
      id: `u${k + 1}`,
      text,
      start,
      end,
      words: ws,
      step_refs: linkSteps({ text, start, end }, recording, opts),
      low_confidence: ws.filter((w) => w.confidence !== undefined && w.confidence < threshold).map((w) => w.text),
    };
  });
}

/** All words of a transcript, in order. */
export function transcriptWords(utterances: Utterance[]): SpeechWord[] {
  return utterances.flatMap((u) => u.words);
}
