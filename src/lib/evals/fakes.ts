/**
 * Test doubles for the skill evals (used by *.test.ts only):
 *   oracleLearner  builds the skill a perfect learner would produce from the case's gold (harness oracle: must pass)
 *   nullLearner    returns a skill with nothing in it (harness null baseline: must fail)
 *   FakeTransport  scripted JudgeTransport (no network)
 */
import type { LearnSkillFn, Recording, SkillVersion } from "@/contracts";
import type { EvalCaseFile } from "./cases";
import type { JudgeCallMeta, JudgeRequest } from "./judge";
import type { JudgeTransport, TransportResult } from "./transport";

export function emptySkill(over: Partial<SkillVersion> = {}): SkillVersion {
  return {
    skill_id: "halcyon-invoice-review",
    version: 1,
    title: "Halcyon invoice review",
    created_at: "2026-11-11T00:00:00.000Z",
    mode: "mock",
    recordings: [],
    vendor: "Halcyon Staffing Group",
    rules: [],
    portal_map: [],
    open_questions: [],
    checks: [],
    stages: [],
    package_dir: "runtime/evals-tmp/x",
    anthropic_skill: null,
    status: "draft",
    eval_run_id: null,
    ...over,
  };
}

const FIELD_SELECTOR: Record<string, string> = {
  username: 'input[name="username"]',
  password: 'input[name="password"]',
  approved_hours: '[data-field="approved_hours"]',
};

/** The skill a perfect learner would write for this case: gold rules, cited to a real recorded DOM step. */
export function oracleSkill(c: EvalCaseFile, rec: Recording): SkillVersion {
  const firstDom = rec.steps.findIndex((s) => s.kind === "dom" && s.detail.selector);
  const cite = { utterance_id: null, quote: "", step_index: firstDom, selector: rec.steps[firstDom].detail.selector ?? null, url: null };
  const rules = [...c.gold.rules, c.gold.decision_rule].map((text, i) => ({
    id: `r${i + 1}`,
    text,
    kind: (i === c.gold.rules.length ? "decision" : "check") as "decision" | "check",
    source: "both" as const,
    citations: [cite],
  }));
  const portal_map = c.gold.pages.map((page) => ({
    page,
    fields: c.gold.fields
      .filter((f) => (f === "approved_hours" ? page.includes("employees") : page.includes("login")))
      .map((name) => ({ name, selector: FIELD_SELECTOR[name] })),
  }));
  return emptySkill({ recordings: [rec.session_id], rules, portal_map });
}

export function oracleLearner(cases: EvalCaseFile[]): LearnSkillFn {
  return async (rec) => {
    const c = cases.find((x) => `rec_eval_${x.id.replace(/-/g, "_")}` === rec.session_id);
    if (!c) throw new Error(`oracle has no case for ${rec.session_id}`);
    return oracleSkill(c, rec);
  };
}

export const nullLearner: LearnSkillFn = async (rec) => emptySkill({ recordings: [rec.session_id] });

export class FakeTransport implements JudgeTransport {
  calls: JudgeRequest[] = [];
  batches: JudgeRequest[][] = [];
  counted: JudgeRequest[] = [];
  constructor(private respond: (req: JudgeRequest) => TransportResult, private tokens = 1000) {}
  async call(req: JudgeRequest): Promise<TransportResult> {
    this.calls.push(req);
    return this.respond(req);
  }
  async batch(reqs: JudgeRequest[]): Promise<Record<string, TransportResult>> {
    this.batches.push(reqs);
    return Object.fromEntries(reqs.map((r) => [r.custom_id, this.respond(r)]));
  }
  async countTokens(req: JudgeRequest): Promise<number> {
    this.counted.push(req);
    return this.tokens;
  }
}

export const fakeMeta = (over: Partial<JudgeCallMeta> = {}): JudgeCallMeta => ({
  model: "claude-opus-5-5",
  request_id: "req_fake",
  message_id: "msg_fake",
  usage: { input_tokens: 1000, output_tokens: 500 },
  batch: false,
  served_model_mismatch: null,
  ...over,
});
