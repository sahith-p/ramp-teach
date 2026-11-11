import { beforeAll, describe, expect, it } from "vitest";
import type { Recording, SkillEvalResult, SkillRule } from "@/contracts";
import { loadCaseRecording, loadEvalCaseFiles, type EvalCaseFile } from "./cases";
import { gradeCitations } from "./citations";
import { conceptsOf } from "./concepts";
import { scoreConsistency } from "./consistency";
import { gradeCoverage } from "./coverage";
import { emptySkill, oracleSkill } from "./fakes";
import { evaluateGate, summarize } from "./gate";
import { keywordConsistency, keywordMatch } from "./judge";
import { gradeReplay, loadReplayWorld, type ReplayWorld } from "./replay";
import { goldItems, scoreRules } from "./rules";
import { containsQuote, normalizePage, normalizeText, tokenize, wordEditOps } from "./text";
import { gradeVoice } from "./voice";

const cases = loadEvalCaseFiles();
const byId = (id: string) => cases.find((c) => c.id === id)! as EvalCaseFile;
const rec = (id: string): Recording => loadCaseRecording(byId(id));
const rule = (id: string, text: string, over: Partial<SkillRule> = {}): SkillRule => ({
  id,
  text,
  kind: "check",
  source: "said",
  citations: [{ utterance_id: null, quote: "", step_index: 2, selector: 'input[name="username"]', url: null }],
  ...over,
});

describe("text helpers", () => {
  it("normalizes text, tokens and quotes", () => {
    expect(normalizeText("Maya Chen’s timecard — 40 hours.")).toBe("maya chen's timecard 40 hours");
    expect(tokenize("HSG-1010, 1.5 times!")).toEqual(["hsg-1010", "1.5", "times"]);
    expect(containsQuote("Every labor rate must equal the contract rate card;", "labor rate must equal")).toBe(true);
    expect(containsQuote("Every labor rate", "ate")).toBe(false); // whole words only
    expect(containsQuote("anything", "   ")).toBe(false);
  });
  it("counts word edits", () => {
    expect(wordEditOps(["a", "b", "c"], ["a", "x", "c", "d"])).toEqual({ sub: 1, del: 0, ins: 1, distance: 2 });
    expect(wordEditOps(["a", "b"], [])).toEqual({ sub: 0, del: 2, ins: 0, distance: 2 });
  });
  it("normalizes pages from URLs and learned patterns alike", () => {
    const want = "/portal/employees/<*>?week=<*>";
    expect(normalizePage("http://localhost:3000/portal/employees/E-101?week=2026-10-11")).toBe(want);
    expect(normalizePage("/portal/employees/<employee_id>?week=<YYYY-MM-DD>")).toBe(want);
    expect(normalizePage("/portal/employees/{id}?week={week}")).toBe(want);
    expect(normalizePage("/portal/invoices/HSG-1010")).toBe("/portal/invoices/<*>");
    expect(normalizePage("/portal/invoices")).toBe("/portal/invoices");
  });
});

