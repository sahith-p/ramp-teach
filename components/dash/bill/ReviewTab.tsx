"use client";
/**
 * Review tab: which workflow the router picked (or manual review), the workflow agent's run (links to
 * Workflows > Runs), the agent's real browser as a panel (frames polled at ~4 fps while it runs), and
 * the step list built from its spans.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { RunView } from "../teach/server";
import { fmtClock, fmtCost, fmtDuration, fmtPct, realTag, spanStep, urlPath, type StepType } from "../teach/logic";
import { Card, CheckIcon, Empty, ModeTag, MUTED, Pill, Spinner } from "../ui";
import { runFileUrl, runHref } from "./types";

export function RouteCard({ run, titles, reviewing }: { run: RunView; titles: Record<string, string>; reviewing: boolean }) {
  const { route, totals, live } = run;
  const running = live.running || reviewing;
  const wf = route?.workflow_id ?? null;
  const started = run.spans.length ? Date.parse(run.spans.map((s) => s.start).sort()[0]) : null;
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  return (
    <section data-testid="route-card" className="grid border border-[rgb(234,231,228)] bg-white md:grid-cols-2">
      <div className="p-5">
        <div className={`flex items-center gap-2 text-[13px] ${MUTED}`}>
          Routing <ModeTag label={route ? realTag(route.mode) : null} />
        </div>
        {!route && <div className="mt-1.5 text-[17px]">{reviewing ? "Choosing a workflow" : "Not routed yet"}</div>}
        {route && wf && (
          <>
            <div className="mt-1.5 flex items-baseline gap-2 text-[17px]">
              <Link href={`/bills/workflows/${encodeURIComponent(wf)}`} className="hover:underline hover:underline-offset-4">
                {titles[wf] ?? wf}
              </Link>
              {route.version != null && <span className={`text-[14px] ${MUTED}`}>v{route.version}</span>}
              <span className="tabular ml-auto text-[14px]">{fmtPct(route.confidence)}</span>
            </div>
            <p className={`mt-1 text-[14px] leading-5 ${MUTED}`}>{route.reason}</p>
          </>
        )}
        {route && !wf && (
          <>
            <div className="mt-1.5 flex items-center gap-2 text-[17px]">
              No workflow <Pill tone="warn">Manual review</Pill>
              <span className="tabular ml-auto text-[14px]">{fmtPct(route.confidence)}</span>
            </div>
            <p className={`mt-1 text-[14px] leading-5 ${MUTED}`}>{route.reason}</p>
          </>
        )}
      </div>
      <div className="border-t border-[rgb(234,231,228)] p-5 md:border-l md:border-t-0">
        <div className={`text-[13px] ${MUTED}`}>Workflow agent</div>
        {wf && (run.spans.length > 0 || running) ? (
          <>
            <Link data-testid="run-link" href={runHref(wf, run.invoice_id)} className="group mt-1.5 flex items-center gap-2 text-[17px]">
              <span className="group-hover:underline group-hover:underline-offset-4">Run {run.invoice_id}</span>
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="text-[rgb(110,106,104)]">
                <path d="M4.5 2.5 8 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
              </svg>
              {running ? (
                <span className="ml-auto">
                  <Pill tone="lemon">
                    <Spinner /> Running
                  </Pill>
                </span>
              ) : (
                <span className="ml-auto">
                  <Pill tone="good">Finished</Pill>
                </span>
              )}
            </Link>
            <div className={`tabular mt-1 flex flex-wrap gap-x-3 text-[14px] ${MUTED}`}>
              <span>{running && started && now ? fmtClock((now - started) / 1000) : fmtDuration(totals.duration_ms)}</span>
              <span>{totals.turns} turns</span>
              <span>{totals.tool_calls} tool calls</span>
              {totals.cost_usd != null && <span>{fmtCost(totals.cost_usd)}</span>}
            </div>
          </>
        ) : (
          <div className="mt-1.5 text-[17px]">{route && !wf ? "Not triggered" : "Not started"}</div>
        )}
      </div>
    </section>
  );
}

/** The agent's own browser: latest frame while it runs (~4 fps), the last frame after. */
export function LiveView({ run }: { run: RunView }) {
  const { live, invoice_id } = run;
  const base = `/api/runs/${encodeURIComponent(invoice_id)}/live`;
  const lastShot = [...run.spans].reverse().find((s) => typeof s.attrs.screenshot === "string")?.attrs.screenshot as string | undefined;
  const fallback = lastShot ? runFileUrl(invoice_id, lastShot) : null;
  const [src, setSrc] = useState<string | null>(live.has_frame ? `${base}?t=${live.frame_at}` : fallback);
  const loading = useRef(false);

  useEffect(() => {
    if (!live.running) {
      if (live.has_frame) setSrc(`${base}?t=${live.frame_at}`);
      else setSrc(fallback);
      return;
    }
    const id = setInterval(() => {
      if (loading.current) return;
      loading.current = true;
      const u = `${base}?t=${Date.now()}`;
      const img = new Image();
      img.onload = () => {
        setSrc(u);
        loading.current = false;
      };
      img.onerror = () => {
        loading.current = false;
      };
      img.src = u;
    }, 250);
    return () => clearInterval(id);
  }, [live.running, live.has_frame, live.frame_at, base, fallback]);

  const url = live.url ?? ([...run.spans].reverse().find((s) => typeof s.attrs.url === "string")?.attrs.url as string | undefined) ?? null;

  return (
    <Card
      testId="live-view"
      pad={false}
      title="Agent browser"
      aside={
        live.running ? (
          <span data-testid="live-badge" className="inline-flex items-center gap-1.5 text-[13px] text-[rgb(26,25,25)]">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#b42318] opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#b42318]" />
            </span>
            Live
          </span>
        ) : src ? (
          <span>Last frame</span>
        ) : null
      }
    >
      {src ? (
        <div className="p-3">
          <div className="overflow-hidden border border-[rgb(234,231,228)]">
            <div className="flex h-8 items-center gap-2 border-b border-[rgb(234,231,228)] bg-[rgb(250,249,248)] px-3">
              <span className="flex gap-1.5" aria-hidden>
                {[0, 1, 2].map((i) => (
                  <span key={i} className="h-2 w-2 rounded-full bg-[rgb(226,222,219)]" />
                ))}
              </span>
              <span data-testid="live-url" className="ml-2 truncate font-mono text-[11.5px] text-[rgb(71,69,67)]">
                {url ? urlPath(url) : ""}
              </span>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img data-testid="live-frame" src={src} alt="The agent's browser" className="block aspect-[16/10] w-full bg-white object-contain object-top" />
          </div>
        </div>
      ) : (
        <Empty>No live view yet</Empty>
      )}
    </Card>
  );
}

