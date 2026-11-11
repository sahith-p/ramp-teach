"use client";
/** Bill Pay table (polls the dashboard API so arrivals and agent progress show live). */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { DashBill, DashStatus } from "@/lib/dash";
import { fmtDate, fmtMoney, StatusPill, VendorAvatar } from "./ui";

type Tab = "review" | "approved" | "disputed" | "all";
const TABS: { key: Tab; label: string; match: (s: DashStatus) => boolean }[] = [
  { key: "review", label: "For review", match: (s) => s === "new" || s === "reviewing" || s === "needs_review" || s === "ready" || s === "failed" },
  { key: "approved", label: "Approved", match: (s) => s === "approved" },
  { key: "disputed", label: "Disputed", match: (s) => s === "disputed" },
  { key: "all", label: "All", match: () => true },
];

export function BillsTable({ initial, activeBillId }: { initial: DashBill[]; activeBillId?: string }) {
  const [bills, setBills] = useState(initial);
  const [tab, setTab] = useState<Tab>("review");
  const [toast, setToast] = useState<string | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const known = useRef(new Set(initial.map((b) => b.bill_id)));

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch("/api/dash/bills", { cache: "no-store" });
        const { bills: next } = (await r.json()) as { bills: DashBill[] };
        if (!alive) return;
        const arrived = next.filter((b) => !known.current.has(b.bill_id));
        if (arrived.length) {
          arrived.forEach((b) => known.current.add(b.bill_id));
          setToast(`New bill from ${arrived[0].vendor}`);
          setFresh((f) => new Set([...f, ...arrived.map((b) => b.bill_id)]));
          setTimeout(() => setToast(null), 4200);
          setTimeout(() => setFresh(new Set()), 2600);
        }
        setBills(next);
      } catch {
        /* keep last state */
      }
    };
    const id = setInterval(tick, 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const shown = bills.filter((b) => TABS.find((t) => t.key === tab)!.match(b.status));
  const count = (t: (typeof TABS)[number]) => bills.filter((b) => t.match(b.status)).length;

  return (
    <div className="relative">
      <div className="flex items-end gap-6 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 pb-3 text-sm ${tab === t.key ? "border-ink font-medium text-ink" : "border-transparent text-ink-muted hover:text-ink"}`}
          >
            {t.label}
            <span className="ml-1.5 rounded-full bg-[#f1f1ee] px-1.5 py-0.5 text-[11px] text-ink-muted">{count(t)}</span>
          </button>
        ))}
      </div>

      <table className="mt-2 w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-ink-faint">
            <th className="py-3 pl-2 font-normal">Vendor</th>
            <th className="py-3 font-normal">Invoice</th>
            <th className="py-3 font-normal">Invoice date</th>
            <th className="py-3 font-normal">Due date</th>
            <th className="py-3 pr-6 text-right font-normal">Amount</th>
            <th className="py-3 font-normal">Status</th>
          </tr>
        </thead>
        <tbody>
          {shown.length === 0 && (
            <tr>
              <td colSpan={6} className="py-16 text-center text-ink-faint">
                Nothing to review
              </td>
            </tr>
          )}
          {shown.map((b) => (
            <tr
              key={b.bill_id}
              data-bill={b.bill_id}
              className={`border-t border-line transition-colors duration-[1200ms] ${fresh.has(b.bill_id) ? "bg-[#f4f8c7]" : b.bill_id === activeBillId ? "bg-[#f6f6f2]" : "hover:bg-[#fafaf7]"} ${fresh.has(b.bill_id) ? "animate-[rowin_.5s_ease-out]" : ""}`}
            >
              <td className="py-3 pl-2">
                <Link href={`/bills/${b.bill_id}`} className="flex items-center gap-3 font-medium">
                  <VendorAvatar name={b.vendor} />
                  {b.vendor}
                </Link>
              </td>
              <td className="py-3 text-ink-muted">{b.invoice_id}</td>
              <td className="py-3 text-ink-muted">{fmtDate(b.issue_date)}</td>
              <td className="py-3 text-ink-muted">{fmtDate(b.due_date)}</td>
              <td className="tabular py-3 pr-6 text-right font-medium">{fmtMoney(b.amount, b.currency)}</td>
              <td className="py-3">
                <StatusPill status={b.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div
        className={`pointer-events-none fixed right-6 top-6 z-50 flex items-center gap-3 rounded-xl bg-[#1f1f1f] px-4 py-3 text-sm text-white shadow-lg transition-all duration-500 ${toast ? "translate-y-0 opacity-100" : "-translate-y-3 opacity-0"}`}
      >
        <span className="inline-block h-2 w-2 rounded-full bg-accent" />
        {toast ?? ""}
      </div>
    </div>
  );
}
