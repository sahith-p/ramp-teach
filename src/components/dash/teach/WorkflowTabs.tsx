/** Server-rendered tabs of a workflow page: Overview, Recordings, Runs, Evals, Versions. */
import Link from "next/link";
import { GATE, type SkillEvalMetrics, type SkillEvalRun, type SkillVersion } from "@/contracts";
import type { RecordingSummary, RunSummary, WorkflowDetail } from "./server";
import { evalForVersion } from "./server";
import { diffRules, fmtClock, fmtCost, fmtDuration, fmtPct, fmtTokens, fmtWhen, realTag, speechTag } from "./logic";
import { VersionPicker } from "./VersionPicker";
import { Card, Empty, ModeTag, MUTED, Pill, Spinner } from "../ui";

const base = (id: string) => `/bills/workflows/${encodeURIComponent(id)}`;

export function versionStatus(v: SkillVersion, active: number | null): { label: string; tone: "good" | "bad" | "neutral" } {
  if (v.version === active) return { label: "Active", tone: "good" };
  if (v.status === "blocked") return { label: "Blocked", tone: "bad" };
  return { label: "Draft", tone: "neutral" };
}

const th = `py-3 font-normal text-left text-[13px] ${MUTED}`;
const Table = ({ head, children, testId }: { head: React.ReactNode; children: React.ReactNode; testId?: string }) => (
  <div data-testid={testId} className="overflow-hidden border border-[rgb(234,231,228)] bg-white">
    <table className="w-full text-[14px]">
      <thead>
        <tr>{head}</tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  </div>
);

/* -------------------------------- overview -------------------------------- */

