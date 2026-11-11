/** GET: a recording with its word-timed transcript, waveform peaks (if saved) and the versions learned from it. */
import { recordingView } from "@/components/dash/teach/server";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const v = recordingView(id);
  return v ? Response.json(v) : Response.json({ error: "not found" }, { status: 404 });
}
