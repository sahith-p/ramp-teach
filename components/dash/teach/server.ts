/**
 * Server-only readers for the Bill Pay workflow pages and the /api/teach + /api/runs routes.
 * Built on lib/pillars. Readers lib/pillars does not have (yet) live here:
 *   runs/<id>/live/status.json, runtime/recordings/<id>.peaks.json, the learn job's stages
 *   (runtime/learn-job.json), the run list per workflow, and safe file resolution for images/audio.
 * Every reader is lenient: a missing or malformed file reads as "nothing yet", never as a crash.
 */
import fs from "node:fs";
import path from "node:path";
import {
  EvidenceBundleSchema,
  type EvidenceBundle,
  type EvidenceCheckReport,
  type Recording,
  type RouteDecision,
  type SkillEvalCase,
  type SkillEvalRun,
  type SkillVersion,
  type Span,
} from "@/contracts";
import { readJobs, type AgentJob } from "@/lib/dash";
import { readLearnJob } from "@/lib/learnjob";
import { P, ROOT, runDir } from "@/lib/paths";
import {
  DEFAULT_SKILL_ID,
  PP,
  activeSkillVersion,
  getRecording,
  liveFramePath,
  listEvalCases,
  listEvalRuns,
  listRecordings,
  listSkillIds,
  listSkillVersions,
  readEvidenceCheck,
  readRoute,
  readSpans,
} from "@/lib/pillars";
import { readReceipt } from "@/lib/store/receipts";
import { casesCoveringRule, normalizePeaks, recordingDuration, runTotals, STAGES, stepLabel } from "./logic";

export const SAFE_REC_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
export const SAFE_INVOICE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export const SAFE_SKILL_ID = /^[a-z0-9][a-z0-9_-]{0,79}$/;

function tryJson(file: string): unknown {
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
  } catch {
    return null;
  }
}
function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/* --------------------------------- runs --------------------------------- */

export interface LiveStatus {
  running: boolean;
  url: string | null;
  updated_at: string | null;
  has_frame: boolean;
  frame_at: number | null;
}

/** runs/<id>/live/status.json + frame presence. Running needs a fresh status or a live agent job. */
export function readLiveStatus(invoiceId: string, job?: AgentJob): LiveStatus {
  const raw = (tryJson(path.join(runDir(invoiceId), "live", "status.json")) ?? {}) as Record<string, unknown>;
  const frame = liveFramePath(invoiceId);
  const st = safe(() => fs.statSync(frame), null);
  const updated = typeof raw.updated_at === "string" ? raw.updated_at : null;
  const fresh = updated ? Date.now() - Date.parse(updated) < 15_000 : false;
  const flag = raw.running === true || raw.status === "running";
  return {
    running: (flag && (fresh || job?.status === "running")) || (job?.status === "running" && !!st && Date.now() - st.mtimeMs < 15_000),
    url: typeof raw.url === "string" ? raw.url : null,
    updated_at: updated,
    has_frame: !!st,
    frame_at: st ? Math.round(st.mtimeMs) : null,
  };
}

export interface RunView {
  invoice_id: string;
  route: RouteDecision | null;
  spans: Span[];
  evidence: EvidenceCheckReport | null;
  /** runs/<id>/evidence.json when there is no evidence-check.json yet (values without a re-check). */
  bundle: EvidenceBundle | null;
  live: LiveStatus;
  job: AgentJob | null;
  totals: ReturnType<typeof runTotals>;
}

export function runView(invoiceId: string): RunView {
  const job = readJobs()[invoiceId] ?? null;
  const spans = safe(() => readSpans(invoiceId), [] as Span[]);
  const evidence = safe(() => readEvidenceCheck(invoiceId), null);
  const bundleRaw = evidence ? null : tryJson(path.join(runDir(invoiceId), "evidence.json"));
  const bundle = bundleRaw ? safe(() => EvidenceBundleSchema.parse(bundleRaw), null) : null;
  // Image paths the page can actually load (screenshots of older runs are not always kept).
  const img = (p: unknown) => (typeof p === "string" && resolveRunImage(invoiceId, p) ? p : null);
  return {
    invoice_id: invoiceId,
    route: safe(() => readRoute(invoiceId), null),
    spans: spans.map((s) => (typeof s.attrs.screenshot === "string" && !img(s.attrs.screenshot) ? { ...s, attrs: { ...s.attrs, screenshot: undefined } } : s)),
    evidence: evidence ? { ...evidence, checks: evidence.checks.map((c) => ({ ...c, screenshot: img(c.screenshot) })) } : null,
    bundle: bundle ? { ...bundle, items: bundle.items.map((i) => ({ ...i, screenshot: img(i.screenshot) })) } : null,
    live: readLiveStatus(invoiceId, job ?? undefined),
    job,
    totals: runTotals(spans),
  };
}

