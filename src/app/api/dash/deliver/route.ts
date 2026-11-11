/**
 * Demo only: an invoice "arrives" in the inbox and the agent review starts (same engine run as
 * `npm run agent`). The agent reads and recommends; it never approves or pays.
 */
import { deliver } from "@/lib/dash";
import { loadInvoice } from "@/lib/data";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return Response.json({ error: "local demo only" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { invoice_id?: string };
  const id = String(body.invoice_id ?? "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || !loadInvoice(id)) return Response.json({ error: "unknown invoice" }, { status: 404 });
  const job = deliver(id, origin);
  return Response.json({ invoice_id: id, job });
}
