/**
 * Pure helpers for the Bill Pay workflow pages (no fs; safe on client and server).
 * Labeling rule (project owner): a provider tag shows ONLY for real model output. Anything scripted,
 * mock or deterministic gets no tag, and a real provider's name never appears on non-real data.
 */
import type { PillarMode, RecordingStep, SkillEvalCase, SkillRule, Span, SpeechTranscript, Utterance } from "@/contracts";

/* --------------------------------- tags --------------------------------- */

/** "Claude" for real model output, otherwise null (no tag). */
export const realTag = (mode: PillarMode | string | null | undefined): string | null => (mode === "real" ? "Claude" : null);

/** Speech provider label, only when the transcript is real. */
export function speechTag(speech: Pick<SpeechTranscript, "provider" | "model" | "mode"> | null | undefined): string | null {
  if (!speech || speech.mode !== "real") return null;
  if (speech.provider === "elevenlabs") {
    const m = speech.model ? speech.model.replace(/^scribe[_-]?/i, "Scribe ").replace(/_/g, " ").replace(/\bv(\d)/i, "v$1") : "Scribe";
    return `ElevenLabs ${m.trim()}`;
  }
  if (speech.provider === "browser") return "Browser speech";
  return null;
}

/* -------------------------------- format -------------------------------- */