export interface RunSummary {
  invoice_id: string;
  workflow_id: string | null;
  version: number | null;
  started_at: string | null;
  duration_ms: number;
  turns: number;
  tokens: number;
  cost_usd: number | null;
  running: boolean;
  recommendation: string | null;
}

/** All runs (runs/<invoice_id>/ with a route or spans), newest first. */
export function listRuns(skillId?: string): RunSummary[] {
  if (!fs.existsSync(P.runs)) return [];
  const jobs = readJobs();
  const out: RunSummary[] = [];
  for (const id of fs.readdirSync(P.runs)) {
    if (!SAFE_INVOICE_ID.test(id) || !safe(() => fs.statSync(path.join(P.runs, id)).isDirectory(), false)) continue;
    const route = safe(() => readRoute(id), null);
    const spans = safe(() => readSpans(id), [] as Span[]);
    if (!route && !spans.length) continue;
    const wf = route ? route.workflow_id : DEFAULT_SKILL_ID;
    if (skillId && wf !== skillId) continue;
    if (route && !route.workflow_id && !spans.length && skillId) continue;
    const t = runTotals(spans);
    const receipt = safe(() => readReceipt(id), null);
    out.push({
      invoice_id: id,
      workflow_id: wf,
      version: route?.version ?? null,
      started_at: spans.length ? spans.map((s) => s.start).sort()[0] : (route?.decided_at ?? null),
      duration_ms: t.duration_ms,
      turns: t.turns,
      tokens: t.tokens,
      cost_usd: t.cost_usd,
      running: readLiveStatus(id, jobs[id]).running || jobs[id]?.status === "running",
      recommendation: receipt?.recommendation ?? null,
    });
  }
  return out.sort((a, b) => (b.started_at ?? "").localeCompare(a.started_at ?? ""));
}

/** A repo-relative image path under runs/<invoiceId>/, resolved safely (null if not allowed / missing). */
export function resolveRunImage(invoiceId: string, rel: string): string | null {
  if (!SAFE_INVOICE_ID.test(invoiceId)) return null;
  const norm = rel.replace(/\\/g, "/");
  if (!norm.startsWith(`runs/${invoiceId}/`) || norm.includes("..") || !/\.(png|jpe?g|webp)$/i.test(norm)) return null;
  const abs = path.resolve(ROOT, norm);
  if (!abs.startsWith(path.resolve(runDir(invoiceId)) + path.sep)) return null;
  return fs.existsSync(abs) ? abs : null;
}

/* -------------------------------- skills -------------------------------- */

export type EvalState = "passed" | "blocked" | null;

export interface WorkflowSummary {
  skill_id: string;
  title: string;
  vendor: string;
  active_version: number | null;
  latest_version: number | null;
  versions: number;
  rules: number;
  last_run: RunSummary | null;
  eval_state: EvalState;
  mode: string;
}

function evalFor(runs: SkillEvalRun[], v: SkillVersion | undefined): SkillEvalRun | null {
  if (!v) return null;
  return (v.eval_run_id ? runs.find((r) => r.id === v.eval_run_id) : null) ?? runs.filter((r) => r.version === v.version).at(-1) ?? null;
}

export function listWorkflows(): WorkflowSummary[] {
  const all = safe(() => listEvalRuns(), [] as SkillEvalRun[]);
  return safe(() => listSkillIds(), [] as string[])
    .map((id): WorkflowSummary | null => {
      const versions = safe(() => listSkillVersions(id), [] as SkillVersion[]);
      if (!versions.length) return null;
      const activeV = safe(() => activeSkillVersion(id), null);
      const active = versions.find((v) => v.version === activeV);
      const shown = active ?? versions.at(-1)!;
      const ev = evalFor(
        all.filter((r) => r.skill_id === id),
        shown,
      );
      return {
        skill_id: id,
        title: shown.title,
        vendor: shown.vendor,
        active_version: active?.version ?? null,
        latest_version: versions.at(-1)!.version,
        versions: versions.length,
        rules: shown.rules.length,
        last_run: listRuns(id)[0] ?? null,
        eval_state: ev ? (ev.gate.passed ? "passed" : "blocked") : null,
        mode: shown.mode,
      };
    })
    .filter((x): x is WorkflowSummary => x !== null);
}

