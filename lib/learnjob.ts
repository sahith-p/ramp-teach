/**
 * LEARN from a recording sent by the Recorder extension ("Send to Ramp"): save it under runtime/recordings/,
 * run the same LEARN command (`learn/cli.ts --recording-file`), and report progress from learn/trace.jsonl.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { LearnMetaSchema, RecordingSchema, WorkflowSpecSchema, type Recording } from "@/contracts";
import { P, ROOT } from "@/lib/paths";

const JOB = path.join(P.runtime, "learn-job.json");
const REC_DIR = path.join(P.runtime, "recordings");

export interface LearnJob {
  status: "running" | "done" | "failed";
  started_at: string;
  finished_at?: string;
  session_id: string;
  recording_path: string;
  operator: "human" | "scripted_playwright";
  pid?: number;
}

export function readLearnJob(): LearnJob | null {
  try {
    const j = JSON.parse(fs.readFileSync(JOB, "utf8")) as LearnJob;
    if (j.status === "running" && j.pid) {
      try {
        process.kill(j.pid, 0);
      } catch {
        return { ...j, status: "failed" };
      }
    }
    return j;
  } catch {
    return null;
  }
}

export function startLearn(raw: unknown, operator: "human" | "scripted_playwright"): LearnJob {
  const rec = RecordingSchema.parse(raw);
  if (rec.steps.length > 1000) throw new Error("recording too long");
  const name = rec.session_id.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80) || "recording";
  fs.mkdirSync(REC_DIR, { recursive: true });
  const rel = `runtime/recordings/${name}.json`;
  fs.writeFileSync(path.join(ROOT, rel), JSON.stringify(rec, null, 2) + "\n");
  const log = fs.openSync(path.join(P.runtime, "learn-job.log"), "w");
  const child = spawn("npx", ["tsx", "learn/cli.ts", "--recording-file", rel, "--operator", operator], { cwd: ROOT, env: process.env, stdio: ["ignore", log, log] });
  const job: LearnJob = { status: "running", started_at: new Date().toISOString(), session_id: rec.session_id, recording_path: rel, operator, pid: child.pid };
  fs.writeFileSync(JOB, JSON.stringify(job, null, 2) + "\n");
  child.on("exit", (code) => {
    fs.writeFileSync(JOB, JSON.stringify({ ...job, status: code === 0 ? "done" : "failed", finished_at: new Date().toISOString() }, null, 2) + "\n");
    fs.closeSync(log);
  });
  return job;
}

export function learnProgress(job: LearnJob | null): string[] {
  if (!job) return [];
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
  if (meta && /^(runtime\/recordings|extension\/recordings)\/[A-Za-z0-9_.-]+\.json$|^data\/recording\.sample\.json$/.test(meta.recording_path)) {
    const r = read(meta.recording_path);
    recording = r ? RecordingSchema.parse(r) : null;
  }
  return { meta, spec, recording };
}
