import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EvidenceCheckReportSchema,
  ReceiptSchema,
  SkillVersionSchema,
  TraceEventSchema,
  type AIProvider,
  type BrowserTaskRequest,
  type CalcReport,
  type EvidenceBundle,
  type Receipt,
  type StructuredRequest,
  type WorkflowDefinition,
} from "@/contracts";
import { runWorkflow } from "./engine";
import { FakeDriver } from "@/agent/test-fixtures/fake-driver";
import type { BrowserLoopRequest, LoopStep } from "./providers/browser-loop";
import { readSpansFile, SpanRecorder } from "./spans";

/* A tiny in-memory workflow: proves the engine is generic (no invoice/calc knowledge). */
type Subj = { id: string; billed: number };
const ORIGIN = "http://localhost:3999";

function calcFor(s: Subj, ev: EvidenceBundle | null): CalcReport {
  const tcs = ev?.timecards ?? null;
  const hours =
    tcs === null || tcs.length < 2
      ? { check: "hours_match_timecards" as const, result: "unverified" as const, findings: [], summary: "no evidence" }
      : tcs.every((t) => s.billed <= t.approved_hours)
        ? { check: "hours_match_timecards" as const, result: "pass" as const, findings: [], summary: "ok" }
        : {
            check: "hours_match_timecards" as const,
            result: "fail" as const,
            findings: [{ line_index: 0, expected: "≤ approved", actual: `${s.billed} h`, message: "too many hours", evidence: "fixture:/t/B" }],
            summary: "hours over",
          };
  return {
    invoice_id: s.id,
    computed_at: new Date().toISOString(),
    checks: [{ check: "line_amounts_correct", result: "pass", findings: [], summary: "ok" }, hours],
  };
}

const fakeWorkflow: WorkflowDefinition<Subj> = {
  id: "fake",
  title: "Fake",
  loadSubject: (id) => ({ id, billed: 40 }),
  summarize: (s) => ({ subject_id: s.id, vendor: "Fake Vendor", amount: 1, currency: "USD", label: `fake ${s.id}` }),
  learn: {
    recordingPath: "nope/recording.json",
    specPath: "nope/spec.json",
    distillHints: "",
    deterministicDistill: () => {
      throw new Error("not available");
    },
  },
  deterministicChecks: calcFor,
  evidencePlan: () =>
    ["A", "B"].map((k) => ({ task_id: `t:${k}`, instruction: `read ${k}`, start_path: "/login", expected_keys: ["approved_hours"], subject_ref: { employee_id: k } })),
  collectAgentEvidence: (s, facts) => {
    const ok = facts.filter((f) => f.key === "approved_hours" && f.source === `fixture:/t/${f.subject_ref.employee_id}`);
    return {
      invoice_id: s.id,
      mode: "real",
      items: ok.map((f) => ({ source: f.source, kind: "timecard_hours" as const, employee_id: f.subject_ref.employee_id, week_ending: null, value: Number(f.value), screenshot: null, captured_at: "t", mode: "real" as const })),
      timecards: ok.map((f) => ({ employee_id: f.subject_ref.employee_id, week_ending: "w", approved_hours: Number(f.value), approved_by: "x", status: "approved" as const })),
    };
  },
  scriptedEvidence: async (s, tasks, driver, ctx) => {
    const items = [];
    const timecards = [];
    for (const t of tasks) {
      await driver.navigate(`${ctx.baseUrl}/t/${t.subject_ref.employee_id}`);
      items.push({ source: `fixture:/t/${t.subject_ref.employee_id}`, kind: "timecard_hours" as const, employee_id: t.subject_ref.employee_id, week_ending: null, value: 38, screenshot: null, captured_at: "t", mode: "scripted" as const });
      timecards.push({ employee_id: t.subject_ref.employee_id, week_ending: "w", approved_hours: 38, approved_by: "x", status: "approved" as const });
    }
    return { invoice_id: s.id, mode: "scripted", items, timecards };
  },
  synthesisInstructions: "fake instructions",
  mockReceipt: (s, calc) => ({
    invoice_id: s.id,
    vendor: "Fake Vendor",
    checks: calc.checks.map((c) => ({ name: c.check, expected: "", actual: c.summary, result: c.result, evidence: c.findings[0]?.evidence ?? `calc:${c.check}` })),
    recommendation: calc.checks.some((c) => c.result === "fail") ? "dispute" : calc.checks.some((c) => c.result === "unverified") ? "review" : "approve",
    reasons: ["mock"],
    mode: "mock",
    human_decision: null,
    decided_by: null,
    decided_at: null,
  }),
  approvalTargetId: (id) => `bill_${id}`,
};