export interface RecordingSummary {
  id: string;
  started_at: string;
  duration_s: number;
  words: number;
  steps: number;
  speech: { provider: string; model: string | null; mode: string } | null;
  has_audio: boolean;
  learned: { skill_id: string; version: number }[];
}

function audioFile(id: string, rec: Recording): string | null {
  const cands = [rec.audio?.path, `runtime/recordings/${id}.webm`].filter((x): x is string => !!x);
  for (const c of cands) {
    const norm = c.replace(/\\/g, "/");
    if (norm.includes("..") || !/^(runtime\/recordings|evals\/recordings|extension\/recordings)\/[A-Za-z0-9_.-]+\.(webm|ogg|mp3|wav|m4a)$/.test(norm)) continue;
    const abs = path.join(ROOT, norm);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

export function recordingAudio(id: string): { file: string; mime: string } | null {
  if (!SAFE_REC_ID.test(id)) return null;
  const r = safe(() => getRecording(id), null);
  if (!r) return null;
  const file = audioFile(id, r.recording);
  if (!file) return null;
  const ext = path.extname(file).slice(1).toLowerCase();
  const mime = r.recording.audio?.mime ?? ({ webm: "audio/webm", ogg: "audio/ogg", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4" } as Record<string, string>)[ext] ?? "application/octet-stream";
  return { file, mime };
}

function learnedFrom(id: string): { skill_id: string; version: number }[] {
  const out: { skill_id: string; version: number }[] = [];
  for (const sid of safe(() => listSkillIds(), [] as string[]))
    for (const v of safe(() => listSkillVersions(sid), [] as SkillVersion[])) if (v.recordings.includes(id)) out.push({ skill_id: sid, version: v.version });
  return out;
}

function summarize(id: string, rec: Recording): RecordingSummary {
  return {
    id,
    started_at: rec.started_at,
    duration_s: recordingDuration(rec),
    words: (rec.speech?.utterances ?? []).reduce((n, u) => n + u.words.length, 0),
    steps: rec.steps.filter((s) => s.kind === "dom").length,
    speech: rec.speech ? { provider: rec.speech.provider, model: rec.speech.model, mode: rec.speech.mode } : null,
    has_audio: !!audioFile(id, rec),
    learned: learnedFrom(id),
  };
}

export interface RecordingView extends RecordingSummary {
  recording: Recording;
  peaks: number[] | null;
}

export function recordingView(id: string): RecordingView | null {
  if (!SAFE_REC_ID.test(id)) return null;
  const r = safe(() => getRecording(id), null);
  if (!r) return null;
  const peaks = normalizePeaks(tryJson(path.join(PP.recordings, `${id}.peaks.json`)));
  return { ...summarize(id, r.recording), recording: r.recording, peaks };
}

export interface WorkflowDetail {
  summary: WorkflowSummary;
  versions: SkillVersion[];
  active_version: number | null;
  evals: SkillEvalRun[];
  cases: SkillEvalCase[];
  runs: RunSummary[];
  recordings: RecordingSummary[];
}

export function workflowDetail(skillId: string): WorkflowDetail | null {
  if (!SAFE_SKILL_ID.test(skillId)) return null;
  const summary = listWorkflows().find((w) => w.skill_id === skillId);
  if (!summary) return null;
  const versions = safe(() => listSkillVersions(skillId), [] as SkillVersion[]);
  const recIds = new Set(versions.flatMap((v) => v.recordings));
  const recordings = safe(() => listRecordings(), [] as ReturnType<typeof listRecordings>)
    .filter((r) => recIds.has(r.id))
    .map((r) => summarize(r.id, r.recording));
  return {
    summary,
    versions,
    active_version: summary.active_version,
    evals: safe(() => listEvalRuns(skillId), [] as SkillEvalRun[]),
    cases: safe(() => listEvalCases(), [] as SkillEvalCase[]),
    runs: listRuns(skillId),
    recordings,
  };
}

/** The eval run that belongs to a version (its eval_run_id, else the latest for that version). */
export function evalForVersion(d: WorkflowDetail, version: number): SkillEvalRun | null {
  return evalFor(
    d.evals,
    d.versions.find((v) => v.version === version),
  );
}

/* ------------------------------ learn job ------------------------------ */

export type StageStatus = "done" | "running" | "pending" | "failed";

export interface LearnView {
  status: "running" | "done" | "failed";
  session_id: string;
  started_at: string;
  finished_at: string | null;
  skill_id: string | null;
  title: string | null;
  version: number | null;
  stages: { name: string; status: StageStatus; started_at: string | null; finished_at: string | null; mode: string | null }[];
}

/**
 * runtime/learn-job.json. Stages are read from the job file when the learner writes them
 * (`stages: [{name, status?, started_at?, finished_at?, mode?}]`, `skill_id`, `version`), else from the
 * learned version's own stages once it exists.
 */
export function learnView(): LearnView | null {
  const job = readLearnJob();
  if (!job) return null;
  const raw = (tryJson(path.join(P.runtime, "learn-job.json")) ?? {}) as Record<string, unknown>;
  let skillId = typeof raw.skill_id === "string" ? raw.skill_id : null;
  let version = typeof raw.version === "number" ? raw.version : null;
  if (job.status !== "running" && (!skillId || !version)) {
    const hit = learnedFrom(job.session_id).at(-1);
    if (hit) {
      skillId = skillId ?? hit.skill_id;
      version = version ?? hit.version;
    }
  }
  const learned = skillId && version ? safe(() => listSkillVersions(skillId!), [] as SkillVersion[]).find((v) => v.version === version) : undefined;
  const fromJob = Array.isArray(raw.stages) ? (raw.stages as Record<string, unknown>[]) : [];
  const stages = STAGES.map((name) => {
    const s = fromJob.find((x) => x && x.name === name);
    // The learned version's own stage log only describes a finished job.
    const ls = job.status !== "running" ? learned?.stages.find((x) => x.name === name) : undefined;
    const started = (s?.started_at as string | undefined) ?? ls?.started_at ?? null;
    const finished = (s?.finished_at as string | undefined) ?? ls?.finished_at ?? null;
    let status: StageStatus =
      (s?.status as StageStatus | undefined) ?? (finished ? "done" : started ? "running" : raw.current_stage === name ? "running" : "pending");
    if (job.status === "done" && learned && status !== "failed") status = "done";
    if (job.status === "failed" && status === "running") status = "failed";
    return { name, status, started_at: started, finished_at: finished, mode: ((s?.mode as string | undefined) ?? ls?.mode ?? null) as string | null };
  });
  return {
    status: job.status,
    session_id: job.session_id,
    started_at: job.started_at,
    finished_at: job.finished_at ?? null,
    skill_id: skillId,
    title: learned?.title ?? (skillId ? (listWorkflows().find((w) => w.skill_id === skillId)?.title ?? null) : null),
    version: job.status === "done" ? version : null,
    stages,
  };
}

/* ------------------------------ rule lineage ------------------------------ */

export interface RuleLineageRow {
  rule: SkillVersion["rules"][number];
  cites: {
    quote: string;
    clip: { recording: string; start: number; end: number; audio: boolean } | null;
    step: { kind: string; text: string; selector: string | null; url: string | null } | null;
  }[];
  cases: string[];
}

/** Each rule's citations resolved against the version's recordings (utterance timing, linked step, audio). */
export function ruleLineage(d: WorkflowDetail, version: SkillVersion): RuleLineageRow[] {
  const recs = version.recordings.map((id) => recordingView(id)).filter((r): r is RecordingView => r !== null);
  return version.rules.map((rule) => ({
    rule,
    cases: casesCoveringRule(rule, d.cases),
    cites: rule.citations.map((c) => {
      let clip: RuleLineageRow["cites"][number]["clip"] = null;
      let rec: RecordingView | undefined;
      if (c.utterance_id) {
        for (const r of recs) {
          const u = r.recording.speech?.utterances.find((x) => x.id === c.utterance_id);
          if (u) {
            rec = r;
            clip = { recording: r.id, start: u.start, end: u.end, audio: r.has_audio };
            break;
          }
        }
      }
      rec = rec ?? recs[0];
      const st = c.step_index != null ? rec?.recording.steps[c.step_index] : undefined;
      const label = st ? stepLabel(st) : null;
      const step =
        st || c.selector || c.url
          ? {
              kind: label ? `${label.kind}${label.text ? ` · ${label.text}` : ""}` : "Click",
              text: label?.text ?? "",
              selector: c.selector ?? st?.detail.selector ?? null,
              url: c.url ?? st?.detail.url ?? null,
            }
          : null;
      return { quote: c.quote, clip, step };
    }),
  }));
}
