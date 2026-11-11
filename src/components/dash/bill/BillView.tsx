"use client";
/**
 * Bill page (full page, Ramp layout): vendor header with Approve / Dispute (human decision via
 * POST /api/decisions; the agent never decides), then Overview · Review · Evidence · Activity.
 * Polls the bill and its run once a second so arrivals, routing and agent progress show live.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { LABOR_LINE_REGEX } from "@/contracts";
import { checkLabel, failureLabel, lineIndexFromPointer } from "@/components/receipt/format";
import type { RunView } from "../teach/server";
import { fmtWhen, realTag } from "../teach/logic";
import { BackLink, BTN, BTN_PRIMARY, Card, CheckIcon, Empty, ModeTag, MUTED, Spinner, Stats, StatusPill, TabBar, VendorAvatar, Wash, fmtDate, fmtMoney } from "../ui";
import { EvidenceTab } from "./EvidenceTab";
import { ReviewTab } from "./ReviewTab";
import type { BillData, BillPageProps, BillTabKey } from "./types";

const TABS: { key: BillTabKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "review", label: "Review" },
  { key: "evidence", label: "Evidence" },
  { key: "activity", label: "Activity" },
];

export function BillView(p: BillPageProps & { names: Record<string, string> }) {
  const [view, setView] = useState<BillData>(p.initial);
  const [run, setRun] = useState<RunView>(p.run);
  const [decisions, setDecisions] = useState(p.decisions);
  const [pending, setPending] = useState<"approve" | "dispute" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { bill, invoice, receipt } = view;

  const refresh = useCallback(async () => {
    try {
      const [b, r] = await Promise.all([
        fetch(`/api/dash/bills/${p.billId}`, { cache: "no-store" }),
        fetch(`/api/runs/${encodeURIComponent(p.initial.bill.invoice_id)}`, { cache: "no-store" }),
      ]);
      if (b.ok) setView((await b.json()) as BillData);
      if (r.ok) setRun((await r.json()) as RunView);
    } catch {
      /* keep last state */
    }
  }, [p.billId, p.initial.bill.invoice_id]);

  useEffect(() => {
    const id = setInterval(refresh, 1000);
    return () => clearInterval(id);
  }, [refresh]);

  const reviewing = bill.status === "reviewing";
  const decided = bill.status === "approved" || bill.status === "disputed" || !!receipt?.human_decision;
  const decidedApprove = bill.status === "approved" || (bill.status !== "disputed" && receipt?.human_decision === "approve");

  async function decide(decision: "approve" | "dispute") {
    setPending(decision);
    setError(null);
    try {
      const r = await fetch("/api/decisions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invoice_id: bill.invoice_id, decision, decided_by: p.user }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string; decision?: (typeof decisions)[number] };
      if (!r.ok) setError(j.error ?? "Could not save the decision");
      else if (j.decision) setDecisions((d) => [...d, j.decision!]);
      await refresh();
    } finally {
      setPending(null);
    }
  }

  async function startReview() {
    setError(null);
    const r = await fetch("/api/dash/deliver", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ invoice_id: bill.invoice_id }) });
    if (!r.ok) setError("Could not start the agent");
    await refresh();
  }

  const last = decisions.filter((d) => d.invoice_id === bill.invoice_id).at(-1);

  return (
    <div data-testid="bill-page" data-bill={bill.bill_id} data-status={bill.status}>
      <BackLink href="/bills" label="Back to bills">
        Bills
      </BackLink>
      <div className="mt-3 flex items-start justify-between gap-6">
        <div className="flex items-center gap-4">
          <VendorAvatar name={bill.vendor} size={48} />
          <div>
            <h1 className="text-[32px] font-normal leading-10 tracking-[-0.01em]">{bill.vendor}</h1>
            <div className={`mt-0.5 flex items-center gap-2.5 text-[14px] ${MUTED}`}>
              Invoice {bill.invoice_id}
              <StatusPill status={receipt?.human_decision && !reviewing ? (decidedApprove ? "approved" : "disputed") : bill.status} />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 pt-1">
          {error && <span className="mr-2 max-w-[280px] text-right text-[13px] text-fail">{error}</span>}
          {decided ? (
            <span data-testid="decision" className={`text-[14px] ${MUTED}`}>
              {decidedApprove ? "Approved" : "Disputed"}
              {(receipt?.decided_by ?? last?.decided_by) ? ` by ${receipt?.decided_by ?? last?.decided_by}` : ""}
            </span>
          ) : (
            <>
              <button data-testid="dispute" disabled={reviewing || !receipt || pending !== null} onClick={() => decide("dispute")} className={BTN}>
                {pending === "dispute" ? "Disputing" : "Dispute"}
              </button>
              <button data-testid="approve" disabled={reviewing || !receipt || pending !== null} onClick={() => decide("approve")} className={BTN_PRIMARY}>
                {pending === "approve" ? "Approving" : "Approve"}
              </button>
            </>
          )}
        </div>
      </div>

      <Stats
        items={[
          { label: "Amount", value: fmtMoney(bill.amount, bill.currency), testId: "bill-amount" },
          { label: "Due date", value: fmtDate(bill.due_date) },
          { label: "Invoice date", value: fmtDate(bill.issue_date) },
          { label: "Line items", value: invoice ? String(invoice.line_items.length) : "" },
        ]}
      />

      <TabBar testId="bill-tabs" active={p.tab} items={TABS.map((t) => ({ ...t, href: `/bills/${p.billId}?tab=${t.key}` }))} />

      <Wash>
        {p.tab === "overview" && <Overview view={view} run={run} onReview={startReview} billId={p.billId} />}
        {p.tab === "review" && <ReviewTab run={run} titles={p.titles} reviewing={reviewing} />}
        {p.tab === "evidence" && <EvidenceTab run={run} rules={p.rules} names={p.names} />}
        {p.tab === "activity" && <Activity view={view} run={run} titles={p.titles} decisions={decisions} />}
      </Wash>
    </div>
  );
}