/** Fake provider: the browser loop only records task A; synthesis contradicts calc. */
class FakeProvider implements AIProvider {
  readonly id = "fake";
  readonly model = "fake-model";
  browserCalls: BrowserTaskRequest[] = [];
  synthCalls = 0;
  constructor(private synth: (req: StructuredRequest<unknown>) => unknown) {}
  async generateStructured<T>(req: StructuredRequest<T>) {
    this.synthCalls++;
    return { output: req.schema.parse(this.synth(req as StructuredRequest<unknown>)), model: this.model, usage: { input_tokens: 1 } };
  }
  async runBrowserTask(req: BrowserTaskRequest) {
    this.browserCalls.push(req);
    await req.driver.navigate(`${ORIGIN}/t/A`);
    req.onStep({ kind: "evidence", detail: { key: "approved_hours" } });
    return {
      facts: [{ source: "fixture:/t/A", key: "approved_hours", value: 40, subject_ref: { employee_id: "A" }, note: "" }],
      finalText: "Recorded A; could not find B.",
      turns: 3,
      model: this.model,
      usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      stopReason: "end_turn",
    };
  }
}

let tmp: string;
let persisted: Receipt[];
const opts = (provider: AIProvider | null) => ({
  baseUrl: ORIGIN,
  provider,
  driverFactory: () => new FakeDriver(ORIGIN),
  repoRoot: tmp,
  runsRoot: path.join(tmp, "runs"),
  traceFile: path.join(tmp, "trace.jsonl"),
  persistReceipt: (r: Receipt) => {
    persisted.push(ReceiptSchema.parse(r));
    return path.join(tmp, "receipts", `${r.invoice_id}.json`);
  },
  cacheSynthesis: false,
});
const traceLines = () =>
  fs.readFileSync(path.join(tmp, "trace.jsonl"), "utf8").trim().split("\n").map((l) => TraceEventSchema.parse(JSON.parse(l)));

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "engine-test-"));
  persisted = [];
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("runWorkflow (generic engine, fake workflow + provider + driver)", () => {
  it("real path: one browser run for all tasks, scripted fallback for the missing one, calc-authoritative synthesis", async () => {
    const provider = new FakeProvider(() => ({
      checks: [
        { name: "line_amounts_correct", expected: "", actual: "", result: "pass", evidence: "calc:line_amounts_correct" },
        // contradicts calc (B's scripted timecard says 38 h < 40 billed ⇒ fail)
        { name: "hours_match_timecards", expected: "", actual: "", result: "pass", evidence: "fixture:/t/B" },
      ],
      recommendation: "approve",
      reasons: ["looks fine"],
    }));
    const s = await runWorkflow(fakeWorkflow, "S-1", opts(provider));

    expect(provider.browserCalls).toHaveLength(1); // ONE combined browser task
    expect(provider.browserCalls[0].task).toContain("[t:A]");
    expect(provider.browserCalls[0].task).toContain("[t:B]");
    expect(provider.browserCalls[0].allowedOrigins).toEqual([ORIGIN]);
    expect(s.browser?.fallbackTasks).toEqual(["t:B"]);
    expect(s.modes.evidence).toBe("mixed");
    const ev = JSON.parse(fs.readFileSync(s.evidencePath!, "utf8")) as EvidenceBundle;
    expect(ev.items.map((i) => [i.employee_id, i.mode])).toEqual([["A", "real"], ["B", "scripted"]]);
    expect(ev.mode).toBe("scripted"); // bundle-level "real" only when every item is real

    expect(s.modes.synthesis).toBe("real");
    expect(s.receipt.mode).toBe("real");
    expect(s.receipt.checks.find((c) => c.name === "hours_match_timecards")?.result).toBe("fail");
    expect(s.receipt.recommendation).toBe("dispute");
    expect(s.receipt.reasons.join(" ")).toMatch(/calc is authoritative/);
    expect(persisted[0]).toMatchObject({ human_decision: null, decided_by: null, decided_at: null, mode: "real" });

    const calcJson = JSON.parse(fs.readFileSync(s.calcPath, "utf8")) as CalcReport;
    expect(calcJson.checks[1].result).toBe("fail");

    const tr = traceLines();
    expect(tr.some((e) => e.step === "browser.done" && e.mode === "real")).toBe(true);
    expect(tr.some((e) => e.step === "scripted.start" && e.mode === "scripted")).toBe(true);
    expect(tr.some((e) => e.step === "spec.minimal")).toBe(true);
    expect(tr.some((e) => e.step === "receipt.written" && e.mode === "real")).toBe(true);
  });

  it("offline: scripted evidence + mock receipt, labeled as such", async () => {
    const s = await runWorkflow(fakeWorkflow, "S-2", opts(null));
    expect(s.modes).toMatchObject({ calc: "deterministic", evidence: "scripted", synthesis: "mock" });
    expect(s.browser).toBeNull();
    expect(s.receipt.mode).toBe("mock");
    expect(s.receipt.recommendation).toBe("dispute");
    expect(traceLines().every((e) => e.mode !== "real")).toBe(true);
  });

  it("forces review when the synthesized receipt cites a pointer that does not resolve", async () => {
    const provider = new FakeProvider(() => ({
      checks: [
        { name: "line_amounts_correct", expected: "", actual: "", result: "pass", evidence: "data/invented.json#x" },
        { name: "hours_match_timecards", expected: "", actual: "", result: "fail", evidence: "fixture:/t/B" },
      ],
      recommendation: "dispute",
      reasons: [],
    }));
    const s = await runWorkflow(fakeWorkflow, "S-3", opts(provider));
    expect(s.receipt.recommendation).toBe("review");
    expect(s.notes.join(" ")).toMatch(/invented\.json does not exist/);
  });

  it("falls back to the mock receipt when the synthesis call fails", async () => {
    const provider = new FakeProvider(() => {
      throw new Error("boom");
    });
    const s = await runWorkflow(fakeWorkflow, "S-4", opts(provider));
    expect(s.modes.synthesis).toBe("mock");
    expect(s.receipt.mode).toBe("mock");
    expect(s.notes.join(" ")).toMatch(/synthesis call failed/);
  });

  it("refuses a non-local base URL before doing anything", async () => {
    await expect(runWorkflow(fakeWorkflow, "S-5", { ...opts(null), baseUrl: "https://example.com" })).rejects.toThrow(/not localhost/);
  });
});

