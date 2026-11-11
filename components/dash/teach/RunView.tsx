"use client";
/**
 * Run page body: totals, a waterfall of spans on one time axis (model turns, tool calls, code, synthesis)
 * and a details panel for the selected span (tokens, cost, request id, note, screenshot).
 * Polls the run while it is live.
 */
import { useEffect, useMemo, useState } from "react";
import type { Span } from "@/contracts";
import type { RunView as Run } from "./server";
import { fmtCost, fmtDuration, fmtTokens, KIND_COLOR, KIND_LABEL, layoutSpans, realTag, spanFact, spanStep, spanTokens, tickStep, urlPath } from "./logic";
import { Card, Empty, ModeTag, MUTED, Stats } from "../ui";
import { runFileUrl } from "../bill/types";

const LEGEND = ["model", "tool", "calc", "synthesis"] as const;

export function RunBody({ initial }: { initial: Run }) {
  const [run, setRun] = useState(initial);
  const [sel, setSel] = useState<string | null>(null);
  const live = run.live.running || run.job?.status === "running";

  useEffect(() => {
    if (!live) return;
    const id = setInterval(async () => {
      try {
        const r = await fetch(`/api/runs/${encodeURIComponent(run.invoice_id)}`, { cache: "no-store" });
        if (r.ok) setRun((await r.json()) as Run);
      } catch {
        /* keep last */
      }
    }, 1000);
    return () => clearInterval(id);
  }, [live, run.invoice_id]);

  const { rows, total } = useMemo(() => layoutSpans(run.spans), [run.spans]);
  const step = tickStep(total);
  const ticks: number[] = [];
  for (let t = 0; t <= total; t += step) ticks.push(t);
  const selected = run.spans.find((s) => s.span_id === sel) ?? rows.find((r) => r.span.kind === "model")?.span ?? rows[0]?.span ?? null;
  const t = run.totals;
  const tickLabel = (ms: number) => (step >= 1000 ? `${Math.round(ms / 1000)}s` : `${(ms / 1000).toFixed(1)}s`);

  return (
    <>
      <Stats
        items={[
          { label: "Duration", value: fmtDuration(t.duration_ms), testId: "run-duration" },
          { label: "Turns", value: String(t.turns) },
          { label: "Tool calls", value: String(t.tool_calls) },
          { label: "Tokens", value: fmtTokens(t.tokens) },
          { label: "Cost", value: fmtCost(t.cost_usd) },
        ]}
      />
      <div className="-mx-14 mt-6 min-h-[calc(100vh-260px)] border-t border-[rgb(226,222,219)] bg-[rgb(250,249,248)] px-14 pb-16 pt-6">
        {rows.length === 0 ? (
          <div className="border border-[rgb(234,231,228)] bg-white">
            <Empty>No spans yet</Empty>
          </div>
        ) : (
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
            <Card
              testId="waterfall"
              pad={false}
              title="Waterfall"
              aside={
                <span className="flex items-center gap-3">
                  {LEGEND.map((k) => (
                    <span key={k} className="flex items-center gap-1.5 text-[12px]">
                      <span className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: KIND_COLOR[k] }} />
                      {KIND_LABEL[k]}
                    </span>
                  ))}
                </span>
              }
            >
              <div className="grid grid-cols-[240px_minmax(0,1fr)_64px]">
                <div className={`h-8 border-b border-[rgb(234,231,228)] pl-5 text-[12px] leading-8 ${MUTED}`}>Span</div>
                <div className="relative h-8 border-b border-[rgb(234,231,228)]">
                  {ticks.map((tk) => (
                    <span key={tk} className={`tabular absolute top-0 text-[11px] leading-8 ${MUTED}`} style={{ left: `${((tk / total) * 100).toFixed(2)}%`, transform: tk === 0 ? "none" : "translateX(-50%)" }}>
                      {tickLabel(tk)}
                    </span>
                  ))}
                </div>
                <div className={`h-8 border-b border-[rgb(234,231,228)] pr-5 text-right text-[12px] leading-8 ${MUTED}`}>Time</div>
                {rows.map((r) => {
                  const on = selected?.span_id === r.span.span_id;
                  const left = (r.start / total) * 100;
                  const width = Math.max(0.4, ((r.end - r.start) / total) * 100);
                  return (
                    <button
                      key={r.span.span_id}
                      data-span={r.span.span_id}
                      data-kind={r.span.kind}
                      onClick={() => setSel(r.span.span_id)}
                      className={`col-span-3 grid grid-cols-subgrid items-center text-left ${on ? "bg-[rgb(244,242,240)]" : "hover:bg-[#fafaf7]"}`}
                    >
                      <span className="truncate py-1.5 pl-5 pr-3 text-[13px]" style={{ paddingLeft: 20 + r.depth * 14 }}>
                        {r.span.name}
                      </span>
                      <span className="relative h-7">
                        {ticks.map((tk) => (
                          <span key={tk} className="absolute inset-y-0 w-px bg-[rgb(244,242,240)]" style={{ left: `${((tk / total) * 100).toFixed(2)}%` }} />
                        ))}
                        <span
                          className="absolute top-1/2 h-3 -translate-y-1/2 rounded-[3px]"
                          style={{ left: `${left.toFixed(2)}%`, width: `${width.toFixed(2)}%`, minWidth: 3, backgroundColor: KIND_COLOR[r.span.kind] ?? "#8a8a8a", opacity: r.span.kind === "run" ? 0.6 : 1 }}
                        />
                      </span>
                      <span className={`tabular pr-5 text-right text-[12px] ${MUTED}`}>{fmtDuration(r.end - r.start)}</span>
                    </button>
                  );
                })}
              </div>
            </Card>
            {selected && <SpanDetails span={selected} invoiceId={run.invoice_id} />}
          </div>
        )}
      </div>
    </>
  );
}

