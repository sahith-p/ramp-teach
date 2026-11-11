import type { Metadata } from "next";
import Link from "next/link";
import { loadReview } from "@/components/receipt/load";
import { ReceiptView } from "@/components/receipt/ReceiptView";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ invoiceId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { invoiceId } = await params;
  return { title: `Receipt ${invoiceId} · Ramp Teach` };
}

export default async function ReceiptPage({ params }: Props) {
  const { invoiceId } = await params;
  const data = loadReview(invoiceId);
  if (!data) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold tracking-tight">No receipt for {invoiceId}</h1>
        <div className="flex gap-4 text-sm">
          <Link href="/receipts" className="font-medium underline underline-offset-4">
            All receipts
          </Link>
          <Link href="/receipts/sample" className="font-medium underline underline-offset-4">
            Sample receipt
          </Link>
        </div>
      </div>
    );
  }
  return <ReceiptView data={data} />;
}
