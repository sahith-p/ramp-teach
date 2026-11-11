/**
 * Keyword concepts: the OFFLINE stand-in for the judge (mode "deterministic"). Maps a rule's text to the
 * CHECK_NAMES it talks about, plus "decision" for approve/dispute rules. Deliberately simple and labeled
 * as a heuristic everywhere it is used; the real grader is the Claude judge in ./judge.ts.
 */
import { CHECK_NAMES, type CheckName } from "@/contracts";
import { normalizeText } from "./text";

export type Concept = CheckName | "decision";

const has = (t: string, re: RegExp) => re.test(t);

export function conceptsOf(text: string): Set<Concept> {
  const t = normalizeText(text);
  const out = new Set<Concept>();
  const mentionsRate = has(t, /\brates?\b|\bhourly\b/);
  if (mentionsRate && has(t, /contract|rate card|rate cart|card/)) out.add("rate_matches_contract");
  if (has(t, /twice|two times|duplicate|double[- ]?bill|more than once|same (employee|person).*same week|billed once/))
    out.add("no_duplicate_lines");
  if (has(t, /non-labor|non labor|isn't labor|not labor|allowed (list|charge)|charges? the contract allows|\bcap\b|\blimit\b|fee/))
    out.add("no_unknown_charges");
  if (
    has(t, /quantity|multipl|times (the )?(unit )?rate|each line('s)? amount|line amounts? (and the total )?(must )?tie|amounts? (must )?tie|the math|each line and/) ||
    (has(t, /line amounts?/) && !has(t, /sum of|\btotal\b/))
  ) {
    if (!has(t, /overtime/)) out.add("line_amounts_correct");
  }
  if (has(t, /\btotal\b|sum of/)) out.add("total_matches_line_items");
  if (has(t, /timecards?|approved hours|hours approved|approved for|billed hours|more hours/) && !has(t, /overtime/))
    out.add("hours_match_timecards");
  if (has(t, /\bdispute|\bapprove\b|\bapproval\b|credit memo|\bcredit\b/) && !has(t, /approved hours|approved timecard|approved for/))
    out.add("decision");
  return out;
}

export function checksOf(text: string): CheckName[] {
  const c = conceptsOf(text);
  return CHECK_NAMES.filter((n) => c.has(n));
}
