import Link from "next/link";
import { LABOR_LINE_REGEX, parseEvidencePointer, receiptIdFor, type CalcReport, type Invoice, type Receipt } from "@/contracts";
import { Badge, ModeBadge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Money } from "@/components/ui/Money";
import type { ReviewData } from "./load";
import { DecisionPanel } from "./DecisionPanel";
import { RECOMMENDATION_WORD, ResultBadge, SampleLabel } from "./badges";
import { checkLabel, evidenceHref, lineIndexFromPointer } from "./format";

const MODE_SENTENCE: Record<Receipt["mode"], string> = {
  real: "Synthesized by a Claude call from the deterministic checks and browser evidence.",
  scripted: "Produced by fixed scripted steps. No AI decided anything here.",
  mock: "Mapped deterministically from the calc report and evidence. No AI was called.",
};

const KIND_LABEL = { data: "data", rules: "rules", calc: "calc", fixture: "portal page" } as const;

export function ReceiptView({ data }: { data: ReviewData }) {
  const { receipt, invoice, sample } = data;
  const id = sample ? "sample" : receipt.invoice_id;
  const counts = {
    pass: receipt.checks.filter((c) => c.result === "pass").length,
    fail: receipt.checks.filter((c) => c.result === "fail").length,
    unverified: receipt.checks.filter((c) => c.result === "unverified").length,
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-3 text-xs uppercase tracking-wider text-ink-faint">
            <Link href="/receipts" className="hover:text-ink">
              Receipts
            </Link>
            <span>/</span>
            <span className="font-mono normal-case tracking-normal">{receiptIdFor(receipt.invoice_id)}</span>
            {sample && <SampleLabel />}
          </div>
          <h1 className="font-display text-4xl tracking-tight">{receipt.invoice_id}</h1>
          <p className="mt-1 text-base text-ink-muted">{receipt.vendor}</p>
        </div>
        <ModeBadge mode={receipt.mode} />
      </header>

      {sample && (
        <div className="rounded-[var(--radius-card)] border border-dashed border-ink/40 bg-wash px-5 py-3 text-sm text-ink-muted" data-testid="sample-notice">
          <span className="font-semibold text-ink">SAMPLE.</span> Rendering <code className="font-mono text-xs">samples/receipt.sample.json</code>{" "}
          with <code className="font-mono text-xs">samples/invoice.sample.json</code>, not the output of a run. Decision buttons are disabled.
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-3">
        <InvoiceSummary className="md:col-span-2" receipt={receipt} invoice={invoice} source={data.invoiceSource} />
        <Card eyebrow="Checks" title={`${counts.fail} of ${receipt.checks.length} failed`}>
          <dl className="grid grid-cols-3 gap-3 text-center">
            <Tally label="Pass" value={counts.pass} className="text-pass" />
            <Tally label="Fail" value={counts.fail} className="text-fail" />
            <Tally label="Unverified" value={counts.unverified} className="text-warn" />
          </dl>
        </Card>
      </div>

      <RecommendationBanner receipt={receipt} />

      <DecisionPanel
        invoiceId={receipt.invoice_id}
        billId={data.billId}
        sample={sample}
        recorded={receipt.human_decision ? { decision: receipt.human_decision, decided_by: receipt.decided_by, decided_at: receipt.decided_at } : null}
        bill={data.bill}
      />

      <ChecksTable receipt={receipt} id={id} />

      {invoice && <LineItemsTable invoice={invoice} receipt={receipt} calc={data.calc} />}
    </div>
  );
}

function Tally({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div className="rounded-lg border border-line px-2 py-3">
      <dd className={`font-display text-3xl tabular ${className}`}>{value}</dd>
      <dt className="mt-1 text-xs text-ink-faint">{label}</dt>
    </div>
  );
}

function InvoiceSummary({
  receipt,
  invoice,
  source,
  className,
}: {
  receipt: Receipt;
  invoice: Invoice | null;
  source: string | null;
  className?: string;
}) {
  if (!invoice) {
    return (
      <Card eyebrow="Invoice" title="Receipt-only summary" className={className}>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <Field label="Vendor" value={receipt.vendor} />
          <Field label="Invoice" value={receipt.invoice_id} />
        </dl>
        <p className="mt-4 text-sm text-ink-muted">
          The invoice file for {receipt.invoice_id} is not in <code className="font-mono text-xs">data/invoices/</code> yet, so line items
          are not shown.
        </p>
      </Card>
    );
  }
  return (
    <Card eyebrow="Invoice" title={invoice.vendor} className={className}>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-4">
          <Field label="Invoice" value={invoice.invoice_id} />
          <Field label="Issued" value={invoice.issue_date} />
          <Field label="Due" value={invoice.due_date} />
          <Field label="Lines" value={String(invoice.line_items.length)} />
        </dl>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wider text-ink-faint">Total ({invoice.currency})</div>
          <Money value={invoice.total} currency={invoice.currency} className="font-display text-3xl" />
        </div>
      </div>
      {source && <p className="mt-4 font-mono text-xs text-ink-faint">{source}</p>}
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd className="mt-0.5 font-medium tabular">{value}</dd>
    </div>
  );
}

function RecommendationBanner({ receipt }: { receipt: Receipt }) {
  return (
    <section className="rounded-[var(--radius-card)] bg-accent p-8 text-accent-ink" data-testid="recommendation-banner">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-medium uppercase tracking-wider">Agent recommendation</div>
          <div className="mt-1 font-display text-6xl tracking-tight">{RECOMMENDATION_WORD[receipt.recommendation]}</div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <ModeBadge mode={receipt.mode} />
          <p className="max-w-xs text-right text-xs">{MODE_SENTENCE[receipt.mode]}</p>
        </div>
      </div>
      {receipt.reasons.length > 0 && (
        <ul className="mt-6 space-y-2 text-base">
          {receipt.reasons.map((r, i) => (
            <li key={i} className="flex gap-3">
              <span aria-hidden className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ink" />
              <span>{r}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-6 border-t border-ink/15 pt-4 text-sm font-medium">Recommendation — a human decides.</p>
    </section>
  );
}

function ChecksTable({ receipt, id }: { receipt: Receipt; id: string }) {
  return (
    <Card eyebrow="Verification" title="Checks">
      <div className="-mx-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-wash text-left text-xs uppercase tracking-wider text-ink-faint">
              <th className="px-6 py-2.5 font-medium">Check</th>
              <th className="px-3 py-2.5 font-medium">Expected</th>
              <th className="px-3 py-2.5 font-medium">Actual</th>
              <th className="px-3 py-2.5 font-medium">Result</th>
              <th className="px-6 py-2.5 font-medium">Evidence</th>
            </tr>
          </thead>
          <tbody>
            {receipt.checks.map((c) => {
              const href = evidenceHref(id, c.evidence);
              const kind = parseEvidencePointer(c.evidence)?.kind;
              return (
                <tr key={c.name} className="border-b border-line align-top last:border-0" data-check={c.name}>
                  <td className="px-6 py-3">
                    <div className="font-medium">{checkLabel(c.name)}</div>
                    <div className="font-mono text-xs text-ink-faint">{c.name}</div>
                  </td>
                  <td className="px-3 py-3 text-ink-muted">{c.expected}</td>
                  <td className={`px-3 py-3 ${c.result === "fail" ? "text-fail" : "text-ink"}`}>{c.actual}</td>
                  <td className="px-3 py-3">
                    <ResultBadge result={c.result} />
                  </td>
                  <td className="px-6 py-3">
                    {href && kind ? (
                      <Link href={href} className="group block max-w-[18rem]" data-evidence={c.evidence}>
                        <span className="block text-xs text-ink-faint">{KIND_LABEL[kind]}</span>
                        <span className="break-all font-mono text-xs text-ink underline decoration-line underline-offset-4 group-hover:decoration-ink">
                          {c.evidence}
                        </span>
                      </Link>
                    ) : (
                      <Badge tone="warn">No valid evidence</Badge>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Which failing checks point at each line: calc findings first, else the receipt's evidence pointers. */
function lineFlags(receipt: Receipt, calc: CalcReport | null): Map<number, string[]> {
  const flags = new Map<number, string[]>();
  const add = (i: number, name: string) => {
    const cur = flags.get(i) ?? [];
    if (!cur.includes(name)) flags.set(i, [...cur, name]);
  };
  for (const c of calc?.checks ?? []) {
    if (c.result !== "fail") continue;
    for (const f of c.findings) if (f.line_index !== null) add(f.line_index, c.check);
  }
  for (const c of receipt.checks) {
    if (c.result !== "fail") continue;
    const i = lineIndexFromPointer(c.evidence);
    if (i !== null) add(i, c.name);
  }
  return flags;
}

function LineItemsTable({ invoice, receipt, calc }: { invoice: Invoice; receipt: Receipt; calc: CalcReport | null }) {
  const flags = lineFlags(receipt, calc);
  return (
    <Card eyebrow="Invoice" title="Line items">
      <div className="-mx-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-wash text-left text-xs uppercase tracking-wider text-ink-faint">
              <th className="w-12 px-6 py-2.5 text-right font-medium">#</th>
              <th className="px-3 py-2.5 font-medium">Description</th>
              <th className="px-3 py-2.5 text-right font-medium">Qty / hours</th>
              <th className="px-3 py-2.5 text-right font-medium">Rate</th>
              <th className="px-3 py-2.5 text-right font-medium">Amount</th>
              <th className="px-6 py-2.5 font-medium">Flags</th>
            </tr>
          </thead>
          <tbody>
            {invoice.line_items.map((li, i) => {
              const f = flags.get(i) ?? [];
              const labor = LABOR_LINE_REGEX.exec(li.description);
              return (
                <tr key={i} className="border-b border-line align-top" data-line={i}>
                  <td className="px-6 py-3 text-right tabular text-ink-faint">{i + 1}</td>
                  <td className="px-3 py-3">
                    {labor ? (
                      <>
                        <div className="font-medium">{labor[1]}</div>
                        <div className="text-xs text-ink-muted">
                          {labor[2]} · week ending {labor[3]}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="font-medium">{li.description}</div>
                        <div className="text-xs text-ink-muted">Non-labor charge</div>
                      </>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right tabular">{li.quantity}</td>
                  <td className="px-3 py-3 text-right">
                    <Money value={li.unit_rate} currency={invoice.currency} />
                  </td>
                  <td className="px-3 py-3 text-right">
                    <Money value={li.amount} currency={invoice.currency} />
                  </td>
                  <td className="px-6 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {f.map((name) => (
                        <Badge key={name} tone="fail">
                          {checkLabel(name)}
                        </Badge>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="px-6 py-3" />
              <td className="px-3 py-3 font-medium" colSpan={3}>
                Invoice total
              </td>
              <td className="px-3 py-3 text-right font-semibold">
                <Money value={invoice.total} currency={invoice.currency} />
              </td>
              <td className="px-6 py-3" />
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}
