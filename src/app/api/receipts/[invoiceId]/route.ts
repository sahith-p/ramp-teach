import { NextResponse } from "next/server";
import { readReceipt } from "@/lib/store/receipts";
import { isSafeId } from "@/components/receipt/format";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params;
  if (!isSafeId(invoiceId)) return NextResponse.json({ error: "Invalid invoice id" }, { status: 400 });
  const receipt = readReceipt(invoiceId);
  if (!receipt) return NextResponse.json({ error: `No receipt for ${invoiceId}` }, { status: 404 });
  return NextResponse.json(receipt);
}