function Overview({ view, run, onReview, billId }: { view: BillData; run: RunView; onReview: () => void; billId: string }) {
  const { bill, invoice, receipt } = view;
  const reviewing = bill.status === "reviewing";
  const fails = receipt?.checks.filter((c) => c.result === "fail") ?? [];
  const flagged = new Map<number, string[]>();
  for (const c of fails) {
    const li = lineIndexFromPointer(c.evidence);
    if (li !== null) flagged.set(li, [...(flagged.get(li) ?? []), c.name]);
  }
  return (
    <div data-testid="overview-tab" className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <Card title="Line items" pad={false}>
        {invoice ? (
          <table className="w-full text-[14px]">
            <tbody>
              {invoice.line_items.map((li, i) => {
                const m = LABOR_LINE_REGEX.exec(li.description);
                const flags = flagged.get(i) ?? [];
                return (
                  <tr key={i} className="border-b border-[rgb(234,231,228)] align-top">
                    <td className="py-3 pl-5 pr-3">
                      <div>{m ? m[1] : li.description}</div>
                      <div className={`tabular text-[13px] ${MUTED}`}>{m ? `${m[2]} · ${li.quantity} h × ${fmtMoney(li.unit_rate)}` : `${li.quantity} × ${fmtMoney(li.unit_rate)}`}</div>
                    </td>
                    <td className="py-3 pr-3">
                      <div className="flex flex-wrap justify-end gap-1">
                        {flags.map((f) => (
                          <span key={f} className="rounded-full bg-[#fbe4e2] px-2 py-0.5 text-[11.5px] font-medium text-[#9b1c12]">
                            {failureLabel(f)}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="tabular py-3 pr-5 text-right">{fmtMoney(li.amount)}</td>
                  </tr>
                );
              })}
              <tr>
                <td className={`py-3 pl-5 ${MUTED}`}>Total</td>
                <td />
                <td className="tabular py-3 pr-5 text-right text-[15px]">{fmtMoney(invoice.total, invoice.currency)}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <Empty>No invoice file</Empty>
        )}
      </Card>

      <div className="space-y-6">
        <Card testId="agent-review" title="Agent review" aside={receipt ? <ModeTag label={realTag(receipt.mode)} /> : null}>
          {reviewing && (
            <div className="flex items-center justify-between gap-3 text-[14px]">
              <span className="flex items-center gap-2">
                <Spinner size={12} /> Reviewing
              </span>
              <Link href={`/bills/${billId}?tab=review`} className={`text-[13px] ${MUTED} underline underline-offset-4 hover:text-[rgb(26,25,25)]`}>
                Watch
              </Link>
            </div>
          )}
          {!reviewing && receipt && (
            <>
              <div className="text-[17px]">{fails.length ? "Needs a second look" : "Looks good"}</div>
              <div className={`mt-0.5 text-[14px] ${MUTED}`}>
                {fails.length ? `${fails.length} ${fails.length === 1 ? "issue" : "issues"}` : `${receipt.checks.length} checks passed`}
              </div>
              <ul className="mt-4 space-y-3">
                {(fails.length ? fails : receipt.checks).map((c) => (
                  <li key={c.name} className="flex gap-2.5 text-[14px]">
                    <CheckIcon ok={c.result !== "fail"} />
                    <div className="min-w-0">
                      <div>{c.result === "fail" ? failureLabel(c.name) : checkLabel(c.name)}</div>
                      {c.result === "fail" && <div className={`text-[13px] leading-[18px] ${MUTED}`}>{c.actual}</div>}
                    </div>
                  </li>
                ))}
              </ul>
              <div className={`mt-4 flex gap-4 border-t border-[rgb(234,231,228)] pt-3 text-[13px] ${MUTED}`}>
                <Link href={`/receipts/${bill.invoice_id}`} className="underline underline-offset-4 hover:text-[rgb(26,25,25)]">
                  Receipt
                </Link>
                {run.spans.length > 0 && (
                  <Link href={`/bills/${billId}?tab=review`} className="underline underline-offset-4 hover:text-[rgb(26,25,25)]">
                    Review
                  </Link>
                )}
              </div>
            </>
          )}
          {!reviewing && !receipt && (
            <div className="flex items-center justify-between gap-3">
              <span className={`text-[14px] ${MUTED}`}>{bill.status === "failed" ? "The agent could not finish" : "Not reviewed"}</span>
              {(bill.status === "new" || bill.status === "failed") && (
                <button onClick={onReview} className={`${BTN} h-8 px-3 text-[13px]`}>
                  Review with agent
                </button>
              )}
            </div>
          )}
        </Card>
        <Card title="Details">
          <dl className="grid grid-cols-[110px_1fr] gap-y-2.5 text-[14px]">
            <dt className={MUTED}>Vendor</dt>
            <dd>{bill.vendor}</dd>
            <dt className={MUTED}>Invoice</dt>
            <dd>{bill.invoice_id}</dd>
            <dt className={MUTED}>Invoice date</dt>
            <dd>{fmtDate(bill.issue_date)}</dd>
            <dt className={MUTED}>Due date</dt>
            <dd>{fmtDate(bill.due_date)}</dd>
            <dt className={MUTED}>Currency</dt>
            <dd>{bill.currency}</dd>
          </dl>
        </Card>
      </div>
    </div>
  );
}

function Activity({ view, run, titles, decisions }: { view: BillData; run: RunView; titles: Record<string, string>; decisions: BillPageProps["decisions"] }) {
  const { bill, receipt } = view;
  const ev: { ts: string | null; text: string; sub?: string }[] = [];
  if (bill.arrived_at) ev.push({ ts: bill.arrived_at, text: "Bill received" });
  if (run.route)
    ev.push({
      ts: run.route.decided_at,
      text: run.route.workflow_id ? `Routed to ${titles[run.route.workflow_id] ?? run.route.workflow_id}` : "Sent to manual review",
      sub: run.route.reason,
    });
  const starts = run.spans.map((s) => s.start).sort();
  const ends = run.spans.map((s) => s.end).sort();
  if (starts.length) ev.push({ ts: starts[0], text: "Agent started" });
  const facts = run.spans.filter((s) => s.attrs.fact || s.attrs.evidence).length;
  if (facts) ev.push({ ts: run.spans.find((s) => s.attrs.fact || s.attrs.evidence)!.start, text: `Agent recorded ${facts} facts` });
  if (run.evidence) {
    const mm = run.evidence.checks.filter((c) => c.status === "mismatch").length;
    ev.push({ ts: run.evidence.checked_at, text: `Facts re-checked`, sub: `${run.evidence.checks.length - mm} match${mm ? ` · ${mm} mismatch` : ""}` });
  }
  if (!run.live.running && ends.length && receipt) ev.push({ ts: ends.at(-1)!, text: "Recommendation written", sub: receipt.recommendation === "approve" ? "Approve" : receipt.recommendation === "dispute" ? "Dispute" : "Review" });
  for (const d of decisions.filter((x) => x.invoice_id === bill.invoice_id && (!starts.length || x.decided_at >= starts[0])))
    ev.push({ ts: d.decided_at, text: `${d.decision === "approve" ? "Approved" : "Disputed"} by ${d.decided_by}`, sub: d.note });
  ev.sort((a, b) => (a.ts ?? "").localeCompare(b.ts ?? ""));

  return (
    <Card testId="activity-tab" pad={false}>
      {ev.length === 0 ? (
        <Empty>No activity yet</Empty>
      ) : (
        <ol className="px-5 py-2">
          {ev.map((e, i) => (
            <li key={i} className="relative flex gap-4 py-3 text-[14px]">
              <span className="relative flex w-3 justify-center">
                <span className="mt-[6px] h-2 w-2 rounded-full bg-[rgb(26,25,25)]" />
                {i < ev.length - 1 && <span className="absolute top-[18px] h-[calc(100%+4px)] w-px bg-[rgb(226,222,219)]" />}
              </span>
              <div className="min-w-0 flex-1">
                <div>{e.text}</div>
                {e.sub && <div className={`text-[13px] ${MUTED}`}>{e.sub}</div>}
              </div>
              <span className={`tabular shrink-0 text-[13px] ${MUTED}`}>{fmtWhen(e.ts)}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
