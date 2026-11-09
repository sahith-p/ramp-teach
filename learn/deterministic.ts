/**
 * Generic, deterministic (no-LLM) building blocks for distilling a Recording into a WorkflowSpec.
 *
 * Workflow-agnostic: this module knows about DOM steps, URLs, page titles, `data-field` markers and
 * narration sentences — nothing about invoices. A workflow's `deterministicDistill` composes these
 * helpers and adds its own hints (vendor pattern, field hints per location).
 *
 * MUST NOT import from workflows/ or calc/ (contracts/engine.ts).
 */
import type { Recording, RecordingStep, WorkflowSpec } from "@/contracts";

type ProofSource = WorkflowSpec["proof_sources"][number];

/* --------------------------------- URLs ---------------------------------- */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "employees" -> "employee", "categories" -> "category". Crude on purpose. */
function singular(word: string): string {
  if (/ies$/.test(word)) return word.replace(/ies$/, "y");
  if (/(ses|xes)$/.test(word)) return word.slice(0, -2);
  if (/s$/.test(word) && !/ss$/.test(word)) return word.slice(0, -1);
  return word;
}

/** True for path segments that look like record identifiers (contain a digit, e.g. E-101, HSG-1010). */
function looksLikeId(segment: string): boolean {
  return /\d/.test(segment);
}

/**
 * Turn a concrete URL into a location template:
 *   http://localhost:3000/portal/employees/E-101?week=2026-10-11
 *   -> /portal/employees/<employee_id>?week=<YYYY-MM-DD>
 * ID-looking path segments are named after the preceding segment; date values become <YYYY-MM-DD>;
 * other query values become <name>.
 */
export function locationTemplate(rawUrl: string): string {
  let u: URL;
  try {
    u = new URL(rawUrl, "http://localhost");
  } catch {
    return rawUrl;
  }
  const segs = u.pathname.split("/").filter(Boolean);
  const out = segs.map((seg, i) => {
    if (DATE_RE.test(seg)) return "<YYYY-MM-DD>";
    if (looksLikeId(seg)) return i > 0 ? `<${singular(segs[i - 1])}_id>` : "<id>";
    return seg;
  });
  const params = [...u.searchParams.entries()].map(([k, v]) => `${k}=${DATE_RE.test(v) ? "<YYYY-MM-DD>" : `<${k}>`}`);
  return "/" + out.join("/") + (params.length ? `?${params.join("&")}` : "");
}

/** Application name from a page title such as "Invoices · Fixture vendor portal" (last " · " part). */
export function appFromTitle(title: string | undefined, url: string | undefined): string {
  if (title) {
    const parts = title.split(/\s+[·|–—-]\s+/).map((s) => s.trim()).filter(Boolean);
    if (parts.length > 1) return parts[parts.length - 1];
  }
  if (url) {
    try {
      return new URL(url).host;
    } catch {
      /* fall through */
    }
  }
  return "Unknown app";
}

/* ----------------------------- Proof sources ----------------------------- */

