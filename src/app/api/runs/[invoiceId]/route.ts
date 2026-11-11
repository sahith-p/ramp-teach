/** GET: one run: routing decision, spans, evidence check (or the evidence bundle), live status, totals. */
import { runView, SAFE_INVOICE_ID } from "@/components/dash/teach/server";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await ctx.params;
  if (!SAFE_INVOICE_ID.test(invoiceId)) return Response.json({ error: "bad id" }, { status: 400 });
  return Response.json(runView(invoiceId));
}
