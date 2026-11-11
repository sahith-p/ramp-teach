import { describe, expect, it } from "vitest";
import { SkillRuleSchema, SpanSchema, UtteranceSchema, type SkillEvalCase } from "@/contracts";
import rulesJson from "../__samples__/rules.json";
import spansJson from "../__samples__/spans.json";
import uttsJson from "../__samples__/utterances.json";
import {
  casesCoveringRule,
  derivePeaks,
  diffRules,
  fmtCost,
  fmtDuration,
  layoutSpans,
  normalizePeaks,
  realTag,
  resample,
  ruleForFact,
  runTotals,
  spanStep,
  speechTag,
  tickStep,
} from "./logic";

const spans = spansJson.map((s) => SpanSchema.parse(s));
const v1 = rulesJson.v1.map((r) => SkillRuleSchema.parse(r));
const v3 = rulesJson.v3.map((r) => SkillRuleSchema.parse(r));
const utts = uttsJson.map((u) => UtteranceSchema.parse(u));

describe("tags show only for real output", () => {
  it("Claude only for real", () => {
    expect(realTag("real")).toBe("Claude");
    for (const m of ["scripted", "mock", "deterministic", null, undefined]) expect(realTag(m)).toBeNull();
  });
  it("speech provider only for a real transcript, never a provider name on non-real data", () => {
    expect(speechTag({ provider: "elevenlabs", model: "scribe_v2", mode: "real" })).toBe("ElevenLabs Scribe v2");
    expect(speechTag({ provider: "elevenlabs", model: "scribe_v2", mode: "mock" })).toBeNull();
    expect(speechTag({ provider: "simulated", model: null, mode: "scripted" })).toBeNull();
    expect(speechTag({ provider: "simulated", model: null, mode: "real" })).toBeNull();
  });
});

describe("rule diff", () => {
  it("finds added, removed and changed rules", () => {
    const d = diffRules(v1, v3);
    expect(d.same).toBe(3);
    expect(d.changed.map((c) => c.to.id)).toEqual(["r4"]);
    expect(d.added.map((r) => r.id).sort()).toEqual(["r3", "r6"]);
    expect(d.removed).toEqual([]);
    const back = diffRules(v3, v1);
    expect(back.removed.map((r) => r.id).sort()).toEqual(["r3", "r6"]);
  });
  it("identical versions have no changes", () => {
    const d = diffRules(v3, v3);
    expect(d.added.length + d.removed.length + d.changed.length).toBe(0);
  });
});

describe("lineage helpers", () => {
  it("maps a recorded fact to the check that cites its field", () => {
    expect(ruleForFact(v3, "approved_hours")?.id).toBe("r4");
    expect(ruleForFact(v3, "no_such_field")).toBeNull();
  });
  it("finds eval cases whose gold rules cover a rule", () => {
    const c = (id: string, rules: string[]): SkillEvalCase => ({ id, variant: id, recording_path: "", reference_transcript: null, gold: { rules, pages: [], fields: [], decision_rule: "" } });
    const cases = [c("base", ["Billed hours do not exceed approved timecard hours"]), c("other", ["Every rate matches the contract"])];
    expect(casesCoveringRule(v3.find((r) => r.id === "r4")!, cases)).toEqual(["base"]);
  });
});

describe("spans", () => {
  it("lays out depth-first with times from run start", () => {
    const { rows, total } = layoutSpans(spans);
    expect(rows[0].span.kind).toBe("run");
    expect(rows[0].depth).toBe(0);
    expect(rows.slice(1).every((r) => r.depth === 1)).toBe(true);
    expect(rows[0].start).toBe(0);
    expect(total).toBeGreaterThan(20_000);
    for (let i = 2; i < rows.length; i++) expect(rows[i].start).toBeGreaterThanOrEqual(rows[i - 1].start);
  });
  it("totals turns, tool calls, tokens and cost", () => {
    const t = runTotals(spans);
    expect(t.turns).toBe(spans.filter((s) => s.kind === "model").length);
    expect(t.tool_calls).toBe(spans.filter((s) => s.kind === "tool").length);
    expect(t.tokens).toBeGreaterThan(0);
    expect(t.cost_usd).toBeGreaterThan(0);
    expect(runTotals([])).toMatchObject({ duration_ms: 0, turns: 0, cost_usd: null });
  });
  it("turns spans into readable steps", () => {
    const steps = spans.map(spanStep).filter(Boolean);
    expect(steps.some((s) => s!.type === "note")).toBe(true);
    expect(steps.some((s) => s!.type === "fact" && /h approved/.test(s!.text))).toBe(true);
    expect(spanStep(spans[0])).toBeNull();
  });
  it("picks round axis ticks", () => {
    expect(tickStep(29_000)).toBe(5000);
    expect(tickStep(900)).toBe(250);
  });
});

describe("waveform", () => {
  it("normalizes the peaks file shapes", () => {
    expect(normalizePeaks([0, 2, 4])).toEqual([0, 0.5, 1]);
    expect(normalizePeaks({ peaks: [1, 1] })).toEqual([1, 1]);
    expect(normalizePeaks({ data: [-2, 1] })).toEqual([1, 0.5]);
    expect(normalizePeaks(null)).toBeNull();
    expect(normalizePeaks([])).toBeNull();
  });
  it("derives bars from word timings, loud where words are", () => {
    const p = derivePeaks(utts, 12, 120);
    expect(p).toHaveLength(120);
    const w = utts[0].words[0];
    expect(p[Math.floor((w.start / 12) * 120) + 1]).toBeGreaterThan(0.4);
    expect(p[0]).toBeLessThan(0.1);
    expect(derivePeaks(utts, 12, 120)).toEqual(p);
  });
  it("resamples to a bar count", () => {
    expect(resample([0, 1, 0, 0.5], 2)).toEqual([1, 0.5]);
    expect(resample([], 3)).toEqual([0, 0, 0]);
  });
});

describe("format", () => {
  it("durations and costs", () => {
    expect(fmtDuration(120)).toBe("120 ms");
    expect(fmtDuration(2400)).toBe("2.4 s");
    expect(fmtDuration(42_000)).toBe("42 s");
    expect(fmtDuration(125_000)).toBe("2 m 05 s");
    expect(fmtCost(0.29)).toBe("$0.29");
    expect(fmtCost(0.0042)).toBe("$0.0042");
    expect(fmtCost(null)).toBe("");
  });
});
