/**
 * SUPPORTING CONTRACTS (Phase 0). Shapes shared between lanes that the spec did not name.
 * Frozen like core.ts: only the orchestrator may change them, and only additively
 * (new optional fields) unless a human DECISION line in board/humans.md says otherwise.
 */
import { z } from "zod";
import { InvoiceSchema, RecommendationSchema } from "./core";

/* ------------------------------- Check names -------------------------------- */

/** Every check the calc path (and receipts) may report. Order = display order. */
export const CHECK_NAMES = [
  "line_amounts_correct", // quantity * unit_rate == amount for every line (to the cent; use lib/money.ts moneyEq)
  "total_matches_line_items", // sum(line amounts) == invoice.total (to the cent; use lib/money.ts moneyEq)
  "rate_matches_contract", // labor line unit_rate == contracted bill rate for the role
  "no_duplicate_lines", // no two labor lines bill the same employee for the same week
  "no_unknown_charges", // every non-labor line is an allowed charge in the contract
  "hours_match_timecards", // labor hours <= approved timecard hours for employee+week
] as const;
export const CheckNameSchema = z.enum(CHECK_NAMES);
export type CheckName = z.infer<typeof CheckNameSchema>;

/* -------------------------- Line description format ------------------------- */

/**
 * Labor lines MUST use exactly this description format (data lane writes it, calc lane parses it):
 *   "Labor: <Employee Name> (<Role>) - week ending YYYY-MM-DD"
 * Any line that does not match is a non-labor charge (matched by exact description against
 * VendorProfile.contract.allowed_charges[].description).
 */
export const LABOR_LINE_REGEX = /^Labor: (.+) \((.+)\) - week ending (\d{4}-\d{2}-\d{2})$/;

/* ------------------------------ Vendor profile ------------------------------ */

export const RateCardEntrySchema = z.object({
  role: z.string(),
  bill_rate: z.number(), // USD per hour
});

export const AllowedChargeSchema = z.object({
  description: z.string(), // exact line description
  max_amount: z.number().nullable(), // null = no cap
});

export const EmployeeSchema = z.object({
  employee_id: z.string(), // e.g. "E-101"
  name: z.string(),
  role: z.string(), // must match a rate_card role
});
export type Employee = z.infer<typeof EmployeeSchema>;

export const VendorProfileSchema = z.object({
  vendor: z.string(),
  vendor_id: z.string(),
  contract: z.object({
    contract_id: z.string(),
    effective_from: z.string(),
    effective_to: z.string(),
    currency: z.string().length(3),
    payment_terms_days: z.number(),
    rate_card: z.array(RateCardEntrySchema),
    allowed_charges: z.array(AllowedChargeSchema),
  }),
  employees: z.array(EmployeeSchema),
});
export type VendorProfile = z.infer<typeof VendorProfileSchema>;

/* -------------------------------- Timecards --------------------------------- */

export const TimecardSchema = z.object({
  employee_id: z.string(),
  week_ending: z.string(), // YYYY-MM-DD
  approved_hours: z.number(),
  approved_by: z.string(),
  status: z.enum(["approved", "pending", "rejected"]),
});
export type Timecard = z.infer<typeof TimecardSchema>;
export const TimecardsFileSchema = z.array(TimecardSchema);

/* ------------------------------- Corrections -------------------------------- */

export const CorrectionSchema = z.object({
  correction_id: z.string(), // e.g. "C-001"
  invoice_id: z.string(), // a past invoice in data/invoices/past/
  check: CheckNameSchema, // which check would have caught it
  line_index: z.number().int().nullable(), // 0-based index into line_items; null = invoice-level
  description: z.string(), // what the reviewer found, in their words
  expected: z.string(),
  actual: z.string(),
  resolution: z.string(), // e.g. "Vendor issued credit memo CM-221 for $340.00"
  corrected_by: z.string(),
  corrected_at: z.string(), // YYYY-MM-DD
});
export type Correction = z.infer<typeof CorrectionSchema>;
export const CorrectionsFileSchema = z.array(CorrectionSchema);

/* -------------------------------- Answer key -------------------------------- */
/** data/answer_key.json — NEVER passed to the review call or the agent. Tests/demo only. */
export const AnswerKeySchema = z.object({
  invoice_id: z.string(),
  planted_errors: z
    .array(
      z.object({
        check: CheckNameSchema,
        line_index: z.number().int().nullable(),
        description: z.string(),
        expected: z.string(),
        actual: z.string(),
      }),
    )
    .length(3),
  expected_recommendation: RecommendationSchema,
});
export type AnswerKey = z.infer<typeof AnswerKeySchema>;

/* -------------------------------- Calc output ------------------------------- */

export const CalcFindingSchema = z.object({
  line_index: z.number().int().nullable(),
  expected: z.string(),
  actual: z.string(),
  message: z.string(),
  /** Evidence pointer for this finding (contracts/evidence.ts), usually data/... */
  evidence: z.string(),
  /**
   * Overbilled dollars attributed to this finding, computed by calc (deterministic, 2 decimals, >= 0).
   * Definitions live in calc/credits.ts. Additive + optional: approved by the project owner in chat
   * 2026-11-11 (storyboard pre-render item 1, "code computes credits").
   */
  amount: z.number().optional(),
});
export type CalcFinding = z.infer<typeof CalcFindingSchema>;