describe("C3 citations_valid", () => {
  const r = () => rec("baseline");
  it("accepts real quotes, utterance ids, and DOM steps with their selector", () => {
    const g = gradeCitations(
      {
        rules: [
          rule("r1", "rate", { citations: [{ utterance_id: "u2", quote: "every labor rate must equal the contract rate card", step_index: null, selector: null, url: null }] }),
          rule("r2", "hours", { source: "shown", citations: [{ utterance_id: null, quote: "", step_index: 13, selector: '[data-field="approved_hours"]', url: null }] }),
        ],
      },
      r(),
    );
    expect(g.score).toBe(1);
  });
  it("rejects invented quotes, narration steps, wrong selectors, missing citations and wrong utterances", () => {
    const bad = [
      rule("a", "x", { citations: [{ utterance_id: null, quote: "overtime is billable at double rate", step_index: null, selector: null, url: null }] }),
      rule("b", "x", { citations: [{ utterance_id: null, quote: "", step_index: 1, selector: null, url: null }] }), // narration
      rule("c", "x", { citations: [{ utterance_id: null, quote: "", step_index: 13, selector: "button.approve", url: null }] }),
      rule("d", "x", { citations: [] }),
      rule("e", "x", { citations: [{ utterance_id: "u1", quote: "billed twice", step_index: null, selector: null, url: null }] }),
      rule("f", "x", { citations: [{ utterance_id: null, quote: "", step_index: 999, selector: null, url: null }] }),
      rule("g", "x", { citations: [{ utterance_id: null, quote: "", step_index: null, selector: "#never-used", url: null }] }),
    ];
    const g = gradeCitations({ rules: [...bad, rule("ok", "x")] }, r());
    expect(g.score).toBeCloseTo(1 / 8);
    expect(g.notes.filter((n) => n.startsWith("INVALID"))).toHaveLength(7);
  });
  it("accepts quotes of the noisy words the learner actually heard (stt-noise)", () => {
    const g = gradeCitations(
      { rules: [rule("r1", "x", { citations: [{ utterance_id: "u4", quote: "shows for tea hours", step_index: null, selector: null, url: null }] })] },
      rec("stt-noise"),
    );
    expect(g.score).toBe(1);
  });
  it("scores 0 with no rules", () => expect(gradeCitations({ rules: [] }, r()).score).toBe(0));
});

describe("C4 coverage", () => {
  it("is 1 for the gold map and reports missing and invented pages", () => {
    const c = byId("baseline");
    expect(gradeCoverage(oracleSkill(c, rec("baseline")).portal_map, c.gold, rec("baseline")).score).toBe(1);
    const g = gradeCoverage(
      [
        { page: "/portal/login", fields: [{ name: "Username", selector: "#u" }, { name: "pw", selector: 'input[name="password"]' }] },
        { page: "/portal/invoices/<id>", fields: [] },
        { page: "/portal/payments", fields: [] },
      ],
      c.gold,
      rec("baseline"),
    );
    // found: login, invoice page, username (by name), password (by selector) = 4 of 7
    expect(g.score).toBeCloseTo(4 / 7);
    expect(g.notes).toContain("MISSING page /portal/invoices");
    expect(g.notes).toContain("MISSING field approved_hours");
    expect(g.notes.some((n) => n.startsWith("INVENTED page /portal/payments"))).toBe(true);
  });
  it("flags a timecard page in the said-not-shown map as invented", () => {
    const c = byId("said-not-shown");
    const g = gradeCoverage(
      [...oracleSkill(c, rec("said-not-shown")).portal_map, { page: "/portal/employees/<id>?week=<w>", fields: [] }],
      c.gold,
      rec("said-not-shown"),
    );
    expect(g.score).toBe(1);
    expect(g.notes.some((n) => n.startsWith("INVENTED page /portal/employees"))).toBe(true);
  });
});

describe("C5 replay_agreement (calc only, past corrections)", () => {
  let world: ReplayWorld;
  beforeAll(async () => {
    world = await loadReplayWorld();
  });
  const all = byId("baseline").gold_checks;
  it("all six checks reproduce every past outcome (and the past bill status)", () => {
    const g = gradeReplay(all, all, world);
    expect(g.score).toBe(1);
    expect(g.rows).toHaveLength(10);
    for (const r of g.rows) {
      const bill = world.bills.find((b) => b.bill_id === `bill_${r.invoice_id}`)!;
      expect(r.target).toBe(bill.status === "disputed" ? "dispute" : "approve");
    }
  });
  it("a missing check loses exactly the invoices only it caught", () => {
    const g = gradeReplay(all.filter((c) => c !== "hours_match_timecards"), all, world);
    expect(g.score).toBeCloseTo(8 / 10); // HSG-1007, HSG-1009
    expect(g.notes.filter((n) => n.startsWith("DISAGREE")).join(" ")).toMatch(/HSG-1007.*HSG-1009/);
  });
  it("targets follow the case's gold checks (step-skipped)", () => {
    const gold = byId("step-skipped").gold_checks;
    expect(gradeReplay(gold, gold, world).score).toBe(1);
    // A skill that adds the skipped arithmetic checks disputes HSG-1002/1005 where this reviewer would not.
    expect(gradeReplay(all, gold, world).score).toBeCloseTo(8 / 10);
  });
  it("no checks at all approves everything", () => {
    expect(gradeReplay([], all, world).score).toBeCloseTo(3 / 10);
  });
});

