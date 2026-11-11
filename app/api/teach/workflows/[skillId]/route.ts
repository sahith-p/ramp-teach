/** GET: one workflow: versions, eval runs + cases, runs, recordings. */
import { workflowDetail } from "@/components/dash/teach/server";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ skillId: string }> }) {
  const { skillId } = await ctx.params;
  const d = workflowDetail(skillId);
  return d ? Response.json(d) : Response.json({ error: "not found" }, { status: 404 });
}
