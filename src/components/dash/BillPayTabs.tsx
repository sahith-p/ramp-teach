/**
 * Bill Pay tab row (Ramp layout): the bill filters plus Workflows. On /bills the filters are buttons
 * (client state, so the table updates in place); elsewhere they link back to /bills?tab=<key>.
 */
import Link from "next/link";
import type { DashBill, DashStatus } from "@/lib/dash";

export type BillTab = "all" | "drafts" | "approval" | "payment" | "inflight" | "history";

export const BILL_TABS: { key: BillTab; label: string; count?: boolean }[] = [
  { key: "all", label: "All bills", count: true },
  { key: "drafts", label: "Drafts", count: true },
  { key: "approval", label: "For approval", count: true },
  { key: "payment", label: "Payment required", count: true },
  { key: "inflight", label: "In-flight", count: true },
  { key: "history", label: "History" },
];

const review = (s: DashStatus) => s === "new" || s === "reviewing" || s === "needs_review" || s === "ready" || s === "failed";
/** Approved bills that arrived in this session need payment; older decided bills are history. */
export const BILL_MATCH: Record<BillTab, (b: DashBill) => boolean> = {
  all: () => true,
  drafts: () => false,
  approval: (b) => review(b.status),
  payment: (b) => b.status === "approved" && !!b.arrived_at,
  inflight: () => false,
  history: (b) => (b.status === "approved" && !b.arrived_at) || b.status === "disputed",
};
export const billCounts = (bills: DashBill[]) =>
  Object.fromEntries(BILL_TABS.map((t) => [t.key, bills.filter(BILL_MATCH[t.key]).length])) as Record<BillTab, number>;

const tabCls =(on: boolean) =>
  `-mb-px flex h-12 items-center gap-2 border-b-2 px-4 text-[15px] ${on ? "border-[rgb(26,25,25)] text-[rgb(26,25,25)]" : "border-transparent text-[rgb(110,106,104)] hover:text-[rgb(26,25,25)]"}`;

const Count = ({ n }: { n: number }) => (
  <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-[3px] bg-[rgb(234,231,228)] px-1 text-[12px] text-[rgb(71,69,67)]">{n}</span>
);

export function BillPayTabs({
  active,
  counts,
  onSelect,
  workflows,
}: {
  active: BillTab | "workflows";
  counts: Partial<Record<BillTab, number>>;
  onSelect?: (t: BillTab) => void;
  workflows?: number;
}) {
  return (
    <div data-testid="billpay-tabs" className="-mx-14 mt-7 flex items-end border-b border-[rgb(226,222,219)] px-[42px]">
      {BILL_TABS.map((t) => {
        const inner = (
          <>
            {t.label}
            {t.count && <Count n={counts[t.key] ?? 0} />}
          </>
        );
        return onSelect ? (
          <button key={t.key} onClick={() => onSelect(t.key)} className={tabCls(active === t.key)}>
            {inner}
          </button>
        ) : (
          <Link key={t.key} href={`/bills?tab=${t.key}`} className={tabCls(active === t.key)}>
            {inner}
          </Link>
        );
      })}
      <Link href="/bills/workflows" data-testid="tab-workflows" className={tabCls(active === "workflows")}>
        Workflows
        {workflows !== undefined && <Count n={workflows} />}
      </Link>
    </div>
  );
}
