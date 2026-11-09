import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ReceiptSchema,
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
