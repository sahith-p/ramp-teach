import { dashBill } from "@/lib/dash";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ billId: string }> }) {
  const { billId } = await ctx.params;
  const view = dashBill(billId);
  return view ? Response.json(view) : Response.json({ error: "not found" }, { status: 404 });
}
