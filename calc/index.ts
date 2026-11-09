/**
 * Calc entry point (docs/lane-spec.md §4). Mode: deterministic — NO LLM, no network, no fs writes.
 * Never reads data/answer_key.json.
 */
import { CHECK_NAMES, type CalcCheckOutput, type CalcReport, type CheckName } from "@/contracts";
import {
  hoursMatchTimecards,
  lineAmountsCorrect,
  noDuplicateLines,
  noUnknownCharges,
  rateMatchesContract,
  totalMatchesLineItems,
  type CalcInput,
} from "./checks";

export * from "./checks";
export * from "./parse";

/** Check name → implementation. Typed as a full Record so a new CHECK_NAME fails to compile here. */
export const CHECKS: Record<CheckName, (input: CalcInput) => CalcCheckOutput> = {
  line_amounts_correct: lineAmountsCorrect,
  total_matches_line_items: totalMatchesLineItems,
  rate_matches_contract: rateMatchesContract,
  no_duplicate_lines: noDuplicateLines,
  no_unknown_charges: noUnknownCharges,
  hours_match_timecards: hoursMatchTimecards,
};

/** Run all six checks in CHECK_NAMES order. `now` is injectable for deterministic tests. */
export function runCalc(input: CalcInput, now: Date = new Date()): CalcReport {
  return {
    invoice_id: input.invoice.invoice_id,
    computed_at: now.toISOString(),
    checks: CHECK_NAMES.map((name) => CHECKS[name](input)),
  };
}
