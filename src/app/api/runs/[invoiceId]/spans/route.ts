/** GET: spans of a run (runs/<id>/spans.jsonl) with totals. */
import { readSpans } from "@/lib/pillars";
import { runTotals } from "@/components/dash/teach/logic";
import { SAFE_INVOICE_ID } from "@/components/dash/teach/server";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await ctx.params;
  if (!SAFE_INVOICE_ID.test(invoiceId)) return Response.json({ error: "bad id" }, { status: 400 });
  let spans: ReturnType<typeof readSpans> = [];
  try {
    spans = readSpans(invoiceId);
  } catch {
    /* half-written line: return nothing this tick */
  }
  return Response.json({ spans, totals: runTotals(spans) });
}
