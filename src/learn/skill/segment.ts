/**
 * Stage 1, segment (deterministic, no model): group the recording's steps into episodes by page and attach the
 * reviewer's words. Words come from `recording.speech.utterances` when the recording carries a transcript with
 * word timing; otherwise each narration step becomes one utterance (exact narration text, no word timing);
 * otherwise the plain `transcript` lines.
 */
import type { Recording, Utterance } from "@/contracts";
import { locationTemplate } from "@/learn/deterministic";
import type { Episode, Segmented, StepView } from "./types";

const clean = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v : null);

export function stepViews(recording: Recording): StepView[] {
  return recording.steps.map((s, index) => {
    const d = s.detail;
    const url = clean(d.url);
    return {
      index,
      kind: s.kind,
      event: clean(d.event),
      url,
      page: url ? locationTemplate(url) : null,
      title: clean(d.title),
      selector: clean(d.selector),
      text: clean(d.text),
      value: clean(d.value),
    };
  });
}

const isSecret = (s: StepView) => s.value === "[redacted]" || /password/i.test(s.selector ?? "");

/** Seconds from the recording start (0 when a timestamp does not parse). */
function secondsFrom(start: string, ts: string): number {
  const a = Date.parse(start);
  const b = Date.parse(ts);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, (b - a) / 1000) : 0;
}

/** Episodes: a new one starts whenever the page URL changes. */
export function episodesOf(steps: StepView[]): Episode[] {
  const out: Episode[] = [];
  let cur: Episode | null = null;
  for (const s of steps) {
    if (!cur || (s.url !== null && s.url !== cur.url)) {
      cur = { id: `e${out.length + 1}`, url: s.url, page: s.page, title: s.title, step_indices: [], dom_step_indices: [], utterance_ids: [], auth: false };
      out.push(cur);
    }
    cur.step_indices.push(s.index);
    if (s.kind === "dom") cur.dom_step_indices.push(s.index);
    if (isSecret(s)) cur.auth = true;
    if (!cur.title && s.title) cur.title = s.title;
  }
  return out;
}

/**
 * Dom steps a narration step is about: the dom steps of its episode that come after the previous narration
 * and before the next one (what the reviewer was doing while saying it).
 */
function stepRefsForNarration(steps: StepView[], episodes: Episode[], idx: number): number[] {
  const ep = episodes.find((e) => e.step_indices.includes(idx));
  if (!ep) return [];
  const narrIdx = steps.filter((s) => s.kind === "narration").map((s) => s.index);
  const prev = Math.max(-1, ...narrIdx.filter((i) => i < idx));
  const nextCandidates = narrIdx.filter((i) => i > idx);
  const next = nextCandidates.length ? Math.min(...nextCandidates) : Infinity;
  return ep.dom_step_indices.filter((i) => i > prev && i < next);
}

export function segment(recording: Recording): Segmented {
  const steps = stepViews(recording);
  const episodes = episodesOf(steps);
  const narration_step: Record<string, number> = {};
  let utterances: Utterance[];
  let utterance_source: Segmented["utterance_source"];

  if (recording.speech && recording.speech.utterances.length > 0) {
    utterance_source = "speech";
    utterances = recording.speech.utterances.map((u) => ({ ...u, step_refs: [...u.step_refs] }));
    // Attach each utterance to the episodes of the steps it refers to.
    for (const u of utterances) {
      for (const ref of u.step_refs) {
        const ep = episodes.find((e) => e.step_indices.includes(ref));
        if (ep && !ep.utterance_ids.includes(u.id)) ep.utterance_ids.push(u.id);
      }
    }
  } else {
    const narr = steps.filter((s) => s.kind === "narration" && s.text);
    if (narr.length > 0) {
      utterance_source = "narration";
      utterances = narr.map((s, i) => {
        const id = `u${i + 1}`;
        narration_step[id] = s.index;
        const start = secondsFrom(recording.started_at, recording.steps[s.index].ts);
        const ep = episodes.find((e) => e.step_indices.includes(s.index));
        if (ep) ep.utterance_ids.push(id);
        return {
          id,
          text: s.text!.trim(),
          start,
          end: start,
          words: [],
          step_refs: stepRefsForNarration(steps, episodes, s.index),
          low_confidence: [],
        };
      });
    } else {
      utterance_source = "transcript";
      utterances = recording.transcript
        .map((t) => t.trim())
        .filter(Boolean)
        .map((text, i) => ({ id: `u${i + 1}`, text, start: 0, end: 0, words: [], step_refs: [], low_confidence: [] }));
    }
  }
  return { session_id: recording.session_id, utterance_source, utterances, narration_step, episodes, steps };
}

/** Pages where evidence is read (not the sign-in page), in first-visit order. */
export function evidencePages(seg: Segmented): string[] {
  const auth = new Set(seg.episodes.filter((e) => e.auth).map((e) => e.page));
  const out: string[] = [];
  for (const e of seg.episodes) if (e.page && !auth.has(e.page) && !out.includes(e.page)) out.push(e.page);
  return out;
}
