import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RecordingBody } from "@/components/dash/teach/RecordingView";
import { fmtClock, fmtWhen, speechTag } from "@/components/dash/teach/logic";
import { listWorkflows, recordingView } from "@/components/dash/teach/server";
import { BackLink, ModeTag, MUTED, Stats } from "@/components/dash/ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Recording · Bill Pay · Ramp" };

export default async function RecordingPage({ params }: { params: Promise<{ skillId: string; sessionId: string }> }) {
  const { skillId, sessionId } = await params;
  const v = recordingView(sessionId);
  if (!v) notFound();
  const titles = Object.fromEntries(listWorkflows().map((w) => [w.skill_id, w.title]));
  const backId = titles[skillId] ? skillId : (v.learned[0]?.skill_id ?? skillId);
  return (
    <div data-testid="recording-page" data-recording={sessionId}>
      <BackLink href={`/bills/workflows/${encodeURIComponent(backId)}?tab=recordings`} label="Back to recordings">
        {titles[backId] ?? "Workflows"}
      </BackLink>
      <h1 className="mt-3 text-[32px] font-normal leading-10 tracking-[-0.01em]">Recording {fmtWhen(v.started_at)}</h1>
      <div className={`mt-1 flex items-center gap-2.5 text-[14px] ${MUTED}`}>
        <span className="font-mono text-[12.5px]">{v.id}</span>
        <ModeTag label={speechTag(v.recording.speech)} />
      </div>
      <Stats
        items={[
          { label: "Length", value: fmtClock(v.duration_s) },
          { label: "Words", value: v.words ? String(v.words) : "" },
          { label: "Steps", value: String(v.steps) },
          {
            label: "Learned",
            value: v.learned.length ? (
              <span className="flex gap-3">
                {v.learned.map((l) => (
                  <Link key={`${l.skill_id}${l.version}`} href={`/bills/workflows/${encodeURIComponent(l.skill_id)}?tab=rules&v=${l.version}`} className="underline decoration-[rgb(210,206,203)] underline-offset-4 hover:decoration-[rgb(26,25,25)]">
                    {titles[l.skill_id] && l.skill_id !== backId ? `${titles[l.skill_id]} ` : ""}v{l.version}
                  </Link>
                ))}
              </span>
            ) : (
              ""
            ),
          },
        ]}
      />
      <div className="-mx-14 mt-6 min-h-[calc(100vh-260px)] border-t border-[rgb(226,222,219)] bg-[rgb(250,249,248)] px-14 pb-16 pt-6">
        <RecordingBody v={v} />
      </div>
    </div>
  );
}
