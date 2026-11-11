import { beforeAll, describe, expect, it, vi } from "vitest";
import { SkillEvalRunSchema, type LearnSkillFn, type SkillEvalRun } from "@/contracts";
import { loadCaseRecording, loadEvalCaseFiles } from "./cases";
import { FakeTransport, fakeMeta, nullLearner, oracleLearner, oracleSkill } from "./fakes";
import { ClaudeJudge, KeywordJudge, type MatchJudgeOutput } from "./judge";
import { loadReplayWorld, type ReplayWorld } from "./replay";
import { goldItems } from "./rules";
import { minMode, runIdFor, runSkillEvals, type RunDeps } from "./runner";

const cases = loadEvalCaseFiles();
let world: ReplayWorld;
beforeAll(async () => {
  world = await loadReplayWorld();
});

function deps(over: Partial<RunDeps> = {}) {
  const written: SkillEvalRun[] = [];
  const applied: unknown[][] = [];
  const d: RunDeps = {
    learner: oracleLearner(cases),
    learnerLive: false,
    judge: new KeywordJudge(),
    transport: null,
    cases,
    loadRecording: (c) => loadCaseRecording(c),
    replayWorld: world,
    tmpDir: "runtime/evals-tmp/test",
    writeRun: (run) => {
      written.push(run);
      return `evals/runs/${run.id}.json`;
    },
    applyGate: async (...args) => {
      applied.push(args);
      return { status: args[2] ? "active" : "blocked", activated: !!args[2], via: "local helper" };
    },
    now: () => new Date("2026-11-11T12:00:00.000Z"),
    ...over,
  };
  return { d, written, applied };
}

/** A real-mode judge whose transport answers like a perfect judge (matches by gold text). */
function perfectRealJudge(batch = false) {
  const t = new FakeTransport((req) => {
    if (req.kind === "consistency") return { ok: true, json: { pairs: [], unmatched_a: [], unmatched_b: [], summary: "" }, meta: fakeMeta({ batch }) };
    const c = cases.find((x) => req.custom_id === `match_${x.id}`.replace(/[^a-zA-Z0-9_-]/g, "_"))!;
    const gold = goldItems(c);
    const out: MatchJudgeOutput = {
      learned: gold.map((_, i) => ({ rule_id: `r${i + 1}`, verdict: "match", gold_indices: [i], checks: i < c.gold_checks.length ? [c.gold_checks[i]] : [], reason: "same" })),
      gold: gold.map((_, i) => ({ gold_index: i, covered: true, reason: "" })),
    };
    return { ok: true, json: out, meta: fakeMeta({ batch }) };
  });
  return { t, judge: new ClaudeJudge(t, "claude-opus-5-5", { batch }) };
}

