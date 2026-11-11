import type { Metadata } from "next";
import { BillsTable } from "@/components/dash/BillsTable";
import { listDashBills } from "@/lib/dash";
import { BillPayHeader } from "@/components/dash/BillPayHeader";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Bill Pay · Ramp Teach" };

export default function BillsPage() {
  return (
    <>
      <BillPayHeader />
      <BillsTable initial={listDashBills()} />
    </>
  );
}
