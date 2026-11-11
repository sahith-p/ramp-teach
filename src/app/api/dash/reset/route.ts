/** Demo only: hide the given invoices until delivered and clear agent jobs (film / demo setup). */
import { resetInbox } from "@/lib/dash";
import { resetBills } from "@/lib/store/bills";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return Response.json({ error: "local demo only" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { hidden?: string[] };
  const hidden = (body.hidden ?? []).filter((h) => /^[A-Za-z0-9_-]{1,64}$/.test(h));
  resetBills();
  resetInbox(hidden);
  return Response.json({ hidden });
}
