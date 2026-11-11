"use client";
/** Evidence tab: each recorded fact with its crop, the plain-code re-check result, and the rule it supports. */
import type { SkillRule } from "@/contracts";
import type { RunView } from "../teach/server";
import { fmtDay, humanize, ruleForFact, subjectLabel, urlPath } from "../teach/logic";
import { Empty, MUTED, Pill } from "../ui";
import { runFileUrl } from "./types";

interface FactRow {
  key: string;
  value: string;
  subject: Record<string, string>;
  source: string;
  status: "match" | "mismatch" | "unavailable" | null;
  rechecked: string | null;
  image: string | null;
}

export function factRows(run: RunView): FactRow[] {
  if (run.evidence)
    return run.evidence.checks.map((c) => ({
      key: c.key,
      value: c.value,
      subject: c.subject,
      source: c.source,
      status: c.status,
      rechecked: c.rechecked_value,
      image: c.screenshot,
    }));
  return (run.bundle?.items ?? [])
    .filter((i) => i.kind === "timecard_hours" || i.value != null)
    .map((i) => ({
      key: i.kind === "timecard_hours" ? "approved_hours" : i.kind,
      value: String(i.value ?? ""),
      subject: { ...(i.employee_id ? { employee_id: i.employee_id } : {}), ...(i.week_ending ? { week_ending: i.week_ending } : {}) },
      source: i.source,
      status: null,
      rechecked: null,
      image: i.screenshot,
    }));
}

function StatusBadge({ row }: { row: FactRow }) {
  if (row.status === "match") return <Pill tone="good" testId="fact-status">Checked</Pill>;
  if (row.status === "mismatch") return <Pill tone="bad" testId="fact-status">Mismatch</Pill>;
  if (row.status === "unavailable") return <Pill testId="fact-status">Not found</Pill>;
  return null;
}

export function EvidenceTab({ run, rules, names }: { run: RunView; rules: SkillRule[]; names: Record<string, string> }) {
  const rows = factRows(run);
  if (!rows.length)
    return (
      <div className="border border-[rgb(234,231,228)] bg-white">
        <Empty>No evidence yet</Empty>
      </div>
    );
  const checked = rows.filter((r) => r.status === "match").length;
  const mismatched = rows.filter((r) => r.status === "mismatch").length;
  // A fact the rule depends on is the same rule for every row: show it once, above the list.
  const ruleIds = new Set(rows.map((r) => ruleForFact(rules, r.key)?.id ?? ""));
  const anyImage = rows.some((r) => r.image);
  const oneKey = new Set(rows.map((r) => r.key)).size === 1;
  const shared = ruleIds.size === 1 ? ruleForFact(rules, rows[0].key) : null;
  return (
    <div data-testid="evidence-tab">
      <section className="border border-[rgb(234,231,228)] bg-white">
        <div className="flex min-h-12 items-center justify-between gap-6 border-b border-[rgb(234,231,228)] px-5 py-3">
          <div className="min-w-0">
            <h2 className="text-[15px] font-normal">{oneKey ? humanize(rows[0].key) : "Facts"}</h2>
            {shared && (
              <div className={`mt-0.5 text-[13px] ${MUTED}`} data-testid="fact-rule">
                Supports rule {shared.id.replace(/^r/, "")}: {shared.text}
              </div>
            )}
          </div>
          <div className={`tabular flex shrink-0 gap-4 text-[13px] ${MUTED}`}>
            <span>{rows.length} facts</span>
            {run.evidence && <span>{checked} checked</span>}
            {mismatched > 0 && <span className="text-[#9b1c12]">{mismatched} mismatch</span>}
          </div>
        </div>
        <ul>
          {rows.map((r, i) => {
            const rule = shared ? null : ruleForFact(rules, r.key);
            const who = subjectLabel(r.subject);
            const name = names[r.subject.employee_id ?? ""] ?? who;
            const unit = /hours/.test(r.key) ? " h" : "";
            const path = r.source.replace(/^fixture:/, "");
            return (
              <li key={i} data-testid="fact" data-status={r.status ?? "none"} className={`grid ${anyImage ? "grid-cols-[280px_minmax(0,1fr)_120px_110px]" : "grid-cols-[minmax(0,1fr)_120px_110px]"} items-center gap-6 border-t border-[rgb(234,231,228)] px-5 py-4 first:border-t-0`}>
                {anyImage && (
                <div className="flex h-[64px] items-center overflow-hidden">
                  {r.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={runFileUrl(run.invoice_id, r.image)} alt={`${humanize(r.key)} on the page`} className="max-h-full max-w-full border border-[rgb(234,231,228)] bg-white object-contain object-left-top" />
                  ) : null}
                </div>
                )}
                <div className="min-w-0">
                  <div className="text-[14px]">
                    {name}
                    {r.subject.week_ending && <span className={MUTED}> · week ending {fmtDay(r.subject.week_ending)}</span>}
                  </div>
                  <a href={path} className={`mt-0.5 block truncate font-mono text-[11.5px] ${MUTED} hover:text-[rgb(26,25,25)]`}>
                    {urlPath(path)}
                  </a>
                  {rule && <div className={`mt-1 text-[12.5px] ${MUTED}`}>Rule {rule.id.replace(/^r/, "")}: {rule.text}</div>}
                </div>
                <div className="tabular text-right">
                  {!oneKey && <div className={`text-[12px] ${MUTED}`}>{humanize(r.key)}</div>}
                  <div className="text-[20px] leading-7">
                    {r.value}
                    {unit}
                  </div>
                  {r.status === "mismatch" && r.rechecked != null && (
                    <div className="text-[12.5px] text-[#9b1c12]">
                      page shows {r.rechecked}
                      {unit}
                    </div>
                  )}
                </div>
                <div className="flex justify-end">
                  <StatusBadge row={r} />
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
