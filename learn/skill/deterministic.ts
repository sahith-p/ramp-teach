/**
 * Offline skill distiller (mode "deterministic", no model). Claims are the reviewer's own sentences (clauses split
 * on ";"), each cited with its exact words; rules are the normative ones, questions become open questions, and a
 * field the reviewer inspected on screen without ever naming it becomes a "shown" procedure rule cited by its step.
 * The portal map comes from the dom steps (data-field markers and clicked links).
 */
import type { Citation, PortalPage, SkillRule } from "@/contracts";
import { sentences } from "@/learn/deterministic";
import { stepQuote } from "./citations";
import { evidencePages } from "./segment";
import type { Claim, Segmented, SkillDraft, StepView } from "./types";

const LABEL = /^(?:rules? i apply|rule\s+[\w-]+|step\s+[\w-]+|another open question|one more open question|open question)\s*:\s*/i;
const QUESTION_LABEL = /^(?:another\s+|one more\s+)?open question\s*:/i;
const NORMATIVE =
  /\b(must|has to|have to|needs? to|can't|cannot|must not|never|only|not allowed|no duplicate|may not|twice|should|required?|recommends?|recommend|dispute|approve|reject)\b/i;
const DECISION = /\b(recommend|dispute|approve|reject|credit memo|escalate)\b/i;
/** A record id such as HSG-1010 or E-101: a sentence naming one is about the item reviewed, not a rule. */
const RECORD_ID = /\b[A-Z]{1,5}-\d{2,}\b/;
const PROCEDURE = /\b(open|sign in|log in|click|go to|navigate|compare|look at|check the)\b/i;
const INTERIM = /\b(for now|until (?:then|resolved|we hear|confirmed))\b/i;
/** Reference values that follow a rule, e.g. "Senior Recruiter 95, Sourcer 70" or "fee up to 120, posting up to 400". */
const REFERENCE_LIST = /^(?:[A-Za-z][A-Za-z' ]*?\s(?:up to\s)?\$?\d[\d,]*(?:\.\d+)?)(?:\s*,\s*(?:and\s+)?[A-Za-z][A-Za-z' ]*?\s(?:up to\s)?\$?\d[\d,]*(?:\.\d+)?)+\.?$/;

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const sentence = (s: string) => {
  const t = cap(s.trim().replace(/[;,]\s*$/, ""));
  return /[.!?]$/.test(t) ? t : `${t}.`;
};

interface Clause {
  utterance_id: string;
  quote: string; // exact substring of the utterance
  question: boolean; // inside an "Open question:" utterance or ends with "?"
}

/** Clauses of every utterance, each an exact substring of its utterance text. */
export function clausesOf(seg: Segmented): Clause[] {
  const out: Clause[] = [];
  for (const u of seg.utterances) {
    const inQuestion = QUESTION_LABEL.test(u.text);
    for (const s of sentences(u.text)) {
      const body = s.replace(LABEL, "");
      for (const part of body.split(/;\s*/)) {
        const quote = part.trim().replace(/[.;]$/, "").trim();
        if (quote.length < 3 || !u.text.includes(quote)) continue;
        out.push({ utterance_id: u.id, quote, question: inQuestion || /\?$/.test(quote) });
      }
    }
  }
  return out;
}

function cite(seg: Segmented, utterance_id: string, quote: string): Citation {
  const u = seg.utterances.find((x) => x.id === utterance_id)!;
  const step = u.step_refs[0] ?? null;
  const s = step == null ? null : seg.steps[step];
  return { utterance_id, quote, step_index: s?.index ?? null, selector: s?.selector ?? null, url: s?.url ?? null };
}

export function deterministicClaims(seg: Segmented): Claim[] {
  return clausesOf(seg).map((c, i) => ({ id: `c${i + 1}`, text: sentence(c.quote), citations: [cite(seg, c.utterance_id, c.quote)] }));
}

const fieldOf = (sel: string | null) => sel?.match(/\[data-field=["']?([\w.-]+)["']?\]/)?.[1] ?? null;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

/** a[href="/portal/employees/E-101?week=2026-10-11"] -> a[href^="/portal/employees/"] (ids generalized). */
export function generalizeSelector(sel: string): string {
  const m = sel.match(/^a\[href="([^"]+)"\]$/);
  if (!m) return sel;
  const segs = m[1].split("?")[0].split("/");
  const keep: string[] = [];
  for (const s of segs) {
    if (/\d/.test(s)) break;
    keep.push(s);
  }
  return `a[href^="${keep.join("/")}/"]`;
}

/** Name of a followed link: its text, unless the text is a record id ("HSG-1010"), then "<record>_link". */
function linkName(text: string, selector: string): string {
  if (!/\d/.test(text)) return slug(text);
  const prefix = generalizeSelector(selector).match(/href\^="([^"]+)"/)?.[1] ?? "";
  const last = prefix.split("/").filter(Boolean).pop() ?? "record";
  return `${last.replace(/ies$/, "y").replace(/s$/, "")}_link`;
}

/** Pages where evidence is read, with the fields inspected (data-field) and links followed there. */
export function portalMapFromSteps(seg: Segmented): PortalPage[] {
  const pages = evidencePages(seg);
  const map = new Map<string, PortalPage>(pages.map((p) => [p, { page: p, fields: [] }]));
  for (const s of seg.steps) {
    if (s.kind !== "dom" || !s.page || !s.selector || !map.has(s.page)) continue;
    if (s.event !== "click") continue;
    const page = map.get(s.page)!;
    const field = fieldOf(s.selector);
    const entry = field
      ? { name: field, selector: `[data-field="${field}"]` }
      : s.text
        ? { name: linkName(s.text, s.selector), selector: generalizeSelector(s.selector) }
        : null;
    if (entry && entry.name && !page.fields.some((f) => f.name === entry.name)) page.fields.push(entry);
  }
  return pages.map((p) => map.get(p)!);
}

/** Fields the reviewer opened/inspected on screen (clicked data-field elements) that no utterance mentions. */
function shownOnly(seg: Segmented): StepView[] {
  const said = seg.utterances.map((u) => u.text.toLowerCase()).join(" ");
  const seen = new Set<string>();
  const out: StepView[] = [];
  for (const s of seg.steps) {
    const f = fieldOf(s.selector);
    if (s.kind !== "dom" || s.event !== "click" || !f || seen.has(f)) continue;
    seen.add(f);
    const words = f.replace(/[_.-]+/g, " ").toLowerCase();
    if (!said.includes(words)) out.push(s);
  }
  return out;
}

export function deterministicDraft(
  seg: Segmented,
  cfg: { title: string; vendorPattern?: RegExp; vendorNotStated: string },
): SkillDraft {
  const rules: SkillRule[] = [];
  /** Insertion-ordered: utterance id (labeled question) or a unique key -> its sentences. */
  const questionParts: Record<string, string[]> = {};
  type Last = { rule: SkillRule; clause: Clause };
  let last: Last | null = null as Last | null;
  for (const c of clausesOf(seg)) {
    const prev = last as Last | null;
    last = null;
    if (prev && prev.clause.utterance_id === c.utterance_id && (REFERENCE_LIST.test(c.quote) || /^otherwise\b/i.test(c.quote))) {
      // Extend the rule's quote over its reference values (one exact span of the same utterance).
      const text = seg.utterances.find((u) => u.id === c.utterance_id)!.text;
      const a = text.indexOf(prev.clause.quote);
      const b = text.indexOf(c.quote, a);
      if (a >= 0 && b > a) {
        const quote = text.slice(a, b + c.quote.length);
        prev.rule.text = sentence(quote);
        prev.rule.citations = [cite(seg, c.utterance_id, quote)];
        last = { rule: prev.rule, clause: { ...c, quote } };
      }
      continue;
    }
    if (c.question) {
      if (INTERIM.test(c.quote) && NORMATIVE.test(c.quote)) {
        rules.push({ id: "", text: `Until resolved: ${sentence(c.quote.replace(/^for now,?\s*/i, ""))}`, kind: "check", source: "said", citations: [cite(seg, c.utterance_id, c.quote)] });
      } else {
        // An "Open question:" utterance stays one question with its context; elsewhere each "?" clause is one.
        const labeled = QUESTION_LABEL.test(seg.utterances.find((u) => u.id === c.utterance_id)!.text);
        const key = labeled ? c.utterance_id : `${c.utterance_id}#${Object.keys(questionParts).length}`;
        (questionParts[key] ??= []).push(sentence(c.quote));
      }
      continue;
    }
    // Statements about the specific item reviewed (they name a record id such as HSG-1010) are not rules.
    if (RECORD_ID.test(c.quote)) continue;
    const procedure = PROCEDURE.test(c.quote) && /\b(each|every|compare)\b/i.test(c.quote);
    if (!NORMATIVE.test(c.quote) && !procedure && !/\b(tie|equal)\b/i.test(c.quote)) continue;
    const kind: SkillRule["kind"] = DECISION.test(c.quote) ? "decision" : PROCEDURE.test(c.quote) && !NORMATIVE.test(c.quote) ? "procedure" : "check";
    const rule: SkillRule = { id: "", text: sentence(c.quote), kind, source: "said", citations: [cite(seg, c.utterance_id, c.quote)] };
    rules.push(rule);
    last = { rule, clause: c };
  }
  for (const s of shownOnly(seg)) {
    const f = fieldOf(s.selector)!;
    rules.push({
      id: "",
      text: `Read the ${f.replace(/[_.-]+/g, " ")} field on ${s.page}.`,
      kind: "procedure",
      source: "shown",
      citations: [{ utterance_id: null, quote: stepQuote(s), step_index: s.index, selector: s.selector, url: s.url }],
    });
  }
  let vendor = cfg.vendorNotStated;
  if (cfg.vendorPattern) {
    for (const u of seg.utterances) {
      const m = u.text.match(cfg.vendorPattern);
      if (m?.[1]) {
        vendor = m[1].trim();
        break;
      }
    }
  }
  const uniq = rules.filter((r, i) => rules.findIndex((x) => x.text === r.text) === i);
  return {
    title: cfg.title,
    vendor,
    rules: uniq.map((r, i) => ({ ...r, id: `r${i + 1}` })),
    portal_map: portalMapFromSteps(seg),
    open_questions: [...new Set(Object.values(questionParts).map((p) => p.join(" ")))],
  };
}
