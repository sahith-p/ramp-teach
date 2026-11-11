import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RulesTab } from "@/components/dash/teach/RulesTab";
import { fmtWhen } from "@/components/dash/teach/logic";
import { ruleLineage, workflowDetail } from "@/components/dash/teach/server";
import { VersionPicker } from "@/components/dash/teach/VersionPicker";
import { EvalsTab, OverviewTab, RecordingsTab, RunsTab, versionStatus, VersionsTab } from "@/components/dash/teach/WorkflowTabs";
import { BackLink, MUTED, Pill, Stats, TabBar, VendorAvatar, Wash } from "@/components/dash/ui";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "rules", label: "Rules" },
  { key: "recordings", label: "Recordings" },
  { key: "runs", label: "Runs" },
  { key: "evals", label: "Evals" },
  { key: "versions", label: "Versions" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export async function generateMetadata({ params }: { params: Promise<{ skillId: string }> }): Promise<Metadata> {
  const { skillId } = await params;
  const d = workflowDetail(skillId);
  return { title: `${d?.summary.title ?? "Workflow"} · Bill Pay · Ramp` };
}

export default async function WorkflowPage({
  params,
  searchParams,
}: {
  params: Promise<{ skillId: string }>;
  searchParams: Promise<{ tab?: string; v?: string; from?: string; to?: string }>;
}) {
  const { skillId } = await params;
  const q = await searchParams;
  const d = workflowDetail(skillId);
  if (!d) notFound();
  const tab: TabKey = TABS.some((t) => t.key === q.tab) ? (q.tab as TabKey) : "overview";
  const nums = d.versions.map((v) => v.version);
  const pick = (x: string | undefined, dflt: number | null) => (x && nums.includes(Number(x)) ? Number(x) : dflt);
  const shownV = pick(q.v, d.active_version ?? nums.at(-1) ?? null)!;
  const version = d.versions.find((v) => v.version === shownV) ?? d.versions.at(-1)!;
  const to = pick(q.to, nums.at(-1) ?? null);
  const from = pick(q.from, nums.filter((n) => to != null && n < to).at(-1) ?? null);
  const s = d.summary;
  const base = `/bills/workflows/${encodeURIComponent(skillId)}`;
  const active = d.versions.find((v) => v.version === d.active_version);
  const st = active ? versionStatus(active, d.active_version) : null;

  return (
    <div data-testid="workflow-page" data-skill={skillId}>
      <BackLink href="/bills/workflows" label="Back to workflows">
        Workflows
      </BackLink>
      <div className="mt-3 flex items-center gap-4">
        <VendorAvatar name={s.vendor} size={48} />
        <div>
          <h1 className="text-[32px] font-normal leading-10 tracking-[-0.01em]">{s.title}</h1>
          <div className={`mt-0.5 flex items-center gap-2.5 text-[14px] ${MUTED}`}>
            <span className="font-mono text-[12.5px]">{skillId}</span>
            {st && <Pill tone={st.tone}>{st.label} v{active!.version}</Pill>}
          </div>
        </div>
      </div>
      <Stats
        items={[
          { label: "Vendor", value: s.vendor },
          { label: "Active version", value: s.active_version ? `v${s.active_version}` : "" },
          { label: "Rules", value: String(s.rules) },
          { label: "Recordings", value: String(d.recordings.length) },
          { label: "Last run", value: s.last_run ? fmtWhen(s.last_run.started_at) : "" },
          { label: "Evals", value: s.eval_state === "passed" ? "Passed" : s.eval_state === "blocked" ? "Blocked" : "" },
        ]}
      />
      <TabBar
        testId="workflow-tabs"
        active={tab}
        items={TABS.map((t) => ({
          ...t,
          href: `${base}?tab=${t.key}`,
          count: t.key === "runs" ? d.runs.length : t.key === "recordings" ? d.recordings.length : t.key === "versions" ? d.versions.length : undefined,
        }))}
      />
      <Wash>
        {tab === "overview" && <OverviewTab d={d} version={version} />}
        {tab === "rules" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <VersionPicker versions={nums} active={version.version} href={(v) => `${base}?tab=rules&v=${v}`} />
              <span className={`tabular text-[13px] ${MUTED}`}>
                {version.rules.length} rules · {version.rules.filter((r) => r.source !== "shown").length} said · {version.rules.filter((r) => r.source !== "said").length} shown
              </span>
            </div>
            <RulesTab rows={ruleLineage(d, version)} skillId={skillId} />
          </div>
        )}
        {tab === "recordings" && <RecordingsTab d={d} />}
        {tab === "runs" && <RunsTab d={d} />}
        {tab === "evals" && <EvalsTab d={d} version={version.version} />}
        {tab === "versions" && <VersionsTab d={d} from={from} to={to} />}
      </Wash>
    </div>
  );
}
