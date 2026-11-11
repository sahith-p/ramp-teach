/**
 * Paths + validated readers for the pillar data (contracts/pillars.ts). Every lane reads and writes through
 * these so the UI, the learner, the evals and the engine agree on where things live.
 *
 *   skills/<skill_id>/v<n>/            SKILL.md, skill.json (SkillVersion), checks/*.py, stages/*.json   (committed)
 *   skills/<skill_id>/active.json      { "version": n }                                                  (committed)
 *   evals/cases/*.json                 SkillEvalCase                                                       (committed)
 *   evals/recordings/*.json            eval recordings                                                     (committed)
 *   evals/runs/<run_id>.json           SkillEvalRun                                                        (committed when real)
 *   runtime/recordings/<id>.json|.webm recordings sent from the extension + their audio                    (gitignored)
 *   runs/<invoice_id>/spans.jsonl      Span per model turn / tool call / step                              (committed for the real run)
 *   runs/<invoice_id>/evidence-check.json  EvidenceCheckReport                                            (committed for the real run)
 *   runs/<invoice_id>/live/frame.jpg   latest frame of the agent's browser while it runs                   (gitignored)
 */
import fs from "node:fs";
import path from "node:path";
import {
  EvidenceCheckReportSchema,
  RouteDecisionSchema,
  type RouteDecision,
  RecordingSchema,
  SkillEvalCaseSchema,
  SkillEvalRunSchema,
  SkillVersionSchema,
  SpanSchema,
  type EvidenceCheckReport,
  type Recording,
  type SkillEvalCase,
  type SkillEvalRun,
  type SkillVersion,
  type Span,
} from "@/contracts";
import { P, ROOT, runDir } from "./paths";

export const DEFAULT_SKILL_ID = "halcyon-invoice-review";

export const PP = {
  skills: path.join(ROOT, "skills"),
  evals: path.join(ROOT, "evals"),
  evalCases: path.join(ROOT, "evals", "cases"),
  evalRecordings: path.join(ROOT, "evals", "recordings"),
  evalRuns: path.join(ROOT, "evals", "runs"),
  recordings: path.join(P.runtime, "recordings"),
};

export const skillDir = (skillId: string) => path.join(PP.skills, skillId);
export const skillVersionDir = (skillId: string, v: number) => path.join(skillDir(skillId), `v${v}`);
export const spansPath = (invoiceId: string) => path.join(runDir(invoiceId), "spans.jsonl");
export const evidenceCheckPath = (invoiceId: string) => path.join(runDir(invoiceId), "evidence-check.json");
export const liveFramePath = (invoiceId: string) => path.join(runDir(invoiceId), "live", "frame.jpg");
export const rel = (abs: string) => path.relative(ROOT, abs).split(path.sep).join("/");

function readJson<T>(file: string, parse: (x: unknown) => T): T | null {
  if (!fs.existsSync(file)) return null;
  return parse(JSON.parse(fs.readFileSync(file, "utf8")));
}
function readJsonl<T>(file: string, parse: (x: unknown) => T): T[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => parse(JSON.parse(l)));
}

/* ------------------------------- skills ------------------------------- */

export function listSkillIds(): string[] {
  if (!fs.existsSync(PP.skills)) return [];
  return fs.readdirSync(PP.skills).filter((d) => fs.statSync(path.join(PP.skills, d)).isDirectory());
}

export function listSkillVersions(skillId = DEFAULT_SKILL_ID): SkillVersion[] {
  const dir = skillDir(skillId);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((d) => /^v\d+$/.test(d))
    .map((d) => readJson(path.join(dir, d, "skill.json"), (x) => SkillVersionSchema.parse(x)))
    .filter((x): x is SkillVersion => x !== null)
    .sort((a, b) => a.version - b.version);
}

export function getSkillVersion(skillId: string, version: number): SkillVersion | null {
  return readJson(path.join(skillVersionDir(skillId, version), "skill.json"), (x) => SkillVersionSchema.parse(x));
}

export function activeSkillVersion(skillId = DEFAULT_SKILL_ID): number | null {
  const a = readJson(path.join(skillDir(skillId), "active.json"), (x) => x as { version?: number });
  return a?.version ?? null;
}

export function getActiveSkill(skillId = DEFAULT_SKILL_ID): SkillVersion | null {
  const v = activeSkillVersion(skillId);
  return v == null ? null : getSkillVersion(skillId, v);
}

export function setActiveSkill(skillId: string, version: number): void {
  fs.mkdirSync(skillDir(skillId), { recursive: true });
  fs.writeFileSync(path.join(skillDir(skillId), "active.json"), JSON.stringify({ version }, null, 2) + "\n");
}

/* ------------------------------- evals ------------------------------- */

export function listEvalCases(): SkillEvalCase[] {
  if (!fs.existsSync(PP.evalCases)) return [];
  return fs
    .readdirSync(PP.evalCases)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => SkillEvalCaseSchema.parse(JSON.parse(fs.readFileSync(path.join(PP.evalCases, f), "utf8"))));
}

export function listEvalRuns(skillId?: string): SkillEvalRun[] {
  if (!fs.existsSync(PP.evalRuns)) return [];
  return fs
    .readdirSync(PP.evalRuns)
    .filter((f) => f.endsWith(".json"))
    .map((f) => SkillEvalRunSchema.parse(JSON.parse(fs.readFileSync(path.join(PP.evalRuns, f), "utf8"))))
    .filter((r) => !skillId || r.skill_id === skillId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export function getEvalRun(id: string): SkillEvalRun | null {
  return readJson(path.join(PP.evalRuns, `${id}.json`), (x) => SkillEvalRunSchema.parse(x));
}

/* ------------------------------- recordings ------------------------------- */

export function listRecordings(): { id: string; recording: Recording; file: string }[] {
  const out: { id: string; recording: Recording; file: string }[] = [];
  for (const dir of [PP.recordings, PP.evalRecordings, path.join(ROOT, "extension", "recordings")]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      try {
        const recording = RecordingSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
        out.push({ id: recording.session_id, recording, file: rel(path.join(dir, f)) });
      } catch {
        /* not a recording */
      }
    }
  }
  return out.sort((a, b) => b.recording.started_at.localeCompare(a.recording.started_at));
}

export function getRecording(sessionId: string): { recording: Recording; file: string } | null {
  return listRecordings().find((r) => r.id === sessionId) ?? null;
}

/* ------------------------------- runs ------------------------------- */

export function readSpans(invoiceId: string): Span[] {
  return readJsonl(spansPath(invoiceId), (x) => SpanSchema.parse(x));
}

export function appendSpan(invoiceId: string, span: Span): void {
  const f = spansPath(invoiceId);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.appendFileSync(f, JSON.stringify(SpanSchema.parse(span)) + "\n");
}

export function readEvidenceCheck(invoiceId: string): EvidenceCheckReport | null {
  return readJson(evidenceCheckPath(invoiceId), (x) => EvidenceCheckReportSchema.parse(x));
}

export const routePath = (invoiceId: string) => path.join(runDir(invoiceId), "route.json");
export function readRoute(invoiceId: string): RouteDecision | null {
  return readJson(routePath(invoiceId), (x) => RouteDecisionSchema.parse(x));
}