export function OverviewTab({ d, version }: { d: WorkflowDetail; version: SkillVersion }) {
  const id = d.summary.skill_id;
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <Card title="Rules" aside={<Link href={`${base(id)}?tab=rules`} className="hover:text-[rgb(26,25,25)]">All rules</Link>}>
        <ol className="space-y-3 text-[14.5px]">
          {version.rules.map((r, i) => (
            <li key={r.id} className="flex gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[3px] bg-[rgb(234,231,228)] text-[12px] text-[rgb(71,69,67)]">{i + 1}</span>
              <span>{r.text}</span>
            </li>
          ))}
        </ol>
      </Card>
      <div className="space-y-6">
        <Card title="Pages it reads">
          <ul className="space-y-3">
            {version.portal_map.map((p) => (
              <li key={p.page}>
                <div className="font-mono text-[12.5px]">{p.page}</div>
                <div className={`mt-0.5 text-[13px] ${MUTED}`}>{p.fields.map((f) => f.name.replace(/_/g, " ")).join(", ")}</div>
              </li>
            ))}
            {!version.portal_map.length && <li className={MUTED}>None</li>}
          </ul>
        </Card>
        <Card title="Checks">
          <ul className="space-y-1.5 text-[13px]">
            {version.checks.map((c) => (
              <li key={c.file} className="flex justify-between gap-3">
                <span>{c.name.replace(/_/g, " ")}</span>
                <span className={`font-mono text-[12px] ${MUTED}`}>{c.file.split("/").pop()}</span>
              </li>
            ))}
            {!version.checks.length && <li className={MUTED}>None</li>}
          </ul>
        </Card>
        {version.open_questions.length > 0 && (
          <Card title="Open questions">
            <ul className="space-y-2 text-[14px]">
              {version.open_questions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}

/* ------------------------------- recordings ------------------------------- */

export function RecordingsTab({ d }: { d: WorkflowDetail }) {
  const id = d.summary.skill_id;
  return (
    <Table
      testId="recordings-table"
      head={
        <>
          <th className={`${th} pl-5`}>Recording</th>
          <th className={th}>Length</th>
          <th className={th}>Words</th>
          <th className={th}>Steps</th>
          <th className={th}>Speech</th>
          <th className={`${th} pr-5`}>Learned</th>
        </>
      }
    >
      {d.recordings.length === 0 && (
        <tr>
          <td colSpan={6}>
            <Empty>No recordings yet</Empty>
          </td>
        </tr>
      )}
      {d.recordings.map((r: RecordingSummary) => (
        <tr key={r.id} data-recording={r.id} className="relative border-t border-[rgb(234,231,228)] hover:bg-[#fafaf7]">
          <td className="py-3 pl-5">
            <Link href={`${base(id)}/recordings/${encodeURIComponent(r.id)}`} className="after:absolute after:inset-0">
              {fmtWhen(r.started_at)}
            </Link>
            <div className={`font-mono text-[11.5px] ${MUTED}`}>{r.id}</div>
          </td>
          <td className="tabular py-3">{fmtClock(r.duration_s)}</td>
          <td className="tabular py-3">{r.words || ""}</td>
          <td className="tabular py-3">{r.steps}</td>
          <td className="py-3">
            <ModeTag label={speechTag(r.speech as never)} />
          </td>
          <td className="py-3 pr-5">{r.learned.filter((l) => l.skill_id === id).map((l) => `v${l.version}`).join(", ")}</td>
        </tr>
      ))}
    </Table>
  );
}

/* ---------------------------------- runs ---------------------------------- */

const REC: Record<string, string> = { approve: "Approve", dispute: "Dispute", review: "Review" };

export function RunsTab({ d }: { d: WorkflowDetail }) {
  const id = d.summary.skill_id;
  return (
    <Table
      testId="runs-table"
      head={
        <>
          <th className={`${th} pl-5`}>Invoice</th>
          <th className={th}>Started</th>
          <th className={th}>Version</th>
          <th className={`${th} text-right`}>Duration</th>
          <th className={`${th} text-right`}>Turns</th>
          <th className={`${th} text-right`}>Tokens</th>
          <th className={`${th} text-right`}>Cost</th>
          <th className={`${th} pl-8 pr-5`}>Recommendation</th>
        </>
      }
    >
      {d.runs.length === 0 && (
        <tr>
          <td colSpan={8}>
            <Empty>No runs yet</Empty>
          </td>
        </tr>
      )}
      {d.runs.map((r: RunSummary) => (
        <tr key={r.invoice_id} data-run={r.invoice_id} className="relative border-t border-[rgb(234,231,228)] hover:bg-[#fafaf7]">
          <td className="py-3 pl-5">
            <Link href={`${base(id)}/runs/${encodeURIComponent(r.invoice_id)}`} className="after:absolute after:inset-0">
              {r.invoice_id}
            </Link>
          </td>
          <td className={`py-3 ${MUTED}`}>{fmtWhen(r.started_at)}</td>
          <td className="py-3">{r.version ? `v${r.version}` : ""}</td>
          <td className="tabular py-3 text-right">{fmtDuration(r.duration_ms)}</td>
          <td className="tabular py-3 text-right">{r.turns}</td>
          <td className="tabular py-3 text-right">{fmtTokens(r.tokens)}</td>
          <td className="tabular py-3 text-right">{fmtCost(r.cost_usd)}</td>
          <td className="py-3 pl-8 pr-5">
            {r.running ? (
              <Pill tone="lemon">
                <Spinner /> Running
              </Pill>
            ) : r.recommendation ? (
              REC[r.recommendation]
            ) : (
              ""
            )}
          </td>
        </tr>
      ))}
    </Table>
  );
}

/* ---------------------------------- evals ---------------------------------- */

const METRICS: { key: keyof SkillEvalMetrics; label: string; gate?: number; lowerBetter?: boolean }[] = [
  { key: "rule_recall", label: "Rule recall", gate: GATE.rule_recall },
  { key: "rule_precision", label: "Precision", gate: GATE.rule_precision },
  { key: "citations_valid", label: "Citations", gate: GATE.citations_valid },
  { key: "coverage", label: "Coverage", gate: GATE.coverage },
  { key: "replay_agreement", label: "Replay", gate: GATE.replay_agreement },
  { key: "consistency", label: "Consistency" },
  { key: "wer", label: "WER", lowerBetter: true },
];

/** Only the lines worth a reviewer's attention (misses, inventions, disagreements), in plain words, at most 3. */
function problemNotes(notes: Record<string, string[]>): string[] {
  const out: string[] = [];
  for (const n of Object.values(notes).flat()) {
    const m = /^(MISSED|INVENTED|DISAGREE|INVALID|MISSING|KEYTERM)\b[:\s]*(.*)$/.exec(n);
    if (!m) continue;
    if (m[1] === "KEYTERM") {
      const h = /heard (\d+) of (\d+)/.exec(m[2]);
      if (!h || Number(h[1]) >= Number(h[2])) continue;
    }
    const label = { MISSED: "Missed", INVENTED: "Invented", DISAGREE: "Disagrees", INVALID: "Invalid citation", MISSING: "Missing", KEYTERM: "Misheard" }[m[1]];
    out.push(`${label}: ${m[2].replace(/^gold \d+ /, "").trim()}`);
  }
  return out;
}

/** "rule_recall 0.98 < 1.00 (cases: paraphrase)" -> "Rule recall 98% (min 100%) · paraphrase" */
function gateLine(f: string): string {
  const m = /^(\w+) ([\d.]+) < ([\d.]+)(?: \(cases: (.+)\))?/.exec(f);
  if (!m) return f;
  const label = m[1].replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  return `${label} ${Math.round(Number(m[2]) * 100)}% (min ${Math.round(Number(m[3]) * 100)}%)${m[4] ? ` · ${m[4]}` : ""}`;
}

const fails = (m: (typeof METRICS)[number], x: number | null) => m.gate !== undefined && x != null && x < m.gate;
const fmtMetric = (m: (typeof METRICS)[number], x: number | null | undefined) => (x == null ? "" : m.key === "wer" ? fmtPct(x, 1) : fmtPct(x));

export function EvalsTab({ d, version }: { d: WorkflowDetail; version: number }) {
  const id = d.summary.skill_id;
  const run = evalForVersion(d, version);
  const withRuns = d.versions.map((v) => ({ v, run: evalForVersion(d, v.version) })).filter((x): x is { v: SkillVersion; run: SkillEvalRun } => x.run !== null);
  return (
    <div className="space-y-6" data-testid="evals-tab">
      <div className="flex items-center justify-between">
        <VersionPicker versions={d.versions.map((v) => v.version)} active={version} href={(v) => `${base(id)}?tab=evals&v=${v}`} />
        {run && (
          <div className={`tabular flex items-center gap-3 text-[13px] ${MUTED}`}>
            <span>{run.results.length} cases</span>
            {run.cost_usd != null && <span>{fmtCost(run.cost_usd)}</span>}
            <span>{fmtWhen(run.created_at)}</span>
            <ModeTag label={realTag(run.mode)} />
          </div>
        )}
      </div>
      {!run ? (
        <div className="border border-[rgb(234,231,228)] bg-white">
          <Empty>No evals for v{version}</Empty>
        </div>
      ) : (
        <>
          <section data-testid="eval-gate" data-passed={run.gate.passed} className="grid border border-[rgb(234,231,228)] bg-white md:grid-cols-[220px_1fr]">
            <div className="border-b border-[rgb(234,231,228)] p-5 md:border-b-0 md:border-r">
              <div className={`text-[13px] ${MUTED}`}>Gate</div>
              <div className="mt-1.5">{run.gate.passed ? <Pill tone="good">Passed</Pill> : <Pill tone="bad">Blocked</Pill>}</div>
              {run.gate.failures.length > 0 && (
                <ul className="mt-3 space-y-1 text-[12.5px] text-[#9b1c12]">
                  {run.gate.failures.map((f) => (
                    <li key={f}>{gateLine(f)}</li>
                  ))}
                </ul>
              )}
            </div>
            <dl className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7">
              {METRICS.map((m) => {
                const x = run.summary[m.key];
                return (
                  <div key={m.key} className="border-b border-[rgb(234,231,228)] p-5 xl:border-b-0 [&:not(:first-child)]:border-l">
                    <dt className={`text-[13px] ${MUTED}`}>{m.label}</dt>
                    <dd className={`tabular mt-1 text-[22px] leading-7 ${fails(m, x) ? "text-[#b42318]" : ""}`}>{fmtMetric(m, x) || <span className={MUTED}>n/a</span>}</dd>
                    {m.gate !== undefined && <div className={`tabular text-[11.5px] ${MUTED}`}>min {fmtPct(m.gate)}</div>}
                  </div>
                );
              })}
            </dl>
          </section>

          <Card title="Cases" pad={false}>
            <table className="w-full text-[14px]">
              <thead>
                <tr>
                  <th className={`${th} pl-5`}>Case</th>
                  {METRICS.filter((m) => m.key !== "consistency").map((m) => (
                    <th key={m.key} className={`${th} whitespace-nowrap px-4 text-right`}>
                      {m.label === "Rule recall" ? "Recall" : m.label}
                    </th>
                  ))}
                  <th className={`${th} pl-6 pr-5`}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {run.results.map((r) => {
                  const notes = problemNotes(r.notes);
                  return (
                    <tr key={r.case_id} data-case={r.case_id} className="border-t border-[rgb(234,231,228)] align-top">
                      <td className="py-3 pl-5">
                        <div className="whitespace-nowrap font-mono text-[12.5px]">{r.case_id}</div>
                      </td>
                      {METRICS.filter((m) => m.key !== "consistency").map((m) => (
                        <td key={m.key} className={`tabular whitespace-nowrap px-4 py-3 text-right ${fails(m, r.metrics[m.key]) ? "text-[#b42318]" : ""}`}>
                          {fmtMetric(m, r.metrics[m.key])}
                        </td>
                      ))}
                      <td className={`py-3 pl-6 pr-5 text-[13px] leading-[18px] ${MUTED}`}>
                        {notes.slice(0, 3).map((n, i) => (
                          <div key={i}>{n}</div>
                        ))}
                        {notes.length > 3 && <div>+{notes.length - 3} more</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </>
      )}

      {withRuns.length > 1 && (
        <Card title="Trend" pad={false} testId="eval-trend">
          <table className="w-full text-[14px]">
            <thead>
              <tr>
                <th className={`${th} pl-5`}>Metric</th>
                {withRuns.map(({ v }) => (
                  <th key={v.version} className={`${th} text-right ${v.version === version ? "text-[rgb(26,25,25)]" : ""}`}>
                    v{v.version}
                  </th>
                ))}
                <th className={`${th} pr-5 pl-6`}>
                  <span className="sr-only">Change</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {METRICS.map((m) => {
                const xs = withRuns.map(({ run }) => run.summary[m.key]);
                return (
                  <tr key={m.key} className="border-t border-[rgb(234,231,228)]">
                    <td className="py-2.5 pl-5">{m.label}</td>
                    {xs.map((x, i) => (
                      <td key={i} className={`tabular py-2.5 text-right ${fails(m, x) ? "text-[#b42318]" : ""}`}>
                        {fmtMetric(m, x)}
                      </td>
                    ))}
                    <td className="py-2.5 pl-6 pr-5">
                      <Spark values={xs} lowerBetter={m.lowerBetter} />
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t border-[rgb(234,231,228)]">
                <td className="py-2.5 pl-5">Gate</td>
                {withRuns.map(({ v, run }) => (
                  <td key={v.version} className="py-2.5 text-right">
                    {run.gate.passed ? <span className="text-[#17633a]">Passed</span> : <span className="text-[#9b1c12]">Blocked</span>}
                  </td>
                ))}
                <td />
              </tr>
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

/** Tiny line of a metric across versions (single series; the table carries the values). */
function Spark({ values, lowerBetter }: { values: (number | null)[]; lowerBetter?: boolean }) {
  const pts = values.map((v, i) => ({ i, v })).filter((p): p is { i: number; v: number } => p.v != null);
  if (pts.length < 2) return null;
  const lo = Math.min(...pts.map((p) => p.v));
  const hi = Math.max(...pts.map((p) => p.v));
  const W = 72;
  const H = 18;
  const x = (i: number) => (i / (values.length - 1)) * (W - 4) + 2;
  const y = (v: number) => (hi === lo ? H / 2 : lowerBetter ? 2 + ((v - lo) / (hi - lo)) * (H - 4) : H - 2 - ((v - lo) / (hi - lo)) * (H - 4));
  return (
    <svg width={W} height={H} aria-hidden className="block">
      <polyline points={pts.map((p) => `${x(p.i)},${y(p.v)}`).join(" ")} fill="none" stroke="#2a78d6" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(pts.at(-1)!.i)} cy={y(pts.at(-1)!.v)} r="2.5" fill="#2a78d6" />
    </svg>
  );
}

/* -------------------------------- versions -------------------------------- */

export function VersionsTab({ d, from, to }: { d: WorkflowDetail; from: number | null; to: number | null }) {
  const id = d.summary.skill_id;
  const nums = d.versions.map((v) => v.version);
  const a = d.versions.find((v) => v.version === from);
  const b = d.versions.find((v) => v.version === to);
  const diff = a && b ? diffRules(a.rules, b.rules) : null;
  return (
    <div className="space-y-6" data-testid="versions-tab">
      <Table
        testId="versions-table"
        head={
          <>
            <th className={`${th} pl-5`}>Version</th>
            <th className={th}>Status</th>
            <th className={th}>Created</th>
            <th className={`${th} text-right`}>Rules</th>
            <th className={`${th} pl-8`}>Learned from</th>
            <th className={th}>Evals</th>
            <th className={`${th} pr-5`}>
              <span className="sr-only">Produced by</span>
            </th>
          </>
        }
      >
        {[...d.versions].reverse().map((v) => {
          const st = versionStatus(v, d.active_version);
          const ev = evalForVersion(d, v.version);
          return (
            <tr key={v.version} data-version={v.version} className="border-t border-[rgb(234,231,228)]">
              <td className="py-3 pl-5">v{v.version}</td>
              <td className="py-3">
                <Pill tone={st.tone}>{st.label}</Pill>
              </td>
              <td className={`py-3 ${MUTED}`}>{fmtWhen(v.created_at)}</td>
              <td className="tabular py-3 text-right">{v.rules.length}</td>
              <td className="py-3 pl-8">
                {v.recordings.map((r) => (
                  <Link key={r} href={`${base(id)}/recordings/${encodeURIComponent(r)}`} className={`block font-mono text-[12px] ${MUTED} hover:text-[rgb(26,25,25)]`}>
                    {r}
                  </Link>
                ))}
              </td>
              <td className="py-3">{ev ? ev.gate.passed ? <span className="text-[#17633a]">Passed</span> : <span className="text-[#9b1c12]">Blocked</span> : <span className={MUTED}>Not run</span>}</td>
              <td className="py-3 pr-5 text-right">
                <ModeTag label={realTag(v.mode)} />
              </td>
            </tr>
          );
        })}
      </Table>

      {nums.length > 1 && from != null && to != null && (
        <Card
          testId="rule-diff"
          title={
            <span className="flex items-center gap-3">
              Rule changes
              {diff && (
                <span className={`tabular text-[13px] ${MUTED}`}>
                  {diff.added.length} added · {diff.removed.length} removed · {diff.changed.length} changed
                </span>
              )}
            </span>
          }
          aside={
            <>
              <VersionPicker label="From" versions={nums} active={from} href={(v) => `${base(id)}?tab=versions&from=${v}&to=${to}`} />
              <VersionPicker label="To" versions={nums} active={to} href={(v) => `${base(id)}?tab=versions&from=${from}&to=${v}`} />
            </>
          }
          pad={false}
        >
          {!diff || (!diff.added.length && !diff.removed.length && !diff.changed.length) ? (
            <Empty>No rule changes</Empty>
          ) : (
            <ul className="text-[14px]">
              {diff.added.map((r) => (
                <li key={`a${r.id}`} data-diff="added" className="flex gap-3 border-b border-[rgb(234,231,228)] px-5 py-3 last:border-b-0">
                  <span className="w-4 shrink-0 text-center text-[#17633a]">+</span>
                  <span>{r.text}</span>
                </li>
              ))}
              {diff.removed.map((r) => (
                <li key={`r${r.id}`} data-diff="removed" className="flex gap-3 border-b border-[rgb(234,231,228)] px-5 py-3 last:border-b-0">
                  <span className="w-4 shrink-0 text-center text-[#b42318]">−</span>
                  <span className={`line-through decoration-[rgb(210,206,203)] ${MUTED}`}>{r.text}</span>
                </li>
              ))}
              {diff.changed.map(({ from: f, to: t }) => (
                <li key={`c${t.id}`} data-diff="changed" className="flex gap-3 border-b border-[rgb(234,231,228)] px-5 py-3 last:border-b-0">
                  <span className={`w-4 shrink-0 text-center ${MUTED}`}>~</span>
                  <span>
                    <span className={`block line-through decoration-[rgb(210,206,203)] ${MUTED}`}>{f.text}</span>
                    <span className="block">{t.text}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
