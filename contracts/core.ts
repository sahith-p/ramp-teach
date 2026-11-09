/**
 * FROZEN CORE CONTRACTS (Phase 0).
 * Changing any schema in this file requires a human DECISION line in board/humans.md.
 * These five shapes come straight from the project spec.
 */
import { z } from "zod";

/* ---------------------------------- Invoice --------------------------------- */

export const LineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number(),
  unit_rate: z.number(),
  amount: z.number(),
});
export type LineItem = z.infer<typeof LineItemSchema>;

export const InvoiceSchema = z.object({
  vendor: z.string().min(1),
  invoice_id: z.string().min(1),
  issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
  line_items: z.array(LineItemSchema).min(1),
  total: z.number(),
  currency: z.string().length(3),
});
export type Invoice = z.infer<typeof InvoiceSchema>;

/* ---------------------------------- Receipt --------------------------------- */

export const ModeSchema = z.enum(["real", "scripted", "mock"]);
export type Mode = z.infer<typeof ModeSchema>;

export const CheckResultSchema = z.enum(["pass", "fail", "unverified"]);
export type CheckResult = z.infer<typeof CheckResultSchema>;

export const RecommendationSchema = z.enum(["approve", "dispute", "review"]);
export type Recommendation = z.infer<typeof RecommendationSchema>;

export const HumanDecisionSchema = z.enum(["approve", "dispute"]);
export type HumanDecision = z.infer<typeof HumanDecisionSchema>;

export const ReceiptCheckSchema = z.object({
  /** One of CHECK_NAMES (contracts/supporting.ts). */
  name: z.string().min(1),
  expected: z.string(),
  actual: z.string(),
  result: CheckResultSchema,
  /** An evidence pointer — grammar in contracts/evidence.ts. Must be non-empty. */
  evidence: z.string(),
});
export type ReceiptCheck = z.infer<typeof ReceiptCheckSchema>;

export const ReceiptSchema = z.object({
  invoice_id: z.string().min(1),
  vendor: z.string().min(1),
  checks: z.array(ReceiptCheckSchema),
  recommendation: RecommendationSchema,
  reasons: z.array(z.string()),
  /** How the receipt itself was synthesized: real Claude call, scripted, or deterministic mock. */
  mode: ModeSchema,
  human_decision: HumanDecisionSchema.nullable(),
  decided_by: z.string().nullable(),
  decided_at: z.string().nullable(),
});
export type Receipt = z.infer<typeof ReceiptSchema>;

/* --------------------------------- Recording -------------------------------- */

/** A recorded step. `detail` is an object; known fields listed, extra fields allowed. */
export const RecordingStepDetailSchema = z
  .object({
    /** dom: "click" | "input" | "change" | "navigate" | "submit"; narration: "narration" */
    event: z.string().optional(),
    url: z.string().optional(),
    title: z.string().optional(),
    selector: z.string().optional(),
    /** Visible text of the clicked element, or the narration text. */
    text: z.string().optional(),
    /** Input value (passwords are never recorded; recorder writes "[redacted]"). */
    value: z.string().optional(),
  })
  .passthrough();

export const RecordingStepSchema = z.object({
  ts: z.string(), // ISO timestamp
  kind: z.enum(["dom", "narration"]),
  detail: RecordingStepDetailSchema,
});
export type RecordingStep = z.infer<typeof RecordingStepSchema>;

export const RecordingSchema = z.object({
  session_id: z.string().min(1),
  started_at: z.string(),
  steps: z.array(RecordingStepSchema),
  transcript: z.array(z.string()),
});
export type Recording = z.infer<typeof RecordingSchema>;

/* ------------------------------- WorkflowSpec ------------------------------- */

export const ProofSourceSchema = z.object({
  app: z.string().min(1),
  location: z.string().min(1),
  fields: z.array(z.string()),
});

export const WorkflowSpecSchema = z.object({
  vendor: z.string().min(1),
  proof_sources: z.array(ProofSourceSchema),
  rules: z.array(z.string()),
  open_questions: z.array(z.string()),
});
export type WorkflowSpec = z.infer<typeof WorkflowSpecSchema>;

/* ----------------------------------- Bill ----------------------------------- */

export const BillStatusSchema = z.enum(["pending", "receipt_attached", "approved", "disputed"]);
export type BillStatus = z.infer<typeof BillStatusSchema>;

export const BillSchema = z.object({
  bill_id: z.string().min(1),
  vendor: z.string().min(1),
  amount: z.number(),
  status: BillStatusSchema,
  receipt_id: z.string().nullable(),
});
export type Bill = z.infer<typeof BillSchema>;