/* ------------------------- observability (spans, live, evidence check, skill) ------------------------- */

const pageWith = (hours: number) => `Page: Timecard\n- generic "${hours}" [ref=ref_1] [data-field=approved_hours]`;

/** Fake provider that drives the loop hooks like the real browser loop does. */
class HookedProvider extends FakeProvider {
  override async runBrowserTask(req: BrowserTaskRequest) {
    const r = req as BrowserLoopRequest;
    const t0 = new Date().toISOString();
    (r.onStep as (s: LoopStep) => void)({ kind: "note", detail: { turn: 1, note: "Opening A's timecard." } });
    r.hooks?.onModelTurn?.({
      turn: 1,
      model: "claude-opus-5-5",
      request_id: "req_1",
      message_id: "msg_1",
      usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 500, cache_creation_input_tokens: 200 },
      stop_reason: "tool_use",
      notes: ["Opening A's timecard."],
      start: t0,
      end: new Date().toISOString(),
    });
    r.hooks?.onToolCall?.({
      turn: 1,
      step: 1,
      tool: "browser.navigate",
      input: { url: `${ORIGIN}/t/A` },
      result: { is_error: false, content: ["ok"] },
      is_error: false,
      url: `${ORIGIN}/t/A`,
      screenshot: "runs/S-9/screenshots/step-1.png",
      note: "Opening A's timecard.",
      start: t0,
      end: new Date().toISOString(),
    });
    return super.runBrowserTask(req);
  }
}