describe("C7 voice", () => {
  it("is exact on scripted clean speech and measures planted errors", () => {
    const clean = gradeVoice(rec("baseline"), byId("baseline").reference_transcript);
    expect(clean.wer).toBe(0);
    expect(clean.keyterm_accuracy).toBe(1);
    const noisy = gradeVoice(rec("stt-noise"), byId("stt-noise").reference_transcript);
    expect(noisy.wer!).toBeGreaterThan(0.05);
    expect(noisy.keyterm_accuracy!).toBeLessThan(0.8);
    const missed = noisy.notes.filter((n) => n.startsWith("KEYTERM")).map((n) => n.split('"')[1]);
    expect(missed.sort()).toEqual(["HSG-1010", "Jordan Alvarez", "Maya Chen", "Priya Natarajan", "Sam Okafor", "rate card"]);
    expect(gradeVoice(rec("baseline"), null)).toMatchObject({ wer: null, keyterm_accuracy: null });
  });
});

describe("C2 rule scoring + keyword judge", () => {
  const c = byId("baseline");
  it("oracle rules score recall 1 / precision 1 and map to the gold checks", () => {
    const skill = oracleSkill(c, rec("baseline"));
    const input = { case_id: c.id, gold: goldItems(c), learned: skill.rules, recording: rec("baseline") };
    const g = scoreRules(c, skill, keywordMatch(input));
    expect(g.recall).toBe(1);
    expect(g.precision).toBe(1);
    expect(g.checks.sort()).toEqual([...c.gold_checks].sort());
  });
  it("counts misses, inventions and supported extras", () => {
    const skill = emptySkill({
      rules: [
        rule("r1", "Every labor rate must equal the contract rate card."),
        rule("r2", "Sign in to the vendor portal.", { kind: "procedure" }),
        rule("r3", "Overtime above 40 hours a week is billable at 1.5 times the rate."), // open question turned rule
        rule("r4", "If any check fails, dispute and ask for a credit memo.", { kind: "decision" }),
      ],
    });
    const input = { case_id: c.id, gold: goldItems(c), learned: skill.rules, recording: rec("baseline") };
    const g = scoreRules(c, skill, keywordMatch(input));
    expect(g.recall).toBeCloseTo(2 / 7);
    expect(g.precision).toBeCloseTo(3 / 4);
    expect(g.precisionNotes.some((n) => n.startsWith("INVENTED r3"))).toBe(true);
    expect(g.recallNotes.filter((n) => n.startsWith("MISSED"))).toHaveLength(5);
  });
  it("ignores judge verdicts for unknown rules and match verdicts without a gold index", () => {
    const skill = emptySkill({ rules: [rule("r1", "x")] });
    const g = scoreRules(c, skill, {
      learned: [
        { rule_id: "r1", verdict: "match", gold_indices: [99], checks: [], reason: "" },
        { rule_id: "ghost", verdict: "match", gold_indices: [0], checks: [], reason: "" },
      ],
      gold: [],
    });
    expect(g.recall).toBe(0);
    expect(g.precision).toBe(0);
  });
  it("adds checks the skill ships as scripts", () => {
    const skill = emptySkill({ checks: [{ name: "no_duplicate_lines", file: "x.py", language: "python" }, { name: "custom", file: "y.py", language: "python" }] });
    expect(scoreRules(c, skill, { learned: [], gold: [] }).checks).toEqual(["no_duplicate_lines"]);
  });
  it("keyword concepts read the casual paraphrase wording", () => {
    expect([...conceptsOf("Nobody gets billed two times for one week.")]).toEqual(["no_duplicate_lines"]);
    expect(conceptsOf("And the math has to work, each line and the grand total.")).toEqual(
      new Set(["line_amounts_correct", "total_matches_line_items"]),
    );
    expect(conceptsOf("Maya's approved for 40. You can't bill more hours than were approved.").has("hours_match_timecards")).toBe(true);
  });
});