export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1)} s`;
  if (s < 60) return `${Math.round(s)} s`;
  const m = Math.floor(s / 60);
  return `${m} m ${String(Math.round(s % 60)).padStart(2, "0")} s`;
}

export const fmtClock = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function fmtCost(usd: number | null | undefined): string {
  if (usd == null) return "";
  if (usd === 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export const fmtPct = (x: number | null | undefined, digits = 0) => (x == null ? "" : `${(x * 100).toFixed(digits)}%`);

export function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" });
}

export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** "approved_hours" → "Approved hours". */
export const humanize = (key: string) => {
  const s = key.replace(/[_-]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Path + query of a URL ("http://localhost:3000/portal/x?y" → "/portal/x?y"). */
export function urlPath(url: string | null | undefined): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

/* ------------------------------ recordings ------------------------------ */

export function stepOffset(step: RecordingStep, startedAt: string): number {
  return (Date.parse(step.ts) - Date.parse(startedAt)) / 1000;
}

/** Short label for a recorded DOM step: kind + what it touched. */
export function stepLabel(s: RecordingStep): { kind: "Click" | "Page" | "Typed" | "Submit" | "Said" | "Step"; text: string } {
  const d = s.detail;
  if (s.kind === "narration") return { kind: "Said", text: d.text ?? "" };
  if (d.event === "navigate") return { kind: "Page", text: urlPath(d.url) || d.title || "" };
  if (d.event === "click") {
    const sel = d.selector ?? "";
    const label =
      d.text ||
      /href="[^"]*\/([^"/?]+)(\?week=[^"]*)?"/.exec(sel)?.[1] ||
      /data-field="([^"]+)"/.exec(sel)?.[1]?.replace(/_/g, " ") ||
      /name="([^"]+)"/.exec(sel)?.[1] ||
      sel;
    return { kind: "Click", text: label };
  }
  if (d.event === "input" || d.event === "change") return { kind: "Typed", text: d.value === "[redacted]" ? "password" : (d.value ?? "") };
  if (d.event === "submit") return { kind: "Submit", text: "form" };
  return { kind: "Step", text: d.text ?? urlPath(d.url) };
}

/** Normalize a peaks file ([..], {peaks:[..]}, {data:[..]}) to 0..1 values. */
export function normalizePeaks(raw: unknown): number[] | null {
  const arr = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? ((raw as Record<string, unknown>).peaks ?? (raw as Record<string, unknown>).data)
      : null;
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const nums = arr.map((x) => Math.abs(Number(x))).filter((x) => Number.isFinite(x));
  if (!nums.length) return null;
  const max = Math.max(...nums) || 1;
  return nums.map((x) => x / max);
}

/** Resample to n bars (max per bucket). */
export function resample(values: number[], n: number): number[] {
  if (values.length === 0) return new Array(n).fill(0);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i * values.length) / n);
    const b = Math.max(a + 1, Math.floor(((i + 1) * values.length) / n));
    let m = 0;
    for (let j = a; j < b && j < values.length; j++) m = Math.max(m, values[j]);
    out.push(m);
  }
  return out;
}

/** A waveform from word timings when no peaks file exists: bars where words are spoken, quiet elsewhere. */
export function derivePeaks(utterances: Utterance[], durationS: number, n = 240): number[] {
  const out = new Array(n).fill(0.04);
  if (durationS <= 0) return out;
  for (const u of utterances) {
    for (const w of u.words) {
      const a = Math.max(0, Math.floor((w.start / durationS) * n));
      const b = Math.min(n - 1, Math.ceil((w.end / durationS) * n));
      for (let i = a; i <= b; i++) {
        // deterministic texture per bar so the shape is stable between renders
        const h = Math.abs(Math.sin(i * 12.9898 + w.text.length * 78.233)) * 0.45;
        out[i] = Math.max(out[i], 0.45 + h);
      }
    }
  }
  return out;
}

/** Recording length: audio duration, else last word / step. */
export function recordingDuration(rec: { started_at: string; steps: RecordingStep[]; audio?: { duration_s: number }; speech?: SpeechTranscript }): number {
  if (rec.audio?.duration_s) return rec.audio.duration_s;
  const lastWord = Math.max(0, ...(rec.speech?.utterances ?? []).map((u) => u.end));
  const lastStep = rec.steps.length ? stepOffset(rec.steps[rec.steps.length - 1], rec.started_at) : 0;
  return Math.max(lastWord, lastStep) + 1;
}

/* --------------------------------- rules --------------------------------- */

const STOP = new Set("the and for that with each from must may not any are this its their they them have has into when then than only every".split(" "));
const tokens = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9$ ]+/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w)));

/** Overlap of content words, relative to the shorter text (0..1). */
export function similarity(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
}

export interface RuleDiff {
  added: SkillRule[];
  removed: SkillRule[];
  changed: { from: SkillRule; to: SkillRule }[];
  same: number;
}

/** from → to: identical text is unchanged; same id with new text is changed; the rest added / removed. */
export function diffRules(from: SkillRule[], to: SkillRule[]): RuleDiff {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const left = [...from];
  const right: SkillRule[] = [];
  let same = 0;
  for (const r of to) {
    const i = left.findIndex((l) => norm(l.text) === norm(r.text));
    if (i >= 0) {
      left.splice(i, 1);
      same++;
    } else right.push(r);
  }
  const changed: RuleDiff["changed"] = [];
  const added: SkillRule[] = [];
  for (const r of right) {
    const i = left.findIndex((l) => l.id === r.id && similarity(l.text, r.text) >= 0.3);
    if (i >= 0) changed.push({ from: left.splice(i, 1)[0], to: r });
    else added.push(r);
  }
  return { added, removed: left, changed, same };
}

/** Eval cases whose gold rules cover this rule. */
export function casesCoveringRule(rule: SkillRule, cases: SkillEvalCase[]): string[] {
  return cases.filter((c) => c.gold.rules.some((g) => similarity(g, rule.text) >= 0.5)).map((c) => c.id);
}

/** The rule a recorded fact supports: a check citing the fact's field, else one that names it. */
export function ruleForFact(rules: SkillRule[], key: string): SkillRule | null {
  const cites = (r: SkillRule) => r.citations.some((c) => (c.selector ?? "").includes(key));
  const names = (r: SkillRule) => r.text.toLowerCase().includes(key.replace(/_/g, " ").toLowerCase());
  return (
    rules.find((r) => r.kind === "check" && cites(r)) ??
    rules.find((r) => r.kind === "check" && names(r)) ??
    rules.find(cites) ??
    rules.find(names) ??
    null
  );
}

/* --------------------------------- spans --------------------------------- */

export interface SpanRow {
  span: Span;
  depth: number;
  start: number; // ms from run start
  end: number;
}

/** Depth-first order (children by start), times relative to the earliest span. */
export function layoutSpans(spans: Span[]): { rows: SpanRow[]; t0: number; total: number } {
  if (!spans.length) return { rows: [], t0: 0, total: 0 };
  const t0 = Math.min(...spans.map((s) => Date.parse(s.start)));
  const t1 = Math.max(...spans.map((s) => Date.parse(s.end)));
  const ids = new Set(spans.map((s) => s.span_id));
  const kids = new Map<string | null, Span[]>();
  for (const s of spans) {
    const p = s.parent_id && ids.has(s.parent_id) ? s.parent_id : null;
    kids.set(p, [...(kids.get(p) ?? []), s]);
  }
  for (const list of kids.values()) list.sort((a, b) => a.start.localeCompare(b.start));
  const rows: SpanRow[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const s of kids.get(parent) ?? []) {
      rows.push({ span: s, depth, start: Date.parse(s.start) - t0, end: Date.parse(s.end) - t0 });
      walk(s.span_id, depth + 1);
    }
  };
  walk(null, 0);
  return { rows, t0, total: Math.max(1, t1 - t0) };
}

const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);

export function spanTokens(s: Span): { input: number; output: number; cacheRead: number; cacheWrite: number } {
  const a = s.attrs;
  return {
    input: num(a.input_tokens),
    output: num(a.output_tokens),
    cacheRead: num(a.cache_read_input_tokens),
    cacheWrite: num(a.cache_creation_input_tokens),
  };
}

export function runTotals(spans: Span[]) {
  const { total } = layoutSpans(spans);
  let tokens = 0;
  let cost = 0;
  let hasCost = false;
  for (const s of spans) {
    const t = spanTokens(s);
    tokens += t.input + t.output + t.cacheRead + t.cacheWrite;
    if (typeof s.attrs.cost_usd === "number") {
      cost += s.attrs.cost_usd;
      hasCost = true;
    }
  }
  return {
    duration_ms: spans.length ? total : 0,
    turns: spans.filter((s) => s.kind === "model").length,
    tool_calls: spans.filter((s) => s.kind === "tool").length,
    tokens,
    cost_usd: hasCost ? cost : null,
  };
}

export interface Fact {
  key: string;
  value: string;
  subject: Record<string, string>;
}

export function spanFact(s: Span): Fact | null {
  const f = (s.attrs.fact ?? s.attrs.evidence) as Record<string, unknown> | undefined;
  if (!f || typeof f !== "object" || typeof f.key !== "string") return null;
  const subject: Record<string, string> = {};
  if (f.subject && typeof f.subject === "object") for (const [k, v] of Object.entries(f.subject)) subject[k] = String(v);
  return { key: f.key, value: String(f.value ?? ""), subject };
}

export const subjectLabel = (subject: Record<string, string>) =>
  subject.employee ?? subject.employee_name ?? subject.name ?? subject.employee_id ?? Object.values(subject)[0] ?? "";

export function factText(f: Fact): string {
  const unit = /hours/.test(f.key) ? " h" : "";
  const who = subjectLabel(f.subject);
  return `${who ? `${who}: ` : ""}${f.value}${unit} ${humanize(f.key).toLowerCase().replace(/ hours$/, "")}`.trim();
}

export type StepType = "note" | "action" | "fact" | "code";

/** One readable timeline line per span (null = not shown in the step list). */
export function spanStep(s: Span): { type: StepType; text: string; detail?: string } | null {
  const a = s.attrs;
  if (s.kind === "run") return null;
  const fact = spanFact(s);
  if (fact) return { type: "fact", text: factText(fact) };
  if (s.kind === "model") return typeof a.note === "string" && a.note ? { type: "note", text: a.note } : null;
  if (s.kind === "tool") {
    const tool = String(a.tool ?? s.name.split(" ")[0]);
    const input = (a.input ?? {}) as Record<string, unknown>;
    if (tool === "navigate") return { type: "action", text: "Opened a page", detail: urlPath(String(input.url ?? a.url ?? "")) };
    if (tool === "left_click" || tool === "click") return { type: "action", text: "Clicked", detail: typeof a.url === "string" ? urlPath(a.url) : undefined };
    if (tool === "form_input" || tool === "type") return { type: "action", text: "Filled a field" };
    if (tool === "screenshot") return { type: "action", text: "Took a screenshot" };
    if (tool === "find" || tool === "read_page" || tool === "get_page_text") return { type: "action", text: "Read the page" };
    return { type: "action", text: s.name };
  }
  if (s.kind === "calc") return { type: "code", text: s.name.includes("evidence") ? "Compared hours to timecards" : "Checked math and rates" };
  if (s.kind === "verify") return { type: "code", text: `Re-checked ${num(a.checked) || "the"} facts${num(a.mismatch) ? ` · ${num(a.mismatch)} mismatch` : ""}` };
  if (s.kind === "synthesis") return { type: "note", text: typeof a.note === "string" && a.note ? a.note : "Wrote the recommendation" };
  return null;
}

/** Waterfall colors by span kind (validated categorical set; run is the neutral container). */
export const KIND_COLOR: Record<string, string> = {
  run: "#d2cecb",
  model: "#2a78d6",
  tool: "#1baf7a",
  calc: "#6250d6",
  verify: "#6250d6",
  synthesis: "#eb6834",
  learn: "#2a78d6",
  stt: "#1baf7a",
  eval: "#6250d6",
};
export const KIND_LABEL: Record<string, string> = {
  run: "Run",
  model: "Model turn",
  tool: "Tool call",
  calc: "Code",
  verify: "Code",
  synthesis: "Synthesis",
  learn: "Learn",
  stt: "Speech",
  eval: "Eval",
};

/** Round tick step for a time axis of `total` ms. */
export function tickStep(total: number, target = 6): number {
  const raw = total / target;
  const steps = [100, 250, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000];
  return steps.find((s) => s >= raw) ?? 600000;
}

/* ------------------------------ learn stages ------------------------------ */

export const STAGES = ["segment", "claims", "synthesize", "critique", "checks", "package"] as const;
export const STAGE_LABEL: Record<string, string> = {
  segment: "Segment",
  claims: "Claims",
  synthesize: "Synthesize",
  critique: "Critique",
  checks: "Checks",
  package: "Package",
};
