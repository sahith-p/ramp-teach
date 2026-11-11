"use client";
/** Bill Pay table (polls the dashboard API so arrivals and agent progress show live). */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { DashBill, DashStatus } from "@/lib/dash";
import { fmtDate, fmtMoney, StatusPill, VendorAvatar } from "./ui";

type Tab = "all" | "drafts" | "approval" | "payment" | "inflight" | "history";
const review = (s: DashStatus) => s === "new" || s === "reviewing" || s === "needs_review" || s === "ready" || s === "failed";
/** Ramp's Bill Pay tabs. Approved bills that arrived in this session need payment; older decided bills are history. */
const TABS: { key: Tab; label: string; match: (b: DashBill) => boolean; count?: boolean }[] = [
  { key: "all", label: "All bills", match: () => true, count: true },
  { key: "drafts", label: "Drafts", match: () => false, count: true },
  { key: "approval", label: "For approval", match: (b) => review(b.status), count: true },
  { key: "payment", label: "Payment required", match: (b) => b.status === "approved" && !!b.arrived_at, count: true },
  { key: "inflight", label: "In-flight", match: () => false, count: true },
  { key: "history", label: "History", match: (b) => (b.status === "approved" && !b.arrived_at) || b.status === "disputed" },
];

export function BillsTable({ initial, activeBillId }: { initial: DashBill[]; activeBillId?: string }) {
  const [bills, setBills] = useState(initial);
  const [tab, setTab] = useState<Tab>("approval");
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

  const shown = bills.filter((b) => TABS.find((t) => t.key === tab)!.match(b));
  const count = (t: (typeof TABS)[number]) => bills.filter((b) => t.match(b)).length;

  return (
    <div className="relative">
      <div className="-mx-14 mt-7 flex items-end border-b border-[rgb(226,222,219)] px-[42px]">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px flex h-12 items-center gap-2 border-b-2 px-4 text-[15px] ${tab === t.key ? "border-[rgb(26,25,25)] text-[rgb(26,25,25)]" : "border-transparent text-[rgb(110,106,104)] hover:text-[rgb(26,25,25)]"}`}
          >
            {t.label}
            {t.count && <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-[3px] bg-[rgb(234,231,228)] px-1 text-[12px] text-[rgb(71,69,67)]">{count(t)}</span>}
          </button>
        ))}
      </div>

      <div className="-mx-14 min-h-[calc(100vh-240px)] bg-[rgb(250,249,248)] px-14 pb-16 pt-6">
      <div className="overflow-hidden border border-[rgb(234,231,228)] bg-white">
      <table className="w-full text-[14px]">
        <thead>
          <tr className="text-left text-[13px] text-[rgb(110,106,104)]">
            <th className="py-3 pl-5 font-normal">Vendor</th>
            <th className="py-3 font-normal">Invoice</th>
            <th className="py-3 font-normal">Invoice date</th>
            <th className="py-3 font-normal">Due date</th>
            <th className="py-3 pr-6 text-right font-normal">Amount</th>
            <th className="py-3 pr-5 font-normal">Status</th>
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
              className={`border-t border-[rgb(234,231,228)] transition-colors duration-[1200ms] ${fresh.has(b.bill_id) ? "bg-[#f4f8c7]" : b.bill_id === activeBillId ? "bg-[#f6f6f2]" : "hover:bg-[#fafaf7]"} ${fresh.has(b.bill_id) ? "animate-[rowin_.5s_ease-out]" : ""}`}
            >
              <td className="py-3 pl-5">
                <Link href={`/bills/${b.bill_id}`} className="flex items-center gap-3 font-normal">
                  <VendorAvatar name={b.vendor} />
                  {b.vendor}
                </Link>
              </td>
              <td className="py-3 text-ink-muted">{b.invoice_id}</td>
              <td className="py-3 text-ink-muted">{fmtDate(b.issue_date)}</td>
              <td className="py-3 text-ink-muted">{fmtDate(b.due_date)}</td>
              <td className="tabular py-3 pr-6 text-right font-normal">{fmtMoney(b.amount, b.currency)}</td>
              <td className="py-3 pr-5">
                <StatusPill status={b.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      </div>

      <div
        className={`pointer-events-none fixed right-6 top-6 z-50 flex items-center gap-3 rounded-xl bg-[#1f1f1f] px-4 py-3 text-sm text-white shadow-lg transition-all duration-500 ${toast ? "translate-y-0 opacity-100" : "-translate-y-3 opacity-0"}`}
      >
        <span className="inline-block h-2 w-2 rounded-full bg-accent" />
        {toast ?? ""}
      </div>
    </div>
  );
}