describe("runSkillEvals", () => {
  it("oracle learner + keyword judge: every case scores 1, gate passes, labeled deterministic, gate not auto-applied", async () => {
    const { d, written, applied } = deps();
    const out = await runSkillEvals({ skillId: "halcyon-invoice-review", version: 3 }, d);
    expect(out.status).toBe("done");
    if (out.status !== "done") return;
    expect(out.errors).toEqual([]);
    expect(out.run.results).toHaveLength(8);
    for (const r of out.run.results) {
      expect(r.metrics, r.case_id).toMatchObject({ rule_recall: 1, rule_precision: 1, citations_valid: 1, coverage: 1, replay_agreement: 1 });
      expect(r.mode).toBe("mock"); // fake learner's skills are mock
      expect(r.notes.rule_recall.length).toBeGreaterThan(0);
    }
    expect(out.run.results.find((r) => r.case_id === "baseline")!.metrics.consistency).toBe(1);
    expect(out.run.results.find((r) => r.case_id === "reordered")!.metrics.consistency).toBeNull();
    expect(out.run.results.find((r) => r.case_id === "stt-noise")!.metrics.wer!).toBeGreaterThan(0);
    expect(out.run.gate).toEqual({ passed: true, failures: [] });
    expect(out.run.id).toBe("eval_halcyon-invoice-review_v3_20261111T120000Z");
    expect(out.run.cost_usd).toBeNull();
    expect(SkillEvalRunSchema.parse(written[0])).toBeTruthy();
    expect(applied).toEqual([]);
    expect(out.gateNote).toMatch(/not applied: this run is mock/);
  });

  it("null learner: the gate fails with every gated metric named", async () => {
    const { d } = deps({ learner: nullLearner });
    const out = await runSkillEvals({ skillId: "s", version: 1, applyGate: "never" }, d);
    if (out.status !== "done") throw new Error("expected done");
    expect(out.run.summary.rule_recall).toBe(0);
    expect(out.run.gate.passed).toBe(false);
    expect(out.run.gate.failures.map((f) => f.split(" ")[0])).toEqual(
      expect.arrayContaining(["rule_recall", "rule_precision", "citations_valid", "coverage", "replay_agreement"]),
    );
  });

  it("a learner crash is a recorded case error that fails the gate, never a zero score", async () => {
    const flaky: LearnSkillFn = async (rec, opts) => {
      if (rec.session_id === "rec_eval_filler") throw new Error("model overloaded");
      return oracleLearner(cases)(rec, opts);
    };
    const { d } = deps({ learner: flaky });
    const out = await runSkillEvals({ skillId: "s", version: 1 }, d);
    if (out.status !== "done") throw new Error("expected done");
    expect(out.run.results.map((r) => r.case_id)).not.toContain("filler");
    expect(out.errors).toEqual([{ case_id: "filler", variant: "filler-talk", stage: "learn", error: "model overloaded" }]);
    expect(out.run.summary.rule_recall).toBe(1);
    expect(out.run.gate.passed).toBe(false);
    expect(out.run.gate.failures).toContain("case filler not graded (learn): model overloaded");
  });

  it("passes persist:false and offline to the learner, one output folder per case", async () => {
    const spy = vi.fn(oracleLearner(cases));
    const { d } = deps({ learner: spy });
    await runSkillEvals({ skillId: "s", version: 1, caseIds: ["baseline"] }, d);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toEqual({ persist: false, offline: true, outDir: "runtime/evals-tmp/test/baseline" });
  });

  it("--sample keeps the consistency pair together", async () => {
    const { d } = deps();
    const out = await runSkillEvals({ skillId: "s", version: 1, sample: 1 }, d);
    if (out.status !== "done") throw new Error("expected done");
    expect(out.run.results.map((r) => r.case_id).sort()).toEqual(["baseline", "paraphrase"]);
  });

  it("an invented rule lowers precision and is explained in the notes", async () => {
    const inventive: LearnSkillFn = async (rec) => {
      const c = cases.find((x) => x.id === "step-skipped")!;
      const s = oracleSkill(c, rec);
      s.rules.push({ ...s.rules[0], id: "r99", text: "The invoice total must equal the sum of the line amounts." });
      return s;
    };
    const { d } = deps({ learner: inventive });
    const out = await runSkillEvals({ skillId: "s", version: 1, caseIds: ["step-skipped"] }, d);
    if (out.status !== "done") throw new Error("expected done");
    const r = out.run.results[0];
    expect(r.metrics.rule_precision).toBeCloseTo(5 / 6);
    expect(r.metrics.replay_agreement).toBeCloseTo(9 / 10); // disputes HSG-1005, which this reviewer would approve
    expect(r.notes.rule_precision.some((n) => n.startsWith("INVENTED r99"))).toBe(true);
    expect(r.notes.replay_agreement.some((n) => n.startsWith("DISAGREE HSG-1005"))).toBe(true);
  });
});