function Row({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  if (v === null || v === undefined || v === "") return null;
  return (
    <>
      <dt className={MUTED}>{k}</dt>
      <dd className={`min-w-0 break-words ${mono ? "font-mono text-[12px]" : "tabular"}`}>{v}</dd>
    </>
  );
}

function SpanDetails({ span, invoiceId }: { span: Span; invoiceId: string }) {
  const a = span.attrs;
  const tk = spanTokens(span);
  const fact = spanFact(span);
  const step = spanStep(span);
  const note = typeof a.note === "string" ? a.note : null;
  const shot = typeof a.screenshot === "string" ? a.screenshot : null;
  const input = a.input && typeof a.input === "object" ? JSON.stringify(a.input) : null;
  return (
    <Card testId="span-details" title={span.name} aside={<ModeTag label={realTag(span.mode)} />} className="xl:sticky xl:top-6">
      <div className="flex items-center gap-2 text-[13px]">
        <span className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: KIND_COLOR[span.kind] }} />
        {KIND_LABEL[span.kind] ?? span.kind}
        <span className={`tabular ml-auto ${MUTED}`}>{fmtDuration(Date.parse(span.end) - Date.parse(span.start))}</span>
      </div>
      {(note || (step && step.type !== "note")) && <p className="mt-3 text-[14px] leading-5">{note ?? step?.text}</p>}
      <dl className="mt-4 grid grid-cols-[96px_1fr] gap-x-3 gap-y-2 text-[13px]">
        <Row k="Model" v={a.model as string} mono />
        <Row k="Input" v={tk.input ? tk.input.toLocaleString() : null} />
        <Row k="Output" v={tk.output ? tk.output.toLocaleString() : null} />
        <Row k="Cache read" v={tk.cacheRead ? tk.cacheRead.toLocaleString() : null} />
        <Row k="Cache write" v={tk.cacheWrite ? tk.cacheWrite.toLocaleString() : null} />
        <Row k="Cost" v={typeof a.cost_usd === "number" ? fmtCost(a.cost_usd) : null} />
        <Row k="Request" v={a.request_id as string} mono />
        <Row k="Message" v={a.message_id as string} mono />
        <Row k="Tool" v={a.tool as string} mono />
        <Row k="Input" v={!tk.input ? input : null} mono />
        <Row k="Result" v={typeof a.result === "string" ? a.result : null} />
        <Row k="Page" v={typeof a.url === "string" ? urlPath(a.url) : null} mono />
        <Row k="Fact" v={fact ? `${fact.key} = ${fact.value}` : null} mono />
        <Row k="Start" v={new Date(span.start).toISOString().slice(11, 23)} mono />
      </dl>
      {shot && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={runFileUrl(invoiceId, shot)} alt="Screenshot at this step" className="mt-4 block w-full border border-[rgb(234,231,228)]" />
      )}
    </Card>
  );
}
