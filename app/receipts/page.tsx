import type { Metadata } from "next";
import Link from "next/link";
import { ModeBadge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { listReceipts } from "@/lib/store/receipts";
import { DecisionBadge, RECOMMENDATION_WORD, SampleLabel } from "@/components/receipt/badges";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Receipts · Ramp Teach" };

export default function ReceiptsPage() {
  const receipts = listReceipts().sort((a, b) => a.invoice_id.localeCompare(b.invoice_id));

  return (
    <div className="space-y-6">
      <header>
        <div className="mb-1 text-xs uppercase tracking-wider text-ink-faint">Stage 4 · Receipt</div>
        <h1 className="font-display text-4xl tracking-tight">Receipts</h1>
        <p className="mt-2 max-w-2xl text-base text-ink-muted">
          One receipt per verified invoice: every check with expected, actual, result, and the evidence behind it. The agent
          recommends; a human decides.
        </p>
      </header>

      {receipts.length === 0 ? (
        <Card eyebrow="No receipts yet" title="Run the demo to produce one" data-testid="receipts-empty">
          <p className="text-sm text-ink-muted">
            Receipts are written to <code className="font-mono text-xs">receipts/&lt;invoice_id&gt;.json</code> by the agent. Run{" "}
            <code className="font-mono text-xs">npm run demo</code> to learn from the sample recording, verify invoice HSG-1011, and
            write its receipt (or <code className="font-mono text-xs">npm run agent -- HSG-1011</code> with the app running).
          </p>
        </Card>
      ) : (
        <Card title={`${receipts.length} receipt${receipts.length === 1 ? "" : "s"}`}>
          <div className="-mx-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-wash text-left text-xs uppercase tracking-wider text-ink-faint">
                  <th className="px-6 py-2.5 font-medium">Invoice</th>
                  <th className="px-3 py-2.5 font-medium">Vendor</th>
                  <th className="px-3 py-2.5 text-right font-medium">Failed checks</th>
                  <th className="px-3 py-2.5 font-medium">Recommendation</th>
                  <th className="px-3 py-2.5 font-medium">Produced by</th>
                  <th className="px-6 py-2.5 font-medium">Human decision</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((r) => (
                  <tr key={r.invoice_id} className="border-b border-line last:border-0">
                    <td className="px-6 py-3">
                      <Link href={`/receipts/${encodeURIComponent(r.invoice_id)}`} className="font-medium underline underline-offset-4">
                        {r.invoice_id}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-ink-muted">{r.vendor}</td>
                    <td className="px-3 py-3 text-right tabular">
                      {r.checks.filter((c) => c.result === "fail").length} / {r.checks.length}
                    </td>
                    <td className="px-3 py-3 font-medium">{RECOMMENDATION_WORD[r.recommendation]}</td>
                    <td className="px-3 py-3">
                      <ModeBadge mode={r.mode} />
                    </td>
                    <td className="px-6 py-3">
                      <DecisionBadge decision={r.human_decision} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <SampleLabel />
          <p className="text-sm text-ink-muted">
            See what a finished receipt looks like: <code className="font-mono text-xs">samples/receipt.sample.json</code> for HSG-1011.
          </p>
        </div>
        <Link href="/receipts/sample" className="text-sm font-medium underline underline-offset-4">
          Open the sample receipt →
        </Link>
      </Card>
    </div>
  );
}