describe("cost-estimate guard", () => {
  it("a paid run without --yes prints the estimate and stops before any learner or judge call", async () => {
    const learner = vi.fn(oracleLearner(cases));
    const { t, judge } = perfectRealJudge();
    const lines: string[] = [];
    const { d, written } = deps({ learner, learnerLive: true, judge, transport: t, log: (s) => lines.push(s) });
    const out = await runSkillEvals({ skillId: "s", version: 1 }, d);
    expect(out.status).toBe("needs_confirmation");
    expect(learner).not.toHaveBeenCalled();
    expect(t.calls).toHaveLength(0);
    expect(t.batches).toHaveLength(0);
    expect(t.counted.length).toBe(8 + 9); // 8 recordings (learner) + 8 match + 1 consistency (judge)
    expect(written).toEqual([]);
    expect(lines.join("\n")).toMatch(/Cost estimate[\s\S]*= ~\$\d+\.\d\d/);
  });

  it("refuses a paid run with no transport to estimate with", async () => {
    const { judge } = perfectRealJudge();
    const { d } = deps({ judge, transport: null });
    await expect(runSkillEvals({ skillId: "s", version: 1 }, d)).rejects.toThrow(/cost estimate/);
  });

  it("with --yes runs, records cost from usage, and (real mode) applies the gate", async () => {
    const realOracle: LearnSkillFn = async (rec, o) => ({ ...(await oracleLearner(cases)(rec, o)), mode: "real" });
    const { t, judge } = perfectRealJudge(true);
    const { d, applied } = deps({ learner: realOracle, learnerLive: true, judge, transport: t });
    const out = await runSkillEvals({ skillId: "s", version: 4, yes: true, batch: true }, d);
    if (out.status !== "done") throw new Error("expected done");
    expect(t.batches).toHaveLength(1);
    expect(t.batches[0]).toHaveLength(9);
    expect(out.run.mode).toBe("real");
    expect(out.run.gate.passed).toBe(true);
    // 9 batch judge calls x (1000 in x $4 + 500 out x $20) / 1e6 x 0.5
    expect(out.run.cost_usd).toBeCloseTo((9 * (1000 * 4 + 500 * 20)) / 1e6 / 2, 4);
    expect(applied).toEqual([["s", 4, true, out.run.id]]);
    expect(out.gateNote).toMatch(/set to active and made active/);
  });

  it("a failing real run blocks the version", async () => {
    const realNull: LearnSkillFn = async (rec, o) => ({ ...(await nullLearner(rec, o)), mode: "real" });
    const t = new FakeTransport(() => ({ ok: true, json: { learned: [], gold: [] }, meta: fakeMeta() }));
    const { d, applied } = deps({ learner: realNull, learnerLive: true, judge: new ClaudeJudge(t), transport: t });
    const out = await runSkillEvals({ skillId: "s", version: 2, yes: true, caseIds: ["baseline"] }, d);
    if (out.status !== "done") throw new Error("expected done");
    expect(out.run.gate.passed).toBe(false);
    expect(applied).toEqual([["s", 2, false, out.run.id]]);
  });

  it("a judge failure for one case is an error, not a score", async () => {
    const t = new FakeTransport(() => ({ ok: false, error: "judge refused (cyber)", meta: fakeMeta() }));
    const realOracle: LearnSkillFn = async (rec, o) => ({ ...(await oracleLearner(cases)(rec, o)), mode: "real" });
    const { d } = deps({ learner: realOracle, learnerLive: true, judge: new ClaudeJudge(t), transport: t });
    const out = await runSkillEvals({ skillId: "s", version: 1, yes: true, caseIds: ["reordered"] }, d);
    if (out.status !== "done") throw new Error("expected done");
    expect(out.run.results).toEqual([]);
    expect(out.errors[0]).toMatchObject({ case_id: "reordered", stage: "judge", error: "judge refused (cyber)" });
    expect(out.run.gate.passed).toBe(false);
  });
});

describe("helpers", () => {
  it("minMode picks the weakest label", () => {
    expect(minMode("real", "deterministic")).toBe("deterministic");
    expect(minMode("real", "mock", "scripted")).toBe("mock");
    expect(minMode("real")).toBe("real");
  });
  it("run ids follow the contract format", () => {
    expect(runIdFor("halcyon-invoice-review", 2, new Date("2026-01-02T03:04:05.678Z"))).toBe("eval_halcyon-invoice-review_v2_20260102T030405Z");
  });
});
