import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { loadReview } from "@/components/receipt/load";
import { ReceiptView } from "@/components/receipt/ReceiptView";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ invoiceId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { invoiceId } = await params;
  return { title: `Receipt ${invoiceId} — Ramp Teach` };
}

export default async function ReceiptPage({ params }: Props) {
  const { invoiceId } = await params;
  const data = loadReview(invoiceId);
  if (!data) {
    return (
      <div className="space-y-6">
        <h1 className="font-display text-4xl tracking-tight">No receipt for {invoiceId}</h1>
        <Card>
          <p className="text-sm text-ink-muted">
            Receipts are written by the agent to <code className="font-mono text-xs">receipts/&lt;invoice_id&gt;.json</code>. Run{" "}
            <code className="font-mono text-xs">npm run demo</code> to produce one.
          </p>
          <div className="mt-4 flex gap-4 text-sm">
            <Link href="/receipts" className="font-medium underline underline-offset-4">
              All receipts
            </Link>
            <Link href="/receipts/sample" className="font-medium underline underline-offset-4">
              View the sample receipt
            </Link>
          </div>
        </Card>
      </div>
    );
  }
  return <ReceiptView data={data} />;
}
