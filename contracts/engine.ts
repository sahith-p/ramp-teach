/**
 * FROZEN ENGINE INTERFACES (Phase 0).
 *
 * Ramp Teach is a small reusable core: RECORD -> LEARN -> BROWSER ACTIONS -> EVIDENCE -> APPROVAL.
 * A workflow plugs into it by implementing `WorkflowDefinition`. Invoice review
 * (workflows/invoice-review/) is the first and only workflow tonight.
 *
 * The AI provider sits behind `AIProvider`, selected in config/engine.ts. Only the Anthropic
 * adapter exists (agent/providers/anthropic.ts). Do not build other providers.
 *
 * Generic code (agent/, learn/) must not import from workflows/ or calc/; only the CLIs and
 * workflows/registry.ts wire workflows in.
 */
import type { ZodType } from "zod";
import type {
  CalcReport,
  EvidenceBundle,
  Receipt,
  Recording,
  WorkflowSpec,
  TraceMode,
} from "./index";

/* ------------------------------ Browser driver ------------------------------ */

export interface BrowserTab {
  tab_id: string;
  title: string;
  url: string;
  active: boolean;
}

/** Element reference returned by readPage/find, valid for the tab that produced it. */
export interface PageRef {
  ref: string; // "ref_3"
  role: string;
  name: string;
}

export type BrowserTarget = { type: "coordinate"; x: number; y: number } | { type: "ref"; ref: string };

/**
 * Provider-neutral browser driver over a local Playwright Chromium.
 * Implementations MUST refuse any navigation/request whose host is not localhost/127.0.0.1.
 */
export interface BrowserDriver {
  navigate(url: string | "back" | "forward" | "reload", tabId?: string): Promise<string>;
  screenshot(tabId?: string): Promise<{ png: Buffer; savedPath: string | null }>;
  click(target: BrowserTarget, tabId?: string): Promise<string>;
  type(text: string, tabId?: string): Promise<string>;
  key(keys: string, tabId?: string): Promise<string>;
  formInput(ref: string, value: string | number | boolean, tabId?: string): Promise<string>;
  scroll(target: BrowserTarget, direction: "up" | "down" | "left" | "right", amount?: number, tabId?: string): Promise<string>;
  /** Accessibility-ish outline of the page with refs. */
  readPage(opts?: { filter?: "interactive" | "all"; depth?: number; ref?: string; tabId?: string }): Promise<string>;
  find(query: string, tabId?: string): Promise<PageRef[]>;
  getPageText(tabId?: string): Promise<string>;
  wait(seconds: number): Promise<void>;
  tabs(): Promise<BrowserTab[]>;
  currentUrl(tabId?: string): Promise<string>;
  close(): Promise<void>;
}

/* --------------------------------- Provider --------------------------------- */

export interface StructuredRequest<T> {
  schema: ZodType<T>;
  system: string;
  prompt: string;
  maxTokens?: number;
}

export interface StructuredResult<T> {
  output: T;
  model: string;
  usage?: Record<string, unknown>;
}

/** One fact the agent extracted from a page, via its `record_evidence` tool. */
export interface AgentEvidenceFact {
  /** fixture:/... pointer of the page the fact was read on (from the browser's current URL). */
  source: string;
  key: string; // e.g. "approved_hours"
  value: string | number;
  subject_ref: Record<string, string>; // e.g. { employee_id: "E-103", week_ending: "2026-10-18" }
  note: string;
}

export interface BrowserTaskRequest {
  system: string;
  task: string;
  startUrl: string;
  /** e.g. ["http://localhost:3000"]; anything else is refused. */
  allowedOrigins: string[];
  maxTurns: number;
  driver: BrowserDriver;
  /** Called for every model action and result, for tracing. */
  onStep: (step: { kind: "action" | "result" | "evidence" | "text"; detail: Record<string, unknown> }) => void;
}

export interface BrowserTaskResult {
  facts: AgentEvidenceFact[];
  finalText: string;
  turns: number;
  model: string;
}

/** Thin provider boundary. Exactly one implementation tonight: Anthropic. */
export interface AIProvider {
  readonly id: string; // "anthropic"
  readonly model: string;
  generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>>;
  /** Model-driven browser loop: the model picks every action from page structure/screenshots. */
  runBrowserTask(req: BrowserTaskRequest): Promise<BrowserTaskResult>;
}

/* --------------------------------- Workflow --------------------------------- */

export interface SubjectSummary {
  subject_id: string; // receipts key this as invoice_id (frozen Receipt shape)
  vendor: string;
  amount: number;
  currency: string;
  label: string;
}

export interface EvidenceTask {
  task_id: string;
  /** Natural-language instruction for the browser agent. */
  instruction: string;
  /** Start page, a path on the local fixture app, e.g. "/portal/login". */
  start_path: string;
  /** What fact keys are expected back via record_evidence, e.g. ["approved_hours"]. */
  expected_keys: string[];
  subject_ref: Record<string, string>;
}

export interface RunContext {
  baseUrl: string;
  runId: string;
  runDir: string; // runs/<subject_id>/
  trace: (step: string, mode: TraceMode, stage: "calc" | "evidence" | "synthesis" | "attach", detail?: Record<string, unknown>) => void;
}

export interface WorkflowDefinition<Subject = unknown> {
  id: string; // "invoice-review"
  title: string;
  loadSubject(subjectId: string): Subject;
  summarize(subject: Subject): SubjectSummary;
  /** LEARN input: which recording + how to describe it to the distiller. */
  learn: {
    recordingPath: string; // e.g. "data/recording.sample.json"
    specPath: string; // e.g. "rules/workflow_spec.json"
    distillHints: string; // domain hints for the distiller prompt
    /** Deterministic (no-LLM) distillation of the same fields. */
    deterministicDistill(recording: Recording): WorkflowSpec;
  };
  /** Pure checks; `evidence` is null before browser evidence exists. No LLM. */
  deterministicChecks(subject: Subject, evidence: EvidenceBundle | null): CalcReport;
  /** Browser evidence to gather, derived from subject + learned spec. */
  evidencePlan(subject: Subject, spec: WorkflowSpec): EvidenceTask[];
  /** Turn agent-recorded facts into an EvidenceBundle (mode "real"). */
  collectAgentEvidence(subject: Subject, facts: AgentEvidenceFact[], ctx: RunContext): EvidenceBundle;
  /** Fixed Playwright steps gathering the same evidence (mode "scripted", labeled, never AI). */
  scriptedEvidence(subject: Subject, tasks: EvidenceTask[], driver: BrowserDriver, ctx: RunContext): Promise<EvidenceBundle>;
  /** Domain framing for the receipt synthesis call. */
  synthesisInstructions: string;
  /** Deterministic receipt (mode "mock") from the same inputs. */
  mockReceipt(subject: Subject, calc: CalcReport, evidence: EvidenceBundle | null, spec: WorkflowSpec): Receipt;
  /** Approval target, e.g. the fixture bill this receipt attaches to after a human decides. */
  approvalTargetId(subjectId: string): string;
}