describe("C6 consistency scoring", () => {
  const a = [rule("a1", "Every labor rate must equal the contract rate card."), rule("a2", "Dispute on any failure.", { kind: "decision" })];
  const b = [rule("b1", "The hourly rate has to match the rate card in our contract."), rule("b2", "If something's wrong, dispute it.", { kind: "decision" }), rule("b3", "No billing twice in a week.")];
  it("scores 2 x equivalent pairs over both rule counts", () => {
    const s = scoreConsistency(a, b, {
      pairs: [
        { a_rule_id: "a1", b_rule_id: "b1", equivalent: true, reason: "" },
        { a_rule_id: "a2", b_rule_id: "b2", equivalent: true, reason: "" },
        { a_rule_id: "a2", b_rule_id: "b3", equivalent: true, reason: "dup" }, // a2 already paired
      ],
      unmatched_a: [],
      unmatched_b: [{ rule_id: "b3", reason: "only in B" }],
      summary: "",
    });
    expect(s.score).toBeCloseTo(4 / 5);
    expect(s.notes.some((n) => n.startsWith("ONLY IN B b3"))).toBe(true);
  });
  it("keyword consistency pairs rules by concept", () => {
    const out = keywordConsistency({ group: "g", a: { case_id: "x", rules: a }, b: { case_id: "y", rules: b } });
    expect(scoreConsistency(a, b, out).score).toBeCloseTo(4 / 5);
  });
  it("is 0 when neither skill has substantive rules", () => {
    expect(scoreConsistency([], [], { pairs: [], unmatched_a: [], unmatched_b: [], summary: "" }).score).toBe(0);
  });
});

describe("C8 summary + gate", () => {
  const res = (id: string, m: Partial<SkillEvalResult["metrics"]>): SkillEvalResult => ({
    case_id: id,
    variant: id,
    mode: "real",
    notes: {},
    metrics: {
      rule_recall: 1,
      rule_precision: 1,
      citations_valid: 1,
      coverage: 1,
      replay_agreement: 1,
      consistency: null,
      wer: null,
      keyterm_accuracy: null,
      ...m,
    },
  });
  it("passes when every threshold holds", () => {
    const rs = [res("a", { coverage: 0.9, consistency: 1 }), res("b", { coverage: 1 })];
    const s = summarize(rs);
    expect(s.coverage).toBeCloseTo(0.95);
    expect(s.consistency).toBe(1);
    expect(s.wer).toBeNull();
    expect(evaluateGate(s, rs, [])).toEqual({ passed: true, failures: [] });
  });
  it("fails below a threshold, naming the cases", () => {
    const rs = [res("a", { rule_precision: 0.8 }), res("b", {})];
    const g = evaluateGate(summarize(rs), rs, []);
    expect(g.passed).toBe(false);
    expect(g.failures[0]).toMatch(/^rule_precision 0\.90 < 1\.00 \(cases: a\)/);
  });
  it("fails when a case could not be graded, and when nothing was graded", () => {
    const rs = [res("a", {})];
    expect(evaluateGate(summarize(rs), rs, [{ case_id: "b", variant: "b", stage: "learn", error: "boom" }]).passed).toBe(false);
    expect(evaluateGate(summarize([]), [], []).passed).toBe(false);
  });
});
