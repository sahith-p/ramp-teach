import type { Metadata } from "next";
import Link from "next/link";
import { listReceipts } from "@/lib/store/receipts";
import { DecisionBadge, RECOMMENDATION_WORD } from "@/components/receipt/badges";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Receipts · Ramp Teach" };

const th = "px-4 py-2.5 text-left font-medium text-ink-muted";

export default function ReceiptsPage() {
  const receipts = listReceipts().sort((a, b) => a.invoice_id.localeCompare(b.invoice_id));

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Receipts</h1>

      {receipts.length === 0 ? (
        <p className="text-ink-muted" data-testid="receipts-empty">
          No receipts yet. Run <code className="font-mono text-sm">npm run demo</code>, or see the{" "}
          <Link href="/receipts/sample" className="underline underline-offset-4">
            sample
          </Link>
          .
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-wash">
                <th className={th}>Invoice</th>
                <th className={th}>Vendor</th>
                <th className={`${th} text-right`}>Failed</th>
                <th className={th}>Recommendation</th>
                <th className={th}>Decision</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((r) => (
                <tr key={r.invoice_id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3">
                    <Link href={`/receipts/${encodeURIComponent(r.invoice_id)}`} className="font-medium underline underline-offset-4">
                      {r.invoice_id}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{r.vendor}</td>
                  <td className="px-4 py-3 text-right tabular">
                    {r.checks.filter((c) => c.result === "fail").length} of {r.checks.length}
                  </td>
                  <td className="px-4 py-3">
                    {RECOMMENDATION_WORD[r.recommendation]}
                    {r.mode !== "real" && <span className="ml-2 text-xs text-ink-faint">(offline)</span>}
                  </td>
                  <td className="px-4 py-3">
                    <DecisionBadge decision={r.human_decision} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
