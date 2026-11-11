"use client";
/**
 * Rules with lineage: each rule's quote; expanded, the linked click (selector + page), a play button for
 * just that utterance's audio, and the eval cases that cover it. "said" / "shown" stays subtle.
 */
import Link from "next/link";
import { useState } from "react";
import type { SkillRule } from "@/contracts";
import { fmtClock, urlPath } from "./logic";
import { PlayIcon, useClip } from "./useClip";
import { Empty, MUTED } from "../ui";

export interface RuleLineage {
  rule: SkillRule;
  cites: {
    quote: string;
    clip: { recording: string; start: number; end: number; audio: boolean } | null;
    step: { kind: string; text: string; selector: string | null; url: string | null } | null;
  }[];
  cases: string[];
}

const SOURCE: Record<SkillRule["source"], string> = { said: "said", shown: "shown", both: "said + shown" };

export function RulesTab({ rows, skillId }: { rows: RuleLineage[]; skillId: string }) {
  const recordingHref = (id: string) => `/bills/workflows/${encodeURIComponent(skillId)}/recordings/${encodeURIComponent(id)}`;
  const [open, setOpen] = useState<string | null>(null);
  const { play, playing } = useClip();
  if (!rows.length)
    return (
      <div className="border border-[rgb(234,231,228)] bg-white">
        <Empty>No rules</Empty>
      </div>
    );
  return (
    <ol data-testid="rules" data-skill={skillId} className="border border-[rgb(234,231,228)] bg-white">
      {rows.map(({ rule, cites, cases }, i) => {
        const isOpen = open === rule.id;
        const quote = cites.find((c) => c.quote)?.quote;
        return (
          <li key={rule.id} data-rule={rule.id} className={i > 0 ? "border-t border-[rgb(234,231,228)]" : ""}>
            <button onClick={() => setOpen(isOpen ? null : rule.id)} aria-expanded={isOpen} className="flex w-full gap-4 px-5 py-4 text-left hover:bg-[#fafaf7]">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[3px] bg-[rgb(234,231,228)] text-[12px] text-[rgb(71,69,67)]">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] leading-[22px]">{rule.text}</span>
                {quote && <span className={`mt-1 block text-[13.5px] leading-5 ${MUTED}`}>“{quote}”</span>}
              </span>
              <span className={`mt-0.5 shrink-0 text-[12.5px] ${MUTED}`}>{rule.kind}</span>
              <span className={`mt-0.5 w-[84px] shrink-0 text-right text-[12.5px] ${MUTED}`} data-source={rule.source}>
                {SOURCE[rule.source]}
              </span>
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className={`mt-1.5 shrink-0 text-[rgb(110,106,104)] transition-transform ${isOpen ? "rotate-90" : ""}`}>
                <path d="M4.5 2.5 8 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
              </svg>
            </button>
            {isOpen && (
              <div data-testid="rule-lineage" className="grid gap-4 border-t border-dashed border-[rgb(234,231,228)] bg-[rgb(250,249,248)] py-4 pl-14 pr-5 text-[13.5px] md:grid-cols-[minmax(0,1fr)_220px]">
                <div className="space-y-3">
                  {cites.map((c, j) => (
                    <div key={j} className="flex gap-3">
                      {c.clip?.audio ? (
                        <button
                          data-testid="play-clip"
                          onClick={() => play(`${rule.id}-${j}`, c.clip!.recording, c.clip!.start, c.clip!.end)}
                          aria-label="Play what was said"
                          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[rgb(26,25,25)] text-white hover:bg-[rgb(71,69,67)]"
                        >
                          <PlayIcon on={playing === `${rule.id}-${j}`} />
                        </button>
                      ) : (
                        <span className="mt-0.5 h-6 w-6 shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        {c.quote && <div>“{c.quote}”</div>}
                        {c.clip && (
                          <Link href={`${recordingHref(c.clip.recording)}#t=${c.clip.start.toFixed(1)}`} className={`tabular text-[12px] ${MUTED} hover:text-[rgb(26,25,25)]`}>
                            {fmtClock(c.clip.start)} to {fmtClock(c.clip.end)}
                          </Link>
                        )}
                        {c.step && (
                          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                            <span className="text-[12px] text-[rgb(71,69,67)]">{c.step.kind}</span>
                            {c.step.selector && <code className="rounded-[3px] bg-white px-1.5 py-0.5 font-mono text-[11.5px] text-[rgb(71,69,67)] ring-1 ring-[rgb(234,231,228)]">{c.step.selector}</code>}
                            {c.step.url && <span className={`font-mono text-[11.5px] ${MUTED}`}>{urlPath(c.step.url)}</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {cites.length === 0 && <span className={MUTED}>No citation</span>}
                </div>
                <div>
                  <div className={`text-[12px] ${MUTED}`}>Covered by evals</div>
                  {cases.length ? (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {cases.map((c) => (
                        <Link key={c} href={`/bills/workflows/${encodeURIComponent(skillId)}?tab=evals`} className="rounded-[3px] bg-white px-1.5 py-0.5 font-mono text-[11.5px] ring-1 ring-[rgb(234,231,228)] hover:ring-[rgb(110,106,104)]">
                          {c}
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-1 text-[#8a4b00]">None</div>
                  )}
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
