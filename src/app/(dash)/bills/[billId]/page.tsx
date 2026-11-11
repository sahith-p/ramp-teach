import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { SkillRule } from "@/contracts";
import { BillView } from "@/components/dash/bill/BillView";
import type { BillTabKey } from "@/components/dash/bill/types";
import { currentUser } from "@/components/dash/Shell";
import { listWorkflows, runView } from "@/components/dash/teach/server";
import { dashBill } from "@/lib/dash";
import { loadVendor } from "@/lib/data";
import { DEFAULT_SKILL_ID, getActiveSkill, getSkillVersion } from "@/lib/pillars";
import { readDecisions } from "@/lib/store/decisions";

export const dynamic = "force-dynamic";

const TABS: BillTabKey[] = ["overview", "review", "evidence", "activity"];

export async function generateMetadata({ params }: { params: Promise<{ billId: string }> }): Promise<Metadata> {
  const { billId } = await params;
  return { title: `${billId.replace(/^bill_/, "")} · Bill Pay · Ramp` };
}

function rulesFor(workflowId: string | null, version: number | null): SkillRule[] {
  try {
    const v = workflowId && version ? getSkillVersion(workflowId, version) : getActiveSkill(workflowId ?? DEFAULT_SKILL_ID);
    return v?.rules ?? [];
  } catch {
    return [];
  }
}

export default async function BillPage({ params, searchParams }: { params: Promise<{ billId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { billId } = await params;
  const { tab } = await searchParams;
  const view = dashBill(billId);
  if (!view) notFound();
  const run = runView(view.bill.invoice_id);
  const active: BillTabKey = TABS.includes(tab as BillTabKey) ? (tab as BillTabKey) : view.bill.status === "reviewing" ? "review" : "overview";
  const titles = Object.fromEntries(listWorkflows().map((w) => [w.skill_id, w.title]));
  let names: Record<string, string> = {};
  try {
    names = Object.fromEntries(loadVendor().employees.map((e) => [e.employee_id, e.name]));
  } catch {
    /* no vendor file */
  }
  let decisions: ReturnType<typeof readDecisions> = [];
  try {
    decisions = readDecisions().filter((d) => d.invoice_id === view.bill.invoice_id);
  } catch {
    /* unreadable log */
  }
  return (
    <BillView
      billId={billId}
      tab={active}
      user={await currentUser()}
      initial={view}
      run={run}
      rules={rulesFor(run.route?.workflow_id ?? null, run.route?.version ?? null)}
      titles={titles}
      names={names}
      decisions={decisions}
    />
  );
}