const STEP_ICON: Record<StepType, React.ReactNode> = {
  note: <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[rgb(26,25,25)]" />,
  action: (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="mt-[4px] shrink-0 text-[rgb(110,106,104)]">
      <path d="M2.5 6h7M6.5 3l3 3-3 3" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" />
    </svg>
  ),
  fact: (
    <span className="mt-[2px]">
      <CheckIcon size={14} />
    </span>
  ),
  code: (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="mt-[4px] shrink-0 text-[rgb(110,106,104)]">
      <path d="M4 3 1.5 6 4 9M8 3l2.5 3L8 9" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" />
    </svg>
  ),
};

export function StepList({ run, maxH = "max-h-[474px]" }: { run: RunView; maxH?: string }) {
  const t0 = run.spans.length ? Math.min(...run.spans.map((s) => Date.parse(s.start))) : 0;
  const steps = run.spans
    .map((s) => ({ s, step: spanStep(s) }))
    .filter((x): x is { s: (typeof run.spans)[number]; step: NonNullable<ReturnType<typeof spanStep>> } => x.step !== null);
  const box = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (run.live.running && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [steps.length, run.live.running]);

  return (
    <Card testId="agent-steps" pad={false} title="Steps" aside={steps.length ? <span className="tabular">{steps.length}</span> : null}>
      {steps.length === 0 ? (
        <Empty>No steps yet</Empty>
      ) : (
        <ol ref={box} className={`${maxH} overflow-y-auto px-5 py-3`}>
          {steps.map(({ s, step }) => (
            <li key={s.span_id} data-step={step.type} className="flex animate-[rowin_.35s_ease-out] gap-3 py-1.5 text-[14px] leading-5">
              <span className="flex w-3.5 shrink-0 justify-center">{STEP_ICON[step.type]}</span>
              <span className={`min-w-0 flex-1 ${step.type === "action" || step.type === "code" ? "text-[rgb(71,69,67)]" : ""}`}>
                {step.text}
                {step.detail && <span className={`mt-0.5 block truncate font-mono text-[11.5px] ${MUTED}`}>{step.detail}</span>}
              </span>
              <span className={`tabular shrink-0 text-[12px] leading-5 ${MUTED}`}>{fmtClock((Date.parse(s.start) - t0) / 1000)}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

export function ReviewTab({ run, titles, reviewing }: { run: RunView; titles: Record<string, string>; reviewing: boolean }) {
  return (
    <div data-testid="review-tab" className="space-y-6">
      <RouteCard run={run} titles={titles} reviewing={reviewing} />
      {(run.spans.length > 0 || run.live.running || run.live.has_frame || reviewing) && (
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <LiveView run={run} />
        <StepList run={run} />
      </div>
      )}
    </div>
  );
}
