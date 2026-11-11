import type { Metadata } from "next";
import { BillsTable } from "@/components/dash/BillsTable";
import { BILL_TABS, type BillTab } from "@/components/dash/BillPayTabs";
import { listDashBills } from "@/lib/dash";
import { BillPayHeader } from "@/components/dash/BillPayHeader";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Bill Pay · Ramp" };

export default async function BillsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const initialTab = BILL_TABS.some((t) => t.key === tab) ? (tab as BillTab) : "approval";
  return (
    <>
      <BillPayHeader />
      <BillsTable initial={listDashBills()} initialTab={initialTab} />
    </>
  );
}