/** Field names a DOM step reveals: `[data-field="x"]`, `input[name=x]`. */
export function fieldsFromSelector(selector: string | undefined): string[] {
  if (!selector) return [];
  const out: string[] = [];
  for (const m of selector.matchAll(/\[data-field=["']?([\w.-]+)["']?\]/g)) out.push(m[1]);
  for (const m of selector.matchAll(/\b(?:input|select|textarea)\[name=["']?([\w.-]+)["']?\]/g)) out.push(m[1]);
  return out;
}

function isSecretStep(step: RecordingStep): boolean {
  const d = step.detail;
  return d.value === "[redacted]" || /password/i.test(d.selector ?? "");
}

export interface ProofSourceOptions {
  /** Extra fields known to live at a location template (workflow hint), merged after observed ones. */
  fieldHints?: Record<string, string[]>;
  /** Skip locations where a secret (password) was entered — auth pages are not proof. Default true. */
  skipAuthPages?: boolean;
}

/**
 * Every page the demonstrator visited, as a proof source: { app, location template, fields read }.
 * Order = first visit. Auth pages (a redacted/password input happened there) are skipped by default.
 */
export function extractProofSources(recording: Recording, opts: ProofSourceOptions = {}): ProofSource[] {
  const skipAuth = opts.skipAuthPages ?? true;
  const order: string[] = [];
  const byLoc = new Map<string, { app: string; fields: string[]; auth: boolean }>();
  for (const step of recording.steps) {
    if (step.kind !== "dom" || !step.detail.url) continue;
    const loc = locationTemplate(step.detail.url);
    let entry = byLoc.get(loc);
    if (!entry) {
      entry = { app: appFromTitle(step.detail.title, step.detail.url), fields: [], auth: false };
      byLoc.set(loc, entry);
      order.push(loc);
    }
    if (isSecretStep(step)) entry.auth = true;
    for (const f of fieldsFromSelector(step.detail.selector)) if (!entry.fields.includes(f)) entry.fields.push(f);
  }
  return order
    .filter((loc) => !(skipAuth && byLoc.get(loc)!.auth))
    .map((loc) => {
      const e = byLoc.get(loc)!;
      const fields = [...e.fields];
      for (const f of opts.fieldHints?.[loc] ?? []) if (!fields.includes(f)) fields.push(f);
      return { app: e.app, location: loc, fields };
    });
}

/* ------------------------------- Narration ------------------------------- */

export function narrations(recording: Recording): string[] {
  const fromSteps = recording.steps
    .filter((s) => s.kind === "narration" && typeof s.detail.text === "string")
    .map((s) => (s.detail.text as string).trim())
    .filter(Boolean);
  return fromSteps.length ? fromSteps : recording.transcript.map((t) => t.trim()).filter(Boolean);
}

/** Split into sentences without breaking "12,449.00" or "1.5". */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z"'])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const RULE_LABEL = /^(?:rule\s+[\w-]+|step\s+[\w-]+)\s*:\s*/i;
const QUESTION_LABEL = /^(?:another\s+|one more\s+)?open question\s*:\s*/i;

/** Normative language: the sentence states a constraint or a decision. */
const NORMATIVE =
  /\b(must|has to|have to|needs? to|can't|cannot|can not|must not|never|only|not allowed|is not allowed|no duplicate|gets? disputed|is a dispute|gets? rejected|should|required?|recommends?)\b/i;

/** Reference-value lists such as "Senior Recruiter 95, Sourcer 70" or "fee up to 120, posting up to 400". */
const REFERENCE_LIST = /^(?:[A-Za-z][A-Za-z' ]*?\s(?:up to\s)?\$?\d[\d,]*(?:\.\d+)?)(?:\s*,\s*(?:and\s+)?[A-Za-z][A-Za-z' ]*?\s(?:up to\s)?\$?\d[\d,]*(?:\.\d+)?)+\.?$/;

const INTERIM = /\b(for now|until (?:then|resolved|we hear|confirmed))\b/i;

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function isQuestionNarration(text: string): boolean {
  return QUESTION_LABEL.test(text);
}

/**
 * Rules stated in narration. One rule per narration that contains normative sentences; observation
 * sentences ("They do: 12,449.00.") are dropped, reference-value lists that follow a rule are kept.
 * Interim policies stated inside an open question ("For now I only accept …") become
 * "Until resolved: …" rules.
 */
export function extractRules(recording: Recording): string[] {
  const rules: string[] = [];
  for (const raw of narrations(recording)) {
    const question = isQuestionNarration(raw);
    const text = raw.replace(RULE_LABEL, "").replace(QUESTION_LABEL, "");
    const kept: string[] = [];
    let lastWasRule = false;
    for (const s of sentences(text)) {
      if (s.endsWith("?")) {
        lastWasRule = false;
        continue;
      }
      if (question) {
        if (INTERIM.test(s) && NORMATIVE.test(s)) kept.push(`Until resolved: ${capitalize(s.replace(/^for now,?\s*/i, ""))}`);
        continue;
      }
      if (NORMATIVE.test(s)) {
        kept.push(capitalize(s));
        lastWasRule = true;
      } else if (lastWasRule && REFERENCE_LIST.test(s)) {
        kept.push(s.endsWith(".") ? s : `${s}.`);
      } else {
        lastWasRule = false;
      }
    }
    if (kept.length === 0) continue;
    if (question) rules.push(...kept);
    else rules.push(kept.join(" "));
  }
  return dedupe(rules);
}

/**
 * Open questions raised in narration: narrations labelled "Open question:" (minus any interim policy
 * sentence, which becomes a rule), plus any other narration sentence ending in "?".
 */
export function extractOpenQuestions(recording: Recording): string[] {
  const out: string[] = [];
  for (const raw of narrations(recording)) {
    if (isQuestionNarration(raw)) {
      const body = sentences(raw.replace(QUESTION_LABEL, ""))
        .filter((s) => !(INTERIM.test(s) && NORMATIVE.test(s)))
        .map(capitalize)
        .join(" ");
      if (body) out.push(body);
      continue;
    }
    for (const s of sentences(raw.replace(RULE_LABEL, ""))) if (s.endsWith("?")) out.push(capitalize(s));
  }
  return dedupe(out);
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs)];
}

/** First capture of `pattern` across narration (e.g. the vendor name), or null. */
export function firstMatch(recording: Recording, pattern: RegExp): string | null {
  for (const t of narrations(recording)) {
    const m = t.match(pattern);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}
