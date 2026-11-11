import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RunBody } from "@/components/dash/teach/RunView";
import { fmtPct, fmtWhen, realTag } from "@/components/dash/teach/logic";
import { listWorkflows, runView, SAFE_INVOICE_ID, SAFE_SKILL_ID } from "@/components/dash/teach/server";
import { BackLink, BTN, ModeTag, MUTED, Pill, Spinner } from "@/components/dash/ui";
import { billIdFor } from "@/contracts";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ invoiceId: string }> }): Promise<Metadata> {
  const { invoiceId } = await params;
  return { title: `Run ${invoiceId} · Bill Pay · Ramp` };
}

export default async function RunPage({ params }: { params: Promise<{ skillId: string; invoiceId: string }> }) {
  const { skillId, invoiceId } = await params;
  if (!SAFE_SKILL_ID.test(skillId) || !SAFE_INVOICE_ID.test(invoiceId)) notFound();
  const run = runView(invoiceId);
  if (!run.route && !run.spans.length) notFound();
  const wf = listWorkflows().find((w) => w.skill_id === skillId);
  const live = run.live.running || run.job?.status === "running";
  const started = run.spans.map((s) => s.start).sort()[0] ?? run.route?.decided_at ?? null;
  return (
    <div data-testid="run-page" data-run={invoiceId}>
      <BackLink href={`/bills/workflows/${encodeURIComponent(skillId)}?tab=runs`} label="Back to runs">
        {wf?.title ?? "Workflow"}
      </BackLink>
      <div className="mt-3 flex items-start justify-between gap-6">
        <div>
          <h1 className="text-[32px] font-normal leading-10 tracking-[-0.01em]">Run {invoiceId}</h1>
          <div className={`mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] ${MUTED}`}>
            {run.route?.version && <span>v{run.route.version}</span>}
            {started && <span>{fmtWhen(started)}</span>}
            {run.route && (
              <span className="flex items-center gap-1.5">
                Routed at {fmtPct(run.route.confidence)} <ModeTag label={realTag(run.route.mode)} />
              </span>
            )}
            {live ? (
              <Pill tone="lemon">
                <Spinner /> Running
              </Pill>
            ) : (
              <Pill tone="good">Finished</Pill>
            )}
          </div>
        </div>
        <Link href={`/bills/${billIdFor(invoiceId)}?tab=review`} className={BTN} data-testid="open-bill">
          Open bill
        </Link>
      </div>
      <RunBody initial={run} />
    </div>
  );
}
