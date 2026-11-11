/** GET: the latest frame of the agent's browser (runs/<id>/live/frame.jpg). Never cached. */
import fs from "node:fs";
import { liveFramePath } from "@/lib/pillars";
import { SAFE_INVOICE_ID } from "@/components/dash/teach/server";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await ctx.params;
  if (!SAFE_INVOICE_ID.test(invoiceId)) return new Response("bad id", { status: 400 });
  let buf: Buffer;
  try {
    buf = fs.readFileSync(liveFramePath(invoiceId));
  } catch {
    return new Response("no frame", { status: 404 });
  }
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" } });
}
