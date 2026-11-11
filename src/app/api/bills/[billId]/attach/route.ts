import { NextResponse, type NextRequest } from "next/server";
import { attachReceiptToBill } from "@/components/fixtures/attach";

/**
 * POST /api/bills/<bill_id>/attach  {receipt_id}
 * JSON body → JSON response ({ bill } or { error } with 400/404/409).
 * HTML form body (the bill detail page's button) → 303 back to /bills/<bill_id>.
 * Human-only action: the agent never calls this.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ billId: string }> }) {
  const billId = decodeURIComponent((await ctx.params).billId);
  const ct = req.headers.get("content-type") ?? "";
  const isJson = ct.includes("application/json");

  let receiptId: unknown = undefined;
  try {
    if (isJson) {
      const body = (await req.json()) as unknown;
      receiptId = body && typeof body === "object" ? (body as Record<string, unknown>).receipt_id : undefined;
    } else {
      receiptId = (await req.formData()).get("receipt_id") ?? undefined;
    }
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const result = attachReceiptToBill(billId, receiptId);

  if (!isJson) {
    const back = `/bills/${encodeURIComponent(billId)}${result.ok ? "?attached=1" : `?error=${encodeURIComponent(result.error)}`}`;
    return new NextResponse(null, { status: 303, headers: { Location: back } });
  }
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ bill: result.bill });
}