export const CalcCheckOutputSchema = z.object({
  check: CheckNameSchema,
  result: z.enum(["pass", "fail", "unverified"]),
  findings: z.array(CalcFindingSchema), // empty when pass
  summary: z.string(),
});
export type CalcCheckOutput = z.infer<typeof CalcCheckOutputSchema>;

export const CalcReportSchema = z.object({
  invoice_id: z.string(),
  computed_at: z.string(),
  checks: z.array(CalcCheckOutputSchema),
  /**
   * Total credit to request = sum of the failing findings' `amount`s (calc/credits.ts). 0 when nothing fails.
   * Additive + optional: approved by the project owner in chat 2026-11-11 (storyboard pre-render item 1).
   */
  credit_total: z.number().optional(),
});
export type CalcReport = z.infer<typeof CalcReportSchema>;

/* --------------------------- Gathered evidence ------------------------------ */

export const EvidenceModeSchema = z.enum(["real", "scripted"]);

export const EvidenceItemSchema = z.object({
  /** fixture:/... pointer to the page the value was read from. */
  source: z.string(),
  kind: z.enum(["timecard_hours", "invoice_view", "rate", "note"]),
  employee_id: z.string().nullable(),
  week_ending: z.string().nullable(),
  /** e.g. approved hours as read off the page */
  value: z.union([z.number(), z.string()]).nullable(),
  /** Repo-relative screenshot path under runs/<invoice_id>/screenshots/, if captured. */
  screenshot: z.string().nullable(),
  captured_at: z.string(),
  mode: EvidenceModeSchema,
});
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

export const EvidenceBundleSchema = z.object({
  invoice_id: z.string(),
  mode: EvidenceModeSchema,
  items: z.array(EvidenceItemSchema),
  /** Timecards reconstructed from the portal pages, fed to calc's hours check. */
  timecards: TimecardsFileSchema,
});
export type EvidenceBundle = z.infer<typeof EvidenceBundleSchema>;

/* ---------------------------------- Trace ----------------------------------- */

export const TraceModeSchema = z.enum(["real", "scripted", "mock", "deterministic"]);
export type TraceMode = z.infer<typeof TraceModeSchema>;

/** One line of agent/trace.jsonl (and learn/trace.jsonl). */
export const TraceEventSchema = z.object({
  ts: z.string(),
  run_id: z.string(),
  stage: z.enum(["record", "learn", "calc", "evidence", "synthesis", "decision", "attach", "demo"]),
  /** real = Claude decided/produced it; scripted = fixed Playwright steps; mock/deterministic = no LLM. */
  mode: TraceModeSchema,
  step: z.string(),
  detail: z.record(z.string(), z.unknown()).default({}),
});
export type TraceEvent = z.infer<typeof TraceEventSchema>;

/* ---------------------------------- Evals ----------------------------------- */

export const EvalCaseSchema = z.object({
  eval_id: z.string(), // e.g. "EV-C-001"
  source_correction_id: z.string(),
  invoice_path: z.string(), // repo-relative, e.g. data/invoices/past/BSP-1004.json
  expect: z.object({
    check: CheckNameSchema,
    result: z.literal("fail"),
    line_index: z.number().int().nullable(),
  }),
  note: z.string(),
});
export type EvalCase = z.infer<typeof EvalCaseSchema>;
export const EvalsFileSchema = z.array(EvalCaseSchema);

/* --------------------------------- Decisions -------------------------------- */

/** One line of receipts/decisions.jsonl, written ONLY by the decision API route. */
export const DecisionRecordSchema = z.object({
  invoice_id: z.string(),
  receipt_id: z.string(),
  bill_id: z.string(),
  decision: z.enum(["approve", "dispute"]),
  decided_by: z.string().min(1),
  decided_at: z.string(),
  note: z.string().optional(),
});
export type DecisionRecord = z.infer<typeof DecisionRecordSchema>;

/* -------------------------------- Learn meta -------------------------------- */

/**
 * Where the recording LEARN consumed came from (additive, optional — added after Phase 0 per the
 * "additive only" rule above). `operator` says who performed the demonstrated session; `capture` says
 * what produced the Recording JSON. Keep these honest: a Playwright-driven session is "scripted_playwright"
 * even when the real extension captured it.
 */
export const RecordingProvenanceSchema = z.object({
  session_id: z.string(),
  capture: z.enum(["mv3_extension", "hand_authored_fixture"]),
  operator: z.enum(["human", "scripted_playwright", "synthetic"]),
  role: z.enum(["primary", "fallback_fixture"]),
  note: z.string(),
});
export type RecordingProvenance = z.infer<typeof RecordingProvenanceSchema>;

export const LearnMetaSchema = z.object({
  mode: z.enum(["real", "deterministic"]),
  model: z.string().nullable(),
  recording_path: z.string(),
  generated_at: z.string(),
  provenance: RecordingProvenanceSchema.optional(),
});
export type LearnMeta = z.infer<typeof LearnMetaSchema>;

/* ------------------------------ ID conventions ------------------------------ */

export const receiptIdFor = (invoiceId: string) => `rcpt_${invoiceId}`;
export const billIdFor = (invoiceId: string) => `bill_${invoiceId}`;
export const invoiceIdFromBillId = (billId: string) => billId.replace(/^bill_/, "");

