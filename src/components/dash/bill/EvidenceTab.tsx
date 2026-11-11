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
  // One row per timecard (employee + week), with that page's facts side by side.
  const groups: { id: string; rows: FactRow[] }[] = [];
  for (const r of rows) {
    const id = `${r.subject.employee_id ?? ""}|${r.subject.week_ending ?? ""}|${r.source}`;
    const g = groups.find((x) => x.id === id);
    if (g) g.rows.push(r);
    else groups.push({ id, rows: [r] });
  }
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
            <span>{groups.length} timecards</span>
            <span>{rows.length} facts</span>
            {run.evidence && <span>{checked} checked</span>}
            {mismatched > 0 && <span className="text-[#9b1c12]">{mismatched} mismatch</span>}
          </div>
        </div>
        <ul>
          {groups.map((g) => {
            const first = g.rows[0];
            const name = names[first.subject.employee_id ?? ""] ?? subjectLabel(first.subject);
            const path = first.source.replace(/^fixture:/, "");
            const status = g.rows.some((r) => r.status === "mismatch") ? "mismatch" : g.rows.every((r) => r.status === "match") ? "match" : g.rows.some((r) => r.status === "unavailable") ? "unavailable" : null;
            return (
              <li key={g.id} data-testid="fact" data-status={status ?? "none"} className="grid grid-cols-[minmax(0,1fr)_auto_110px] items-center gap-8 border-t border-[rgb(234,231,228)] px-5 py-4 first:border-t-0">
                <div className="flex min-w-0 items-center gap-4">
                  <div className="min-w-0">
                    <div className="text-[14px]">
                      {name}
                      {first.subject.week_ending && <span className={MUTED}> · week ending {fmtDay(first.subject.week_ending)}</span>}
                    </div>
                    <a href={path} className={`mt-0.5 block truncate font-mono text-[11.5px] ${MUTED} hover:text-[rgb(26,25,25)]`}>
                      {urlPath(path)}
                    </a>
                  </div>
                </div>
                <dl className="flex gap-8">
                  {g.rows.map((r) => (
                    <div key={r.key} className="text-right">
                      <dt className={`text-[12px] ${MUTED}`}>{humanize(r.key)}</dt>
                      <dd className={`tabular text-[15px] ${r.status === "mismatch" ? "text-[#9b1c12]" : ""}`}>
                        {r.value}
                        {/hours/.test(r.key) ? " h" : ""}
                        {r.status === "mismatch" && r.rechecked != null && <span className="text-[12px]"> (page {r.rechecked})</span>}
                      </dd>
                    </div>
                  ))}
                </dl>
                <div className="flex justify-end">
                  <StatusBadge row={{ ...first, status }} />
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
