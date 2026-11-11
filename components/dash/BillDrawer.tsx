"use client";
/**
 * Bill detail drawer (opens over the Bill Pay table). Shows the agent's live activity while it reviews,
 * then its result: "Needs review" with the issues, or "Looks good". Approve / Dispute are the human's
 * decision (POST /api/decisions); the agent never approves.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Invoice, Receipt } from "@/contracts";
import { LABOR_LINE_REGEX } from "@/contracts";
import type { ActivityStep, DashBill } from "@/lib/dash";
import { checkLabel, evidenceHref, failureLabel, lineIndexFromPointer } from "@/components/receipt/format";
import { fmtDate, fmtMoney, Spinner, StatusPill, VendorAvatar } from "./ui";

interface View {
  bill: DashBill;
  invoice: Invoice | null;
  receipt: Receipt | null;
  activity: { steps: ActivityStep[]; url: string | null };
}

function creditFrom(receipt: Receipt): string | null {
  for (const r of receipt.reasons) {
    const m = /credit memo[^$]*\$([\d,]+\.\d{2})/i.exec(r);
    if (m) return `$${m[1]}`;
  }
  return null;
}

const Check = ({ ok }: { ok: boolean }) =>
  ok ? (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="shrink-0 text-[#17633a]">
      <circle cx="8" cy="8" r="7" fill="currentColor" opacity=".12" />
      <path d="m5 8.2 2 2 4-4.4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="shrink-0 text-[#b42318]">
      <circle cx="8" cy="8" r="7" fill="currentColor" opacity=".12" />
      <path d="M8 4.6v4.2M8 11.2v.1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );

export function BillDrawer({ billId, initial, user }: { billId: string; initial: View; user: string }) {
  const [view, setView] = useState<View>(initial);
  const [pending, setPending] = useState<"approve" | "dispute" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/dash/bills/${billId}`, { cache: "no-store" });
      if (r.ok) setView((await r.json()) as View);
    } catch {
      /* keep last state */
    }
  }, [billId]);

  useEffect(() => {
    const id = setInterval(refresh, 1000);
    return () => clearInterval(id);
  }, [refresh]);

  const { bill, invoice, receipt, activity } = view;
  const reviewing = bill.status === "reviewing";
  const notReviewed = bill.status === "new" || bill.status === "failed";
  const decided = bill.status === "approved" || bill.status === "disputed";
  const fails = receipt?.checks.filter((c) => c.result === "fail") ?? [];
  const flagged = new Map<number, string[]>();
  for (const c of fails) {
    const li = lineIndexFromPointer(c.evidence);
    if (li !== null) flagged.set(li, [...(flagged.get(li) ?? []), c.name]);
  }

  async function startReview() {
    setError(null);
    const r = await fetch("/api/dash/deliver", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ invoice_id: bill.invoice_id }) });
    if (!r.ok) setError("Could not start the agent");
    await refresh();
  }

  async function decide(decision: "approve" | "dispute") {
    setPending(decision);
    setError(null);
    try {
      const r = await fetch("/api/decisions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invoice_id: bill.invoice_id, decision, decided_by: user }),
      });
      if (!r.ok) setError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Could not save the decision");
      await refresh();
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="fixed inset-0 z-40">
      <Link href="/bills" aria-label="Close" className="absolute inset-0 bg-black/15 transition-opacity" />
      <aside
        data-testid="bill-drawer"
        className="absolute right-0 top-0 flex h-full w-[600px] max-w-full animate-[drawerin_.35s_cubic-bezier(.2,.8,.2,1)] flex-col border-l border-line bg-white shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-7 py-5">
          <div className="flex items-center gap-3">
            <VendorAvatar name={bill.vendor} size={40} />
            <div>
              <div className="text-[15px] font-semibold">{bill.vendor}</div>
              <div className="text-sm text-ink-muted">
                {bill.invoice_id} · Due {fmtDate(bill.due_date)}
              </div>
            </div>
          </div>
          <Link href="/bills" className="rounded-md p-1 text-ink-faint hover:bg-[#f3f3ef] hover:text-ink" aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
              <path d="m4.5 4.5 9 9m0-9-9 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </Link>
        </header>

        <div className="flex-1 overflow-y-auto px-7 py-6">
          <div className="flex items-center justify-between">
            <div className="tabular text-[32px] font-semibold tracking-tight">{fmtMoney(bill.amount, bill.currency)}</div>
            <StatusPill status={bill.status} />
          </div>

          {/* Agent review */}
          <section data-testid="agent-review" className="mt-6 rounded-xl border border-line">
            {reviewing && (
              <div className="p-5">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Spinner size={13} /> Agent is reviewing this bill
                </div>
                <ol className="mt-4 space-y-2 text-sm">
                  {activity.steps.map((s) => (
                    <li key={s.ts + s.text} className="flex animate-[rowin_.4s_ease-out] items-center gap-2.5 text-ink-muted">
                      <Check ok />
                      {s.text}
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {!reviewing && receipt && (
              <div className="p-5">
                {fails.length > 0 ? (
                  <>
                    <div className="text-[15px] font-semibold">Needs a second look</div>
                    <div className="mt-0.5 text-sm text-ink-muted">
                      {fails.length} {fails.length === 1 ? "issue" : "issues"} found
                      {creditFrom(receipt) ? ` · ${creditFrom(receipt)} to credit` : ""}
                    </div>
                    <ul className="mt-4 space-y-3">
                      {fails.map((c) => {
                        const href = evidenceHref(bill.invoice_id, c.evidence);
                        return (
                          <li key={c.name} className="flex gap-2.5 text-sm">
                            <Check ok={false} />
                            <div className="min-w-0">
                              <div className="font-medium">{failureLabel(c.name)}</div>
                              <div className="text-ink-muted">{c.actual}</div>
                              {href && (
                                <a href={href} className="text-xs text-ink-faint underline underline-offset-2 hover:text-ink">
                                  Evidence
                                </a>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                ) : (
                  <>
                    <div className="text-[15px] font-semibold">Looks good</div>
                    <div className="mt-0.5 text-sm text-ink-muted">All {receipt.checks.length} checks passed</div>
                    <ul className="mt-4 grid grid-cols-2 gap-2">
                      {receipt.checks.map((c) => (
                        <li key={c.name} className="flex items-center gap-2 text-sm text-ink-muted">
                          <Check ok />
                          {checkLabel(c.name)}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {receipt.mode !== "real" && <div className="mt-4 text-xs text-ink-faint">Offline mode: written without AI.</div>}
                <div className="mt-4 flex items-center gap-4 border-t border-line pt-3 text-xs text-ink-faint">
                  <Link href={`/receipts/${bill.invoice_id}`} className="underline underline-offset-2 hover:text-ink">
                    Full receipt
                  </Link>
                  {activity.steps.length > 0 && <span>{activity.steps.length} steps by the agent</span>}
                </div>
              </div>
            )}

            {notReviewed && (
              <div className="flex items-center justify-between gap-4 p-5">
                <div className="text-sm text-ink-muted">{bill.status === "failed" ? "The agent could not finish." : "Not reviewed yet."}</div>
                <button onClick={startReview} className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium hover:bg-[#f6f6f2]">
                  Review with agent
                </button>
              </div>
            )}
            {!reviewing && !notReviewed && !receipt && <div className="p-5 text-sm text-ink-muted">No agent review for this bill.</div>}
          </section>

          {/* Invoice lines */}
          {invoice && (
            <section className="mt-6">
              <div className="mb-2 text-sm font-medium">Line items</div>
              <table className="w-full text-sm">
                <tbody>
                  {invoice.line_items.map((li, i) => {
                    const m = LABOR_LINE_REGEX.exec(li.description);
                    const flags = flagged.get(i) ?? [];
                    return (
                      <tr key={i} className="border-t border-line align-top">
                        <td className="py-2.5 pr-3">
                          <div className="font-medium">{m ? m[1] : li.description}</div>
                          <div className="text-xs text-ink-faint">{m ? `${m[2]} · ${li.quantity} h × ${fmtMoney(li.unit_rate)}` : `${li.quantity} × ${fmtMoney(li.unit_rate)}`}</div>
                          {flags.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {flags.map((f) => (
                                <span key={f} className="rounded-full bg-[#fbe4e2] px-2 py-0.5 text-[11px] font-medium text-[#9b1c12]">
                                  {failureLabel(f)}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="tabular py-2.5 text-right font-medium">{fmtMoney(li.amount)}</td>
                      </tr>
                    );
                  })}
                  <tr className="border-t border-line">
                    <td className="py-2.5 text-ink-muted">Total</td>
                    <td className="tabular py-2.5 text-right font-semibold">{fmtMoney(invoice.total)}</td>
                  </tr>
                </tbody>
              </table>
            </section>
          )}
        </div>

        <footer className="flex items-center justify-end gap-3 border-t border-line px-7 py-4">
          {error && <span className="mr-auto text-sm text-fail">{error}</span>}
          {decided ? (
            <span className="text-sm text-ink-muted">
              {bill.status === "approved" ? "Approved" : "Disputed"} by {receipt?.decided_by ?? user}
            </span>
          ) : (
            <>
              <button
                disabled={reviewing || !receipt || pending !== null}
                onClick={() => decide("dispute")}
                className="rounded-lg border border-line px-4 py-2 text-sm font-medium hover:bg-[#f6f6f2] disabled:opacity-40"
              >
                {pending === "dispute" ? "Disputing" : "Dispute"}
              </button>
              <button
                disabled={reviewing || !receipt || pending !== null}
                onClick={() => decide("approve")}
                className="rounded-lg bg-[#1f1f1f] px-4 py-2 text-sm font-medium text-white hover:bg-black disabled:opacity-40"
              >
                {pending === "approve" ? "Approving" : "Approve"}
              </button>
            </>
          )}
        </footer>
      </aside>
    </div>
  );
}
