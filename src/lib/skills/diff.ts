/**
 * diffSkills(a, b): what changed from skill version a to b. Rule ids are positional (r1, r2, ...), so rules are
 * matched by text: identical text = unchanged (or changed if kind/source/citations moved), similar text (word
 * overlap >= 0.5) = changed, the rest added / removed. Portal pages are matched by path template.
 */
import type { PortalPage, SkillRule, SkillVersion } from "@/contracts";

export interface RuleChange {
  before: SkillRule;
  after: SkillRule;
  fields: ("text" | "kind" | "source" | "citations")[];
}

export interface SkillDiff {
  from: { skill_id: string; version: number };
  to: { skill_id: string; version: number };
  vendor: { before: string; after: string } | null;
  rules: { added: SkillRule[]; removed: SkillRule[]; changed: RuleChange[]; unchanged: number };
  portal_map: {
    pages_added: PortalPage[];
    pages_removed: PortalPage[];
    fields_changed: { page: string; added: PortalPage["fields"]; removed: PortalPage["fields"] }[];
  };
  open_questions: { added: string[]; removed: string[] };
  /** True when nothing above changed. */
  same: boolean;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9.$ ]+/g, " ").replace(/\s+/g, " ").trim();
const words = (s: string) => new Set(norm(s).split(" ").filter((w) => w.length > 1));

export function similarity(a: string, b: string): number {
  const A = words(a);
  const B = words(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

const citeKey = (r: SkillRule) =>
  r.citations
    .map((c) => `${c.utterance_id ?? "-"}|${c.quote}|${c.step_index ?? "-"}`)
    .sort()
    .join("\n");

function fieldsChanged(a: SkillRule, b: SkillRule): RuleChange["fields"] {
  const f: RuleChange["fields"] = [];
  if (norm(a.text) !== norm(b.text)) f.push("text");
  if (a.kind !== b.kind) f.push("kind");
  if (a.source !== b.source) f.push("source");
  if (citeKey(a) !== citeKey(b)) f.push("citations");
  return f;
}

export function diffSkills(a: SkillVersion, b: SkillVersion): SkillDiff {
  const left = [...a.rules];
  const right = [...b.rules];
  const changed: RuleChange[] = [];
  let unchanged = 0;

  // 1. identical text
  for (let i = right.length - 1; i >= 0; i--) {
    const j = left.findIndex((l) => norm(l.text) === norm(right[i].text));
    if (j < 0) continue;
    const f = fieldsChanged(left[j], right[i]);
    if (f.length) changed.push({ before: left[j], after: right[i], fields: f });
    else unchanged++;
    left.splice(j, 1);
    right.splice(i, 1);
  }
  // 2. most similar pairs first
  const pairs: { i: number; j: number; s: number }[] = [];
  right.forEach((r, i) => left.forEach((l, j) => pairs.push({ i, j, s: similarity(l.text, r.text) })));
  pairs.sort((x, y) => y.s - x.s);
  const usedL = new Set<number>();
  const usedR = new Set<number>();
  for (const p of pairs) {
    if (p.s < 0.5) break;
    if (usedL.has(p.j) || usedR.has(p.i)) continue;
    usedL.add(p.j);
    usedR.add(p.i);
    changed.push({ before: left[p.j], after: right[p.i], fields: fieldsChanged(left[p.j], right[p.i]) });
  }
  const added = right.filter((_, i) => !usedR.has(i));
  const removed = left.filter((_, j) => !usedL.has(j));

  const pa = new Map(a.portal_map.map((p) => [p.page, p]));
  const pb = new Map(b.portal_map.map((p) => [p.page, p]));
  const pages_added = b.portal_map.filter((p) => !pa.has(p.page));
  const pages_removed = a.portal_map.filter((p) => !pb.has(p.page));
  const fields_changed: SkillDiff["portal_map"]["fields_changed"] = [];
  for (const p of b.portal_map) {
    const old = pa.get(p.page);
    if (!old) continue;
    const key = (f: { name: string; selector: string }) => `${f.name}|${f.selector}`;
    const oldK = new Set(old.fields.map(key));
    const newK = new Set(p.fields.map(key));
    const fa = p.fields.filter((f) => !oldK.has(key(f)));
    const fr = old.fields.filter((f) => !newK.has(key(f)));
    if (fa.length || fr.length) fields_changed.push({ page: p.page, added: fa, removed: fr });
  }

  const qa = new Set(a.open_questions.map(norm));
  const qb = new Set(b.open_questions.map(norm));
  const open_questions = { added: b.open_questions.filter((q) => !qa.has(norm(q))), removed: a.open_questions.filter((q) => !qb.has(norm(q))) };
  const vendor = a.vendor !== b.vendor ? { before: a.vendor, after: b.vendor } : null;

  return {
    from: { skill_id: a.skill_id, version: a.version },
    to: { skill_id: b.skill_id, version: b.version },
    vendor,
    rules: { added, removed, changed, unchanged },
    portal_map: { pages_added, pages_removed, fields_changed },
    open_questions,
    same:
      !vendor &&
      !added.length &&
      !removed.length &&
      !changed.length &&
      !pages_added.length &&
      !pages_removed.length &&
      !fields_changed.length &&
      !open_questions.added.length &&
      !open_questions.removed.length,
  };
}
