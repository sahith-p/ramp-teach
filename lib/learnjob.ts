/**
 * LEARN from a recording sent by the Recorder extension ("Send to Ramp"): save it under runtime/recordings/,
 * run the skill learner (`learn/skill/cli.ts --recording <file> --job`) in a child process, and keep live stage
 * progress in runtime/learn-job.json for the UI to poll:
 *   { status, session_id, skill_id, version, stages: [{ name, status, started_at, finished_at, mode }], ... }
 * The child writes stage updates (jobStageEvent, jobSetVersion); this process writes the start and the end.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { LearnMetaSchema, RecordingSchema, WorkflowSpecSchema, type PillarMode, type Recording } from "@/contracts";
import { P, ROOT } from "@/lib/paths";
import { DEFAULT_SKILL_ID, getActiveSkill, getSkillVersion } from "@/lib/pillars";

const STAGES = ["segment", "claims", "synthesize", "critique", "checks", "package"] as const;
type StageName = (typeof STAGES)[number];
type StageStatus = "pending" | "running" | "done" | "skipped" | "failed";

export interface LearnJobStage {
  name: StageName;
  status: StageStatus;
  started_at: string | null;
  finished_at: string | null;
  mode?: PillarMode | null;
  note?: string | null;
}

export interface LearnJob {
  status: "running" | "done" | "failed";
  started_at: string;
  finished_at?: string;
  session_id: string;
  recording_path: string;
  operator: "human" | "scripted_playwright";
  pid?: number;
  skill_id?: string;
  version?: number | null;
  stages?: LearnJobStage[];
}

/** runtime/learn-job.json (RAMP_TEACH_LEARN_JOB overrides it, for tests). */
export const jobFile = () => process.env.RAMP_TEACH_LEARN_JOB ?? path.join(P.runtime, "learn-job.json");
const REC_DIR = path.join(P.runtime, "recordings");

function writeJob(job: LearnJob) {
  const f = jobFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(job, null, 2) + "\n");
  fs.renameSync(tmp, f);
}

function readJobFile(): LearnJob | null {
  try {
    return JSON.parse(fs.readFileSync(jobFile(), "utf8")) as LearnJob;
  } catch {
    return null;
  }
}

export function readLearnJob(): LearnJob | null {
  const j = readJobFile();
  if (j && j.status === "running" && j.pid) {
    try {
      process.kill(j.pid, 0);
    } catch {
      return { ...j, status: "failed" };
    }
  }
  return j;
}

export const pendingStages = (): LearnJobStage[] => STAGES.map((name) => ({ name, status: "pending", started_at: null, finished_at: null }));

/** Child side: the learner reserved its version. */
export function jobSetVersion(skillId: string, version: number): void {
  const j = readJobFile();
  if (!j) return;
  writeJob({ ...j, skill_id: skillId, version });
}

/** Child side: one stage changed status. */
export function jobStageEvent(ev: { name: string; status: StageStatus; at: string; mode?: PillarMode; note?: string }): void {
  const j = readJobFile();
  if (!j) return;
  const stages = (j.stages ?? pendingStages()).map((s) =>
    s.name !== ev.name
      ? s
      : {
          ...s,
          status: ev.status,
          started_at: ev.status === "running" ? ev.at : (s.started_at ?? ev.at),
          finished_at: ev.status === "running" ? null : ev.at,
          mode: ev.mode ?? s.mode ?? null,
          note: ev.note ?? null,
        },
  );
  writeJob({ ...j, stages });
}

/** Save the recording (it may carry audio/speech fields) and start the skill learner in the background. */
export function startLearn(raw: unknown, operator: "human" | "scripted_playwright"): LearnJob {
  const rec = RecordingSchema.parse(raw);
  if (rec.steps.length > 1000) throw new Error("recording too long");
  const name = rec.session_id.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80) || "recording";
  fs.mkdirSync(REC_DIR, { recursive: true });
  const rel = `runtime/recordings/${name}.json`;
  fs.writeFileSync(path.join(ROOT, rel), JSON.stringify(rec, null, 2) + "\n");
  const log = fs.openSync(path.join(P.runtime, "learn-job.log"), "w");
  const job: LearnJob = {
    status: "running",
    started_at: new Date().toISOString(),
    session_id: rec.session_id,
    recording_path: rel,
    operator,
    skill_id: DEFAULT_SKILL_ID,
    version: null,
    stages: pendingStages(),
  };
  writeJob(job);
  const child = spawn("npx", ["tsx", "learn/skill/cli.ts", "--recording", rel, "--job"], { cwd: ROOT, env: process.env, stdio: ["ignore", log, log] });
  writeJob({ ...job, pid: child.pid });
  child.on("exit", (code) => {
    const latest = readJobFile() ?? job;
    const stages = (latest.stages ?? []).map((s) => (code !== 0 && s.status === "running" ? { ...s, status: "failed" as const } : s));
    writeJob({ ...latest, stages, status: code === 0 ? "done" : "failed", finished_at: new Date().toISOString() });
    fs.closeSync(log);
  });
  return { ...job, pid: child.pid };
}