describe("runWorkflow observability", () => {
  const synth = () => ({
    checks: [
      { name: "line_amounts_correct", expected: "", actual: "", result: "pass", evidence: "calc:line_amounts_correct" },
      { name: "hours_match_timecards", expected: "", actual: "", result: "fail", evidence: "fixture:/t/B" },
    ],
    recommendation: "dispute",
    reasons: ["B over"],
  });
  const driverWithPages = () => {
    const d = new FakeDriver(ORIGIN);
    d.pages = { "/t/A": pageWith(40), "/t/B": pageWith(37) };
    return d;
  };

  it("writes spans (run → calc / browser → turn → tool / evidence check / synthesis), live status, and the evidence check", async () => {
    const provider = new HookedProvider(synth);
    const s = await runWorkflow(fakeWorkflow, "S-9", { ...opts(provider), driverFactory: driverWithPages, runId: "fake:S-9:TEST" });
    const spans = readSpansFile(path.join(tmp, "runs", "S-9", "spans.jsonl"));
    expect(new Set(spans.map((x) => x.trace_id))).toEqual(new Set(["fake:S-9:TEST"]));
    const by = (name: string) => spans.find((x) => x.name === name)!;
    const root = by("run S-9");
    expect(root.parent_id).toBeNull();
    for (const n of ["calc.initial", "browser", "evidence.scripted", "evidence.check", "calc.with_evidence", "synthesis"]) {
      expect(by(n).parent_id, n).toBe(root.span_id);
    }
    expect(by("evidence.check")).toMatchObject({ kind: "verify", mode: "deterministic" });
    const turn = by("turn 1");
    expect(turn).toMatchObject({ kind: "model", mode: "real", parent_id: by("browser").span_id });
    expect(turn.attrs).toMatchObject({ model: "claude-opus-5-5", request_id: "req_1", message_id: "msg_1", input_tokens: 1000, note: "Opening A's timecard." });
    expect(turn.attrs.cost_usd).toBeCloseTo((1000 * 4 + 100 * 20 + 500 * 0.2 + 200 * 5) / 1e6, 9);
    const tool = spans.find((x) => x.kind === "tool")!;
    expect(tool.parent_id).toBe(turn.span_id);
    expect(tool.attrs).toMatchObject({ tool: "browser.navigate", screenshot: "runs/S-9/screenshots/step-1.png", url: `${ORIGIN}/t/A`, note: "Opening A's timecard." });
    for (const x of spans) expect(typeof x.attrs.duration_ms).toBe("number");

    // Progress note reached the trace.
    expect(traceLines().some((e) => e.step === "browser.note" && e.detail.note === "Opening A's timecard.")).toBe(true);

    // Evidence check: A recorded 40 (page 40) → match; B scripted 38 (page 37) → mismatch.
    const report = EvidenceCheckReportSchema.parse(JSON.parse(fs.readFileSync(path.join(tmp, "runs", "S-9", "evidence-check.json"), "utf8")));
    expect(report.mode).toBe("deterministic");
    expect(report.checks.map((c) => [c.subject.employee_id, c.value, c.rechecked_value, c.status])).toEqual([
      ["A", "40", "40", "match"],
      ["B", "38", "37", "mismatch"],
    ]);
    expect(s.evidenceCheck).toMatchObject({ checks: 2, match: 1, mismatch: 1, unavailable: 0 });
    expect(s.notes.join(" ")).toMatch(/Evidence check: 1 recorded value/);

    // Live status exists and is marked finished (the fake driver has no screencast, so no frame).
    const live = JSON.parse(fs.readFileSync(path.join(tmp, "runs", "S-9", "live", "status.json"), "utf8"));
    expect(live).toMatchObject({ running: false, step: 1 });
  });

  it("a shared recorder keeps the caller's spans and parent; no reset by the engine", async () => {
    const file = path.join(tmp, "shared-spans.jsonl");
    const rec = new SpanRecorder({ invoiceId: "S-10", traceId: "run-x", file });
    rec.reset();
    rec.record({ name: "route", kind: "run", mode: "deterministic", parentId: "sp_root", start: new Date().toISOString(), end: new Date().toISOString() });
    await runWorkflow(fakeWorkflow, "S-10", { ...opts(null), spans: rec, spanParentId: "sp_root", runId: "run-x" });
    const spans = readSpansFile(file);
    expect(spans[0].name).toBe("route");
    expect(spans.some((x) => x.name.startsWith("run "))).toBe(false); // the caller owns the run span
    expect(spans.filter((x) => x.name !== "route").every((x) => x.parent_id === "sp_root")).toBe(true);
    expect(spans.find((x) => x.name === "synthesis")?.mode).toBe("mock");
    expect(spans.find((x) => x.name === "evidence.scripted")?.mode).toBe("scripted");
  });

  it("uses the router's skill version: its rules + portal map drive the browser prompt, and the trace names it", async () => {
    const skill = SkillVersionSchema.parse({
      skill_id: "fake-skill",
      version: 2,
      title: "Fake skill",
      created_at: "2026-11-11T00:00:00Z",
      mode: "real",
      recordings: ["r"],
      vendor: "Fake Vendor",
      rules: [{ id: "r1", text: "Billed hours must not exceed approved hours.", kind: "check", source: "said", citations: [] }],
      portal_map: [{ page: "/t/<employee_id>", fields: [{ name: "approved_hours", selector: "[data-field=approved_hours]" }] }],
      open_questions: ["Overtime?"],
      checks: [],
      stages: [],
      package_dir: "skills/fake-skill/v2",
      anthropic_skill: null,
      status: "active",
      eval_run_id: null,
    });
    const provider = new FakeProvider(synth);
    const s = await runWorkflow(fakeWorkflow, "S-11", { ...opts(provider), driverFactory: driverWithPages, skill });
    const task = provider.browserCalls[0].task;
    expect(task).toContain("Skill: Fake skill (fake-skill v2)");
    expect(task).toContain("[r1] Billed hours must not exceed approved hours.");
    expect(task).toContain("/t/<employee_id>: approved_hours ([data-field=approved_hours])");
    expect(s.modes.spec).toBe("skill fake-skill v2 (learned: real)");
    expect(s.skill).toEqual({ skill_id: "fake-skill", version: 2 });
    const used = traceLines().find((e) => e.step === "skill.used")!;
    expect(used.detail).toMatchObject({ skill_id: "fake-skill", version: 2 });
  });
});
