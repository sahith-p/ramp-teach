"use client";
/** A workflow being learned from a recording sent with Send to Ramp: its stages, live from the learn job. */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { LearnView } from "./server";
import { fmtDuration, STAGE_LABEL } from "./logic";
import { BTN, CheckIcon, MUTED, Pill, Spinner } from "../ui";

export function LearnCard({ initial, recording }: { initial: LearnView | null; recording?: string }) {
  const [v, setV] = useState(initial);
  const router = useRouter();
  // When the job finishes (running, or not yet seen, to done), refresh the server components so the Workflows
  // table under the card shows the new version without a navigation.
  const lastStatus = useRef(initial?.status ?? null);
  useEffect(() => {
    const status = v?.status ?? null;
    if (status === "done" && lastStatus.current !== "done") router.refresh();
    lastStatus.current = status;
  }, [v?.status, router]);
  useEffect(() => {
    let alive = true;
    const id = setInterval(async () => {
      try {
        const r = await fetch("/api/teach/learn", { cache: "no-store" });
        const j = (await r.json()) as { learn: LearnView | null };
        if (alive) setV(j.learn);
      } catch {
        /* keep last */
      }
    }, 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (!v) return null;
  if (recording ? v.session_id !== recording : v.status !== "running") return null;
  const running = v.status === "running";
  const done = v.status === "done" && v.skill_id && v.version;
  const versionHref = done ? `/bills/workflows/${encodeURIComponent(v.skill_id!)}?tab=versions&to=${v.version}` : null;

  return (
    <section data-testid="learn-card" data-status={v.status} className="mb-6 border border-[rgb(234,231,228)] bg-white">
      <div className="flex items-center justify-between gap-4 px-5 pt-4">
        <div>
          <div className="flex items-center gap-2 text-[17px]">
            {running ? <Spinner size={13} /> : done ? <CheckIcon /> : null}
            {running ? "Learning" : done ? "Learned" : "Learning stopped"} {v.title ?? "a new workflow"}
            {done && <span className={`text-[14px] ${MUTED}`}>v{v.version}</span>}
          </div>
          <Link href={`/bills/workflows/${encodeURIComponent(v.skill_id ?? "_")}/recordings/${encodeURIComponent(v.session_id)}`} className={`font-mono text-[12px] ${MUTED} hover:text-[rgb(26,25,25)]`}>
            {v.session_id}
          </Link>
        </div>
        {versionHref && (
          <Link data-testid="learn-version-link" href={versionHref} className={BTN}>
            View v{v.version}
          </Link>
        )}
        {v.status === "failed" && <Pill tone="bad">Failed</Pill>}
      </div>
      <ol className="mt-4 grid grid-cols-6 border-t border-[rgb(234,231,228)]">
        {v.stages.map((s, i) => {
          const ms = s.started_at && s.finished_at ? Date.parse(s.finished_at) - Date.parse(s.started_at) : null;
          return (
            <li key={s.name} data-stage={s.name} data-status={s.status} className={`px-5 py-3 ${i > 0 ? "border-l border-[rgb(234,231,228)]" : ""}`}>
              <div className="flex items-center gap-2 text-[14px]">
                {s.status === "done" && <CheckIcon size={14} />}
                {s.status === "running" && <Spinner size={11} />}
                {s.status === "pending" && <span className="h-3.5 w-3.5 rounded-full border border-[rgb(210,206,203)]" />}
                {s.status === "failed" && <CheckIcon ok={false} size={14} />}
                <span className={s.status === "pending" ? MUTED : ""}>{STAGE_LABEL[s.name] ?? s.name}</span>
              </div>
              <div className={`tabular mt-0.5 h-4 text-[12px] ${MUTED}`}>{ms != null ? fmtDuration(ms) : ""}</div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
