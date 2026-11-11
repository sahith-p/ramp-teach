/** GET: live status of the agent's browser (runs/<id>/live/status.json + whether a frame exists). */
import { readJobs } from "@/lib/dash";
import { readLiveStatus, SAFE_INVOICE_ID } from "@/components/dash/teach/server";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await ctx.params;
  if (!SAFE_INVOICE_ID.test(invoiceId)) return Response.json({ error: "bad id" }, { status: 400 });
  return Response.json(readLiveStatus(invoiceId, readJobs()[invoiceId]));
}
