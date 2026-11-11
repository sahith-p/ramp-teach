import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { BillDrawer } from "@/components/dash/BillDrawer";
import { BillsTable } from "@/components/dash/BillsTable";
import { dashBill, listDashBills } from "@/lib/dash";
import { BillPayHeader } from "@/components/dash/BillPayHeader";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ billId: string }> }): Promise<Metadata> {
  const { billId } = await params;
  return { title: `${billId.replace(/^bill_/, "")} · Bill Pay · Ramp Teach` };
}

export default async function BillPage({ params }: { params: Promise<{ billId: string }> }) {
  const { billId } = await params;
  const view = dashBill(billId);
  if (!view) notFound();
  const user = decodeURIComponent((await cookies()).get("dash_session")?.value ?? "reviewer");
  return (
    <>
      <BillPayHeader />
      <BillsTable initial={listDashBills()} activeBillId={billId} />
      <BillDrawer billId={billId} initial={view} user={user} />
    </>
  );
}