/** Plain-words line for a finished stage (UI copy: no jargon, no em dashes). */
export function stageLine(s: LearnJobStage, version?: number | null): string | null {
  const real = s.mode === "real";
  if (s.status === "failed") return `Stopped while ${s.name === "package" ? "saving" : "learning"} (${s.name})`;
  if (s.status === "skipped") return s.name === "checks" ? "Skipped testing checks in a sandbox (offline)" : null;
  if (s.status !== "done") return null;
  switch (s.name) {
    case "segment":
      return "Grouped your steps by page and lined up what you said";
    case "claims":
      return real ? "Claude listed what you said, quoting your words" : "Picked out what you said (offline, no AI)";
    case "synthesize":
      return real ? "Claude wrote the rules, each with a quote" : "Wrote the rules without AI (offline)";
    case "critique":
      return real ? "Claude checked every rule against the recording" : "Kept only rules backed by a quote";
    case "checks":
      return "Tested check scripts on past invoices in a sandbox";
    case "package":
      return `Saved skill version ${version ?? ""} as a draft`.replace("  ", " ");
  }
}

export function learnProgress(job: LearnJob | null): string[] {
  if (!job) return [];
  if (job.stages) return job.stages.map((s) => stageLine(s, job.version)).filter((x): x is string => !!x);
  // Jobs started before the skill learner: read learn/trace.jsonl as before.
  const f = path.join(ROOT, "learn", "trace.jsonl");
  if (!fs.existsSync(f)) return [];
  const out: string[] = [];
  for (const l of fs.readFileSync(f, "utf8").split("\n")) {
    if (!l) continue;
    const e = JSON.parse(l);
    if (e.ts < job.started_at) continue;
    if (e.step === "load_recording") out.push(`Read ${e.detail?.steps ?? ""} steps and ${e.detail?.narration ?? 0} spoken notes`);
    if (e.step === "distill.real") out.push("Claude turned them into rules");
    if (e.step === "distill.deterministic") out.push("Rules extracted without AI (offline)");
    if (e.step === "write_outputs") out.push(`Saved the workflow and ${e.detail?.eval_cases ?? 0} checks from past corrections`);
  }
  return out;
}

/** The skill version a job produced (draft until the evals promote it), and the active one. */
export function learnedSkill(job: LearnJob | null) {
  const skillId = job?.skill_id ?? DEFAULT_SKILL_ID;
  let skill = null;
  try {
    skill = job?.version ? getSkillVersion(skillId, job.version) : null;
  } catch {
    skill = null; // being written
  }
  let active = null;
  try {
    active = getActiveSkill(skillId);
  } catch {
    active = null;
  }
  return { skill, active_skill: active };
}

/** Current learned workflow + the recording it came from (for the Ramp Teach page). */
export function learnedWorkflow() {
  const read = (rel: string) => {
    const f = path.join(ROOT, rel);
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
  };
  const metaRaw = read("rules/learn_meta.json");
  const specRaw = read("rules/workflow_spec.json");
  const meta = metaRaw ? LearnMetaSchema.parse(metaRaw) : null;
  const spec = specRaw ? WorkflowSpecSchema.parse(specRaw) : null;
  let recording: Recording | null = null;
  if (meta && /^(runtime\/recordings|extension\/recordings|evals\/recordings)\/[A-Za-z0-9_.-]+\.json$|^data\/recording\.sample\.json$/.test(meta.recording_path)) {
    const r = read(meta.recording_path);
    recording = r ? RecordingSchema.parse(r) : null;
  }
  return { meta, spec, recording };
}
