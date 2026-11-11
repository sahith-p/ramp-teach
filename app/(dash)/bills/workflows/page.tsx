import type { Metadata } from "next";
import Link from "next/link";
import { BillPayHeader } from "@/components/dash/BillPayHeader";
import { BillPayTabs, billCounts } from "@/components/dash/BillPayTabs";
import { LearnCard } from "@/components/dash/teach/LearnCard";
import { fmtWhen } from "@/components/dash/teach/logic";
import { learnView, listWorkflows } from "@/components/dash/teach/server";
import { Empty, MUTED, Pill, Spinner, VendorAvatar, Wash } from "@/components/dash/ui";
import { listDashBills } from "@/lib/dash";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Workflows · Bill Pay · Ramp" };

export default async function WorkflowsPage({ searchParams }: { searchParams: Promise<{ recording?: string }> }) {
  const { recording } = await searchParams;
  const workflows = listWorkflows();
  return (
    <>
      <BillPayHeader />
      <BillPayTabs active="workflows" counts={billCounts(listDashBills())} />
      <Wash>
        <LearnCard initial={learnView()} recording={recording} />
        <div data-testid="workflows-table" className="overflow-hidden border border-[rgb(234,231,228)] bg-white">
          <table className="w-full text-[14px]">
            <thead>
              <tr className={`text-left text-[13px] ${MUTED}`}>
                <th className="py-3 pl-5 font-normal">Workflow</th>
                <th className="py-3 font-normal">Vendor</th>
                <th className="py-3 font-normal">Active version</th>
                <th className="py-3 font-normal">Rules</th>
                <th className="py-3 font-normal">Last run</th>
                <th className="py-3 pr-5 font-normal">Evals</th>
              </tr>
            </thead>
            <tbody>
              {workflows.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <Empty>No workflows yet</Empty>
                  </td>
                </tr>
              )}
              {workflows.map((w) => (
                <tr key={w.skill_id} data-workflow={w.skill_id} className="relative border-t border-[rgb(234,231,228)] hover:bg-[#fafaf7]">
                  <td className="py-3 pl-5">
                    <Link href={`/bills/workflows/${encodeURIComponent(w.skill_id)}`} className="after:absolute after:inset-0">
                      {w.title}
                    </Link>
                  </td>
                  <td className="py-3">
                    <span className="flex items-center gap-2.5">
                      <VendorAvatar name={w.vendor} size={24} />
                      {w.vendor}
                    </span>
                  </td>
                  <td className="py-3">
                    {w.active_version ? `v${w.active_version}` : <span className={MUTED}>None</span>}
                    {w.latest_version && w.latest_version !== w.active_version && <span className={`ml-2 text-[13px] ${MUTED}`}>v{w.latest_version} draft</span>}
                  </td>
                  <td className="tabular py-3">{w.rules}</td>
                  <td className="py-3">
                    {w.last_run ? (
                      <span className="flex items-center gap-2">
                        {w.last_run.running && <Spinner />}
                        {w.last_run.invoice_id}
                        <span className={MUTED}>{fmtWhen(w.last_run.started_at)}</span>
                      </span>
                    ) : (
                      <span className={MUTED}>No runs yet</span>
                    )}
                  </td>
                  <td className="py-3 pr-5">
                    {w.eval_state === "passed" && <Pill tone="good">Passed</Pill>}
                    {w.eval_state === "blocked" && <Pill tone="bad">Blocked</Pill>}
                    {!w.eval_state && <span className={MUTED}>Not run</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Wash>
    </>
  );
}
