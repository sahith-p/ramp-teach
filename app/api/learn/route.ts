/**
 * POST { recording, operator }: a recording sent from the Recorder extension ("Send to Ramp"; it may carry
 * audio/speech) starts the skill learner. GET: the job with live stage progress, the progress lines, the learned
 * workflow the engine runs (rules/, synced from the active skill), and the skill version the job produced.
 */
import { learnedSkill, learnedWorkflow, learnProgress, readLearnJob, startLearn } from "@/lib/learnjob";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { recording?: unknown; operator?: string } | null;
  if (!body?.recording) return Response.json({ error: "recording required" }, { status: 400 });
  if (readLearnJob()?.status === "running") return Response.json({ error: "already learning" }, { status: 409 });
  try {
    const job = startLearn(body.recording, body.operator === "scripted_playwright" ? "scripted_playwright" : "human");
    return Response.json({ ok: true, job });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "invalid recording" }, { status: 400 });
  }
}

export async function GET() {
  const job = readLearnJob();
  return Response.json({ job, progress: learnProgress(job), ...learnedWorkflow(), ...learnedSkill(job) });
}
