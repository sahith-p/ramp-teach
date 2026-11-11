/** POST: a recording sent from the Recorder extension ("Send to Ramp") starts LEARN. GET: progress + result. */
import { learnedWorkflow, learnProgress, readLearnJob, startLearn } from "@/lib/learnjob";

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
  return Response.json({ job, progress: learnProgress(job), ...learnedWorkflow() });
}
