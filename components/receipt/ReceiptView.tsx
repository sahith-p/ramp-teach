import Link from "next/link";
import { LABOR_LINE_REGEX, type CalcReport, type Invoice, type Receipt } from "@/contracts";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Money } from "@/components/ui/Money";
import { fmtMoney } from "@/lib/money";
import type { ReviewData } from "./load";
import { DecisionPanel } from "./DecisionPanel";
import { RECOMMENDATION_WORD, ResultBadge } from "./badges";
import { checkLabel, evidenceHref, failureLabel, lineIndexFromPointer } from "./format";

const th = "px-4 py-2.5 text-left font-medium text-ink-muted";

export function ReceiptView({ data }: { data: ReviewData }) {
  const { receipt, invoice, sample } = data;
  const id = sample ? "sample" : receipt.invoice_id;
  const facts = [receipt.vendor];
  if (invoice) facts.push(fmtMoney(invoice.total, invoice.currency), `Due ${invoice.due_date}`);

  return (
    <div className="space-y-6">
      <header>
        <Link href="/receipts" className="text-sm text-ink-muted hover:text-ink">
          ← Receipts
        </Link>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{receipt.invoice_id}</h1>
        <p className="mt-1 text-ink-muted">{facts.join(" · ")}</p>
        {sample && (
          <p className="mt-1 text-xs text-ink-faint" data-testid="sample-notice">
            Sample receipt. Decisions are off.
          </p>
        )}
      </header>

      <Recommendation receipt={receipt} />

      <ChecksTable receipt={receipt} id={id} />

      {invoice && <LineItemsTable invoice={invoice} receipt={receipt} calc={data.calc} />}

      <DecisionPanel
        invoiceId={receipt.invoice_id}
        billId={data.billId}
        sample={sample}
        recorded={receipt.human_decision ? { decision: receipt.human_decision, decided_by: receipt.decided_by, decided_at: receipt.decided_at } : null}
        bill={data.bill}
      />
    </div>
  );
}

function Recommendation({ receipt }: { receipt: Receipt }) {
  return (
    <section className="rounded-[var(--radius-card)] bg-accent p-8 text-accent-ink" data-testid="recommendation-banner">
      <div className="text-5xl font-semibold tracking-tight">{RECOMMENDATION_WORD[receipt.recommendation]}</div>
      {receipt.reasons.length > 0 && (
        <ul className="mt-5 space-y-2 text-base">
          {receipt.reasons.map((r, i) => (
            <li key={i} className="flex gap-3">
              <span aria-hidden className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ink" />
              <span>{r}</span>
            </li>
          ))}
        </ul>
      )}
      {receipt.mode !== "real" && <p className="mt-5 text-xs text-ink/70">Offline mode: written without AI.</p>}
    </section>
  );
}

function ChecksTable({ receipt, id }: { receipt: Receipt; id: string }) {
  return (
    <Card title="Checks">
      <div className="-mx-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-line bg-wash">
              <th className={`${th} pl-6`}>Check</th>
              <th className={th}>Expected</th>
              <th className={th}>Actual</th>
              <th className={th}>Result</th>
              <th className={`${th} pr-6`}>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {receipt.checks.map((c) => {
              const href = evidenceHref(id, c.evidence);
              return (
                <tr key={c.name} className="border-b border-line align-top last:border-0" data-check={c.name}>
                  <td className="py-3 pl-6 pr-4 font-medium">{checkLabel(c.name)}</td>
                  <td className="px-4 py-3 text-ink-muted">{c.expected}</td>
                  <td className={`px-4 py-3 ${c.result === "fail" ? "text-fail" : "text-ink"}`}>{c.actual}</td>
                  <td className="px-4 py-3">
                    <ResultBadge result={c.result} />
                  </td>
                  <td className="py-3 pl-4 pr-6">
                    {href ? (
                      <Link
                        href={href}
                        className="block max-w-[18rem] break-all font-mono text-xs underline decoration-line underline-offset-4 hover:decoration-ink"
                        data-evidence={c.evidence}
                      >
                        {c.evidence}
                      </Link>
                    ) : (
                      <Badge tone="warn">No evidence</Badge>
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
    <Card title="Line items">
      <div className="-mx-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-line bg-wash">
              <th className={`${th} w-12 pl-6 text-right`}>#</th>
              <th className={th}>Description</th>
              <th className={`${th} text-right`}>Hours</th>
              <th className={`${th} text-right`}>Rate</th>
              <th className={`${th} text-right`}>Amount</th>
              <th className={`${th} pr-6`}>Flags</th>
            </tr>
          </thead>
          <tbody>
            {invoice.line_items.map((li, i) => {
              const f = flags.get(i) ?? [];
              const labor = LABOR_LINE_REGEX.exec(li.description);
              return (
                <tr key={i} className="border-b border-line align-top" data-line={i}>
                  <td className="py-3 pl-6 pr-4 text-right tabular text-ink-faint">{i + 1}</td>
                  <td className="px-4 py-3">
                    {labor ? (
                      <>
                        <div className="font-medium">{labor[1]}</div>
                        <div className="text-xs text-ink-muted">
                          {labor[2]} · week ending {labor[3]}
                        </div>
                      </>
                    ) : (
                      <div className="font-medium">{li.description}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular">{li.quantity}</td>
                  <td className="px-4 py-3 text-right">
                    <Money value={li.unit_rate} currency={invoice.currency} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Money value={li.amount} currency={invoice.currency} />
                  </td>
                  <td className="py-3 pl-4 pr-6">
                    <div className="flex flex-wrap gap-1.5">
                      {f.map((name) => (
                        <span key={name} title={checkLabel(name)}>
                          <Badge tone="fail">{failureLabel(name)}</Badge>
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="py-3 pl-6 pr-4" />
              <td className="px-4 py-3 font-medium" colSpan={3}>
                Total
              </td>
              <td className="px-4 py-3 text-right font-semibold">
                <Money value={invoice.total} currency={invoice.currency} />
              </td>
              <td className="py-3 pl-4 pr-6" />
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}
