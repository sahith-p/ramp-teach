"use client";
/** Ramp Teach inside Ramp: learning progress from a sent recording, then the learned workflow. */
import { useEffect, useState } from "react";
import type { LearnMeta, Recording, WorkflowSpec } from "@/contracts";
import type { LearnJob } from "@/lib/learnjob";
import { Spinner } from "./ui";

interface View {
  job: LearnJob | null;
  progress: string[];
  meta: LearnMeta | null;
  spec: WorkflowSpec | null;
  recording: Recording | null;
}

const Check = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden className="shrink-0 text-[#17633a]">
    <circle cx="8" cy="8" r="7" fill="currentColor" opacity=".12" />
    <path d="m5 8.2 2 2 4-4.4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function stepText(s: Recording["steps"][number]): { k: string; t: string } {
  const d = s.detail;
  if (s.kind === "narration") return { k: "Said", t: `“${d.text ?? ""}”` };
  let path = "";
  try {
    path = d.url ? new URL(d.url).pathname.replace(/^\/portal/, "") || "/" : "";
  } catch {}
  if (d.event === "navigate") return { k: "Page", t: d.title?.split(" · ")[0] || path };
  if (d.event === "click") {
    const sel = d.selector ?? "";
    const label =
      d.text ||
      /href="[^"]*\/([^"/?]+)(\?week=[^"]*)?"/.exec(sel)?.[1] ||
      /data-field="([^"]+)"/.exec(sel)?.[1]?.replace(/_/g, " ") ||
      /name="([^"]+)"/.exec(sel)?.[1] ||
      "";
    return { k: "Click", t: label };
  }
  if (d.event === "input" || d.event === "change") return { k: "Typed", t: d.value === "[redacted]" ? "password" : (d.value ?? "") };
  if (d.event === "submit") return { k: "Submit", t: "form" };
  return { k: d.event ?? "Step", t: d.text ?? path };
}

export function TeachView({ initial }: { initial: View }) {
  const [v, setV] = useState(initial);
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const r = await fetch("/api/learn", { cache: "no-store" });
        setV((await r.json()) as View);
      } catch {}
    }, 1000);
    return () => clearInterval(id);
  }, []);
  const learning = v.job?.status === "running";
  const fromSent = v.job && v.meta?.recording_path === v.job.recording_path;

  return (
    <div>
      <div className="flex items-end justify-between">
        <div>
          <div className="text-[16px] leading-6 text-[rgb(110,106,104)]">Ramp Teach</div>
          <h1 className="mt-1 text-[40px] font-normal leading-[48px] tracking-[-0.01em]">Invoice review</h1>
        </div>
        <div className="pb-2">
          {learning ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-[#f4f8c7] px-3 py-1 text-[13px]">
              <Spinner /> Learning
            </span>
          ) : v.spec ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-[#e3f3e8] px-3 py-1 text-[13px] text-[#17633a]">Active on Bill Pay</span>
          ) : null}
        </div>
      </div>

      <div className="-mx-14 mt-7 min-h-[calc(100vh-200px)] border-t border-[rgb(226,222,219)] bg-[rgb(250,249,248)] px-14 pb-16 pt-6">
        {learning && (
          <section className="mb-6 border border-[rgb(234,231,228)] bg-white p-6">
            <div className="flex items-center gap-2 text-[17px]">
              <Spinner size={14} /> Learning from your recording
            </div>
            <ol className="mt-4 space-y-2 text-[14px] text-[rgb(71,69,67)]">
              {v.progress.map((p) => (
                <li key={p} className="flex animate-[rowin_.4s_ease-out] items-center gap-2.5">
                  <Check />
                  {p}
                </li>
              ))}
            </ol>
          </section>
        )}

        {!learning && v.spec && (
          <div className="grid animate-[rowin_.5s_ease-out] gap-6 lg:grid-cols-[1.25fr_1fr]">
            <div className="space-y-6">
              <section className="border border-[rgb(234,231,228)] bg-white p-6">
                <div className="flex items-baseline justify-between">
                  <h2 className="text-[20px] font-normal">Rules</h2>
                  <span className="text-[13px] text-[rgb(110,106,104)]">{fromSent ? "Learned from the recording you just sent" : "Learned from a recording"}</span>
                </div>
                <ol className="mt-4 space-y-3 text-[14.5px]">
                  {v.spec.rules.map((r, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[3px] bg-[rgb(234,231,228)] text-[12px] text-[rgb(71,69,67)]">{i + 1}</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ol>
              </section>
              <section className="grid gap-6 border border-[rgb(234,231,228)] bg-white p-6 md:grid-cols-2">
                <div>
                  <h2 className="text-[16px] font-normal">Where it looks</h2>
                  <ul className="mt-3 space-y-2.5 text-[13.5px]">
                    {v.spec.proof_sources.map((p, i) => (
                      <li key={i}>
                        <div>{p.app}</div>
                        <div className="text-[12.5px] text-[rgb(110,106,104)]">{p.fields.join(", ")}</div>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h2 className="text-[16px] font-normal">Open questions</h2>
                  <ul className="mt-3 space-y-2 text-[13.5px] text-[rgb(71,69,67)]">
                    {v.spec.open_questions.length ? v.spec.open_questions.map((q, i) => <li key={i}>{q}</li>) : <li>None</li>}
                  </ul>
                </div>
              </section>
            </div>
            <section className="border border-[rgb(234,231,228)] bg-white p-6">
              <div className="flex items-baseline justify-between">
                <h2 className="text-[20px] font-normal">Recording</h2>
                <span className="text-[13px] text-[rgb(110,106,104)]">
                  {v.recording ? `${v.recording.steps.length} steps` : ""}
                  {v.meta?.provenance?.operator === "scripted_playwright" ? " · scripted test run" : ""}
                </span>
              </div>
              <ol className="mt-4 max-h-[620px] space-y-1 overflow-y-auto text-[13.5px]">
                {(v.recording?.steps ?? []).map((s, i) => {
                  const { k, t } = stepText(s);
                  if (!t) return null;
                  return (
                    <li key={i} className={`flex gap-3 px-2 py-1.5 ${s.kind === "narration" ? "bg-[#f4f8c7]" : ""}`}>
                      <span className="w-14 shrink-0 text-[12px] text-[rgb(110,106,104)]">{k}</span>
                      <span className={s.kind === "narration" ? "" : "text-[rgb(71,69,67)]"}>{t}</span>
                    </li>
                  );
                })}
              </ol>
            </section>
          </div>
        )}
        {!learning && !v.spec && <div className="py-24 text-center text-[rgb(110,106,104)]">Record a review with the Ramp Teach extension and send it here.</div>}
      </div>
    </div>
  );
}
