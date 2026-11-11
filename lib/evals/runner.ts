/**
 * Skill-eval runner: learn each eval recording (persist:false), grade it (C2-C7), summarize, gate (C8), write
 * evals/runs/<run_id>.json. All I/O and model access come in through `deps`, so tests run it with a fake learner and
 * a fake judge. The CLI (evals/cli.ts) wires the real ones.
 *
 * Harness rules (claude-api eval-audit): a case that could not be learned or judged is recorded as an error and fails
 * the gate; it is never scored 0 or silently dropped. Paid calls only after a printed estimate and an explicit --yes.
 */
import path from "node:path";
import {
  SkillEvalRunSchema,
  SkillVersionSchema,
  type LearnSkillFn,
  type PillarMode,
  type Recording,
  type SkillEvalResult,
  type SkillEvalRun,
  type SkillVersion,
} from "@/contracts";
import { sampleCases, type EvalCaseFile } from "./cases";
import { gradeCitations } from "./citations";
import { scoreConsistency, substantiveRules } from "./consistency";
import { costOfUsage, estimateCost, type CostEstimate } from "./cost";
import { gradeCoverage } from "./coverage";
import { evaluateGate, summarize, type CaseError } from "./gate";
import type { Judge, JudgeOutcome, JudgeTask, LearnedRuleView, MatchJudgeOutput } from "./judge";
import { gradeReplay, type ReplayWorld } from "./replay";
import { goldItems, scoreRules } from "./rules";
import type { GateApplyResult } from "./skill-status";
import { round } from "./text";
import type { JudgeTransport } from "./transport";
import { gradeVoice } from "./voice";

export interface RunOptions {
  skillId: string;
  version: number;
  sample?: number | null;
  caseIds?: string[] | null;
  /** Paid calls happen only with yes=true (after the printed estimate). */
  yes?: boolean;
  batch?: boolean;
  /** auto = apply only when the run is real; force = apply even for offline grading; never = report only. */
  applyGate?: "auto" | "force" | "never";
  learnTimeoutMs?: number;
}

export interface RunDeps {
  learner: LearnSkillFn;
  /** True when learnSkill will make real (paid) model calls; false runs it with offline:true. */
  learnerLive: boolean;
  learnerModel?: string;
  judge: Judge;
  /** Needed for the cost estimate whenever a paid call will be made. */
  transport: JudgeTransport | null;
  cases: EvalCaseFile[];
  loadRecording: (c: EvalCaseFile) => Recording;
  replayWorld: ReplayWorld;
  /** Folder for the learner's non-persisted output (one sub-folder per case). */
  tmpDir: string;
  writeRun: (run: SkillEvalRun) => string;
  applyGate: (skillId: string, version: number, passed: boolean, runId: string) => Promise<GateApplyResult>;
  now?: () => Date;
  log?: (line: string) => void;
}

export type RunOutcome =
  | { status: "needs_confirmation"; estimate: CostEstimate }
  | {
      status: "done";
      run: SkillEvalRun;
      file: string;
      errors: CaseError[];
      estimate: CostEstimate | null;
      gateApplied: GateApplyResult | null;
      gateNote: string;
    };

const MODE_RANK: Record<PillarMode, number> = { mock: 0, deterministic: 1, scripted: 2, real: 3 };
export const minMode = (...modes: PillarMode[]): PillarMode =>
  modes.reduce((a, b) => (MODE_RANK[b] < MODE_RANK[a] ? b : a), "real" as PillarMode);

const safeId = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
export const runIdFor = (skillId: string, version: number, now: Date) =>
  `eval_${skillId}_v${version}_${now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`;

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<T>((_, rej) => {
      timer = setTimeout(() => rej(new Error(`${what} timed out after ${Math.round(ms / 1000)} s`)), ms);
    }),
  ]);
}

const view = (s: Pick<SkillVersion, "rules">): LearnedRuleView[] =>
  s.rules.map(({ id, kind, source, text }) => ({ id, kind, source, text }));

/** Judge tasks for a set of learned skills (or, for the estimate, gold rules standing in for learned ones). */
export function buildJudgeTasks(
  items: { c: EvalCaseFile; rec: Recording; rules: LearnedRuleView[]; substantive: LearnedRuleView[] }[],
): JudgeTask[] {
  const tasks: JudgeTask[] = items.map(({ c, rec, rules }) => ({
    id: safeId(`match_${c.id}`),
    kind: "match",
    input: { case_id: c.id, gold: goldItems(c), learned: rules, recording: rec },
  }));
  const groups = new Map<string, typeof items>();
  for (const it of items) {
    if (!it.c.consistency_group) continue;
    groups.set(it.c.consistency_group, [...(groups.get(it.c.consistency_group) ?? []), it]);
  }
  for (const [group, members] of groups) {
    if (members.length < 2) continue;
    const [a, b] = members;
    tasks.push({
      id: safeId(`consistency_${group}`),
      kind: "consistency",
      input: { group, a: { case_id: a.c.id, rules: a.substantive }, b: { case_id: b.c.id, rules: b.substantive } },
    });
  }
  return tasks;
}

function standInRules(c: EvalCaseFile): LearnedRuleView[] {
  return goldItems(c).map((t, i) => ({ id: `g${i + 1}`, kind: i === c.gold.rules.length ? "decision" : "check", source: "said", text: t }));
}

function learnerUsageCost(skill: SkillVersion): number {
  let usd = 0;
  for (const s of skill.stages) if (s.mode === "real" && s.usage) usd += costOfUsage(s.model, s.usage);
  return usd;
}

export async function runSkillEvals(opts: RunOptions, deps: RunDeps): Promise<RunOutcome> {
  const log = deps.log ?? (() => {});
  const now = deps.now ?? (() => new Date());
  const errors: CaseError[] = [];

  let cases = deps.cases;
  if (opts.caseIds?.length) cases = cases.filter((c) => opts.caseIds!.includes(c.id));
  cases = sampleCases(cases, opts.sample ?? null);
  if (cases.length === 0) throw new Error("No eval cases selected (evals/cases/*.json).");

  // 1. recordings
  const recs = new Map<string, Recording>();
  for (const c of cases) {
    try {
      recs.set(c.id, deps.loadRecording(c));
    } catch (e) {
      errors.push({ case_id: c.id, variant: c.variant, stage: "recording", error: (e as Error).message });
    }
  }

  // 2. cost guard: estimate before ANY paid call; stop unless --yes.
  const paid = deps.learnerLive || deps.judge.mode === "real";
  let estimate: CostEstimate | null = null;
  if (paid) {
    if (!deps.transport) throw new Error("A paid run needs the API transport for the cost estimate.");
    const ready = cases.filter((c) => recs.has(c.id));
    estimate = await estimateCost({
      transport: deps.transport,
      recordings: ready.map((c) => ({ case_id: c.id, recording: recs.get(c.id)! })),
      judgeTasks:
        deps.judge.mode === "real"
          ? buildJudgeTasks(ready.map((c) => ({ c, rec: recs.get(c.id)!, rules: standInRules(c), substantive: standInRules(c) })))
          : [],
      learnerModel: deps.learnerModel ?? "claude-opus-5-5",
      judgeModel: deps.judge.model ?? "claude-opus-5-5",
      batch: !!opts.batch,
      learnerLive: deps.learnerLive,
    });
    log("Cost estimate (upper bound; token counts from count_tokens, outputs assumed):");
    for (const l of estimate.lines) log(l);
    log(
      `  learner ~$${estimate.learner.usd.toFixed(2)} + judge ~$${estimate.judge.usd.toFixed(2)}${estimate.judge.batch ? " (batch, half price)" : ""} = ~$${estimate.total_usd.toFixed(2)}`,
    );
    if (!opts.yes) return { status: "needs_confirmation", estimate };
  }

  // 3. learn each case (never persisted)
  const learned = new Map<string, SkillVersion>();
  for (const c of cases) {
    const rec = recs.get(c.id);
    if (!rec) continue;
    log(`learn ${c.id} (${c.variant})…`);
    try {
      const skill = await withTimeout(
        deps.learner(rec, { persist: false, offline: !deps.learnerLive, outDir: path.join(deps.tmpDir, c.id) }),
        opts.learnTimeoutMs ?? 15 * 60_000,
        "learnSkill",
      );
      learned.set(c.id, SkillVersionSchema.parse(skill));
    } catch (e) {
      errors.push({ case_id: c.id, variant: c.variant, stage: "learn", error: (e as Error).message });
    }
  }

  // 4. judge (all requests at once so --batch can send one Message Batch)
  const items = cases
    .filter((c) => learned.has(c.id))
    .map((c) => {
      const s = learned.get(c.id)!;
      return { c, rec: recs.get(c.id)!, rules: view(s), substantive: substantiveRules(s) };
    });
  const tasks = buildJudgeTasks(items);
  log(`judge ${tasks.length} requests with ${deps.judge.label}…`);
  let outcomes: Record<string, JudgeOutcome> = {};
  try {
    outcomes = await deps.judge.runAll(tasks);
  } catch (e) {
    for (const t of tasks) outcomes[t.id] = { ok: false, error: (e as Error).message, meta: null };
  }

  // 5. grade
  let judgeUsd = 0;
  let anyPaid = false;
  for (const o of Object.values(outcomes)) {
    if (o.meta?.usage) {
      anyPaid = true;
      judgeUsd += costOfUsage(o.meta.model, o.meta.usage, { batch: o.meta.batch });
    }
  }
  const consistencyByCase = new Map<string, { score: number | null; notes: string[] }>();
  for (const t of tasks) {
    if (t.kind !== "consistency") continue;
    const o = outcomes[t.id];
    let res: { score: number | null; notes: string[] };
    if (o?.ok && o.kind === "consistency") res = scoreConsistency(t.input.a.rules, t.input.b.rules, o.output);
    else res = { score: null, notes: [`Consistency judge failed: ${o && !o.ok ? o.error : "no result"}`] };
    const tag = (other: string) => ({ score: res.score, notes: [`Compared with ${other}.`, ...res.notes] });
    consistencyByCase.set(t.input.a.case_id, tag(t.input.b.case_id));
    consistencyByCase.set(t.input.b.case_id, tag(t.input.a.case_id));
  }

  const results: SkillEvalResult[] = [];
  let learnerUsd = 0;
  for (const { c, rec } of items) {
    const skill = learned.get(c.id)!;
    const o = outcomes[safeId(`match_${c.id}`)];
    if (!o || !o.ok || o.kind !== "match") {
      errors.push({ case_id: c.id, variant: c.variant, stage: "judge", error: o && !o.ok ? o.error : "no judge result" });
      continue;
    }
    try {
      const matched: MatchJudgeOutput = o.output;
      const rules = scoreRules(c, skill, matched);
      const cites = gradeCitations(skill, rec);
      const cov = gradeCoverage(skill.portal_map, c.gold, rec);
      const replay = gradeReplay(rules.checks, c.gold_checks, deps.replayWorld);
      const voice = gradeVoice(rec, c.reference_transcript);
      const cons = consistencyByCase.get(c.id) ?? null;
      const stageUsd = learnerUsageCost(skill);
      learnerUsd += stageUsd;
      if (stageUsd > 0) anyPaid = true;
      const judgeNote = [
        `${deps.judge.label}${o.meta.model ? `; served by ${o.meta.model}` : ""}${o.meta.request_id ? `; request ${o.meta.request_id}` : ""}`,
      ];
      if (o.meta.served_model_mismatch)
        judgeNote.push(`WARNING: judge response came from ${o.meta.served_model_mismatch}, not ${deps.judge.model} (refusal fallback)`);
      results.push({
        case_id: c.id,
        variant: c.variant,
        metrics: {
          rule_recall: round(rules.recall),
          rule_precision: round(rules.precision),
          citations_valid: round(cites.score),
          coverage: round(cov.score),
          replay_agreement: round(replay.score),
          consistency: cons?.score == null ? null : round(cons.score),
          wer: voice.wer == null ? null : round(voice.wer),
          keyterm_accuracy: voice.keyterm_accuracy == null ? null : round(voice.keyterm_accuracy),
        },
        notes: {
          case: [c.description, c.provenance.note],
          rule_recall: rules.recallNotes,
          rule_precision: rules.precisionNotes,
          citations_valid: cites.notes,
          coverage: cov.notes,
          replay_agreement: replay.notes,
          consistency: cons?.notes ?? ["Not part of a consistency pair."],
          voice: voice.notes,
          learner: [
            `skill mode ${skill.mode}; ${skill.rules.length} rules, ${skill.portal_map.length} pages, ${skill.checks.length} check scripts`,
            ...skill.stages.map((s) => `stage ${s.name}: ${s.mode}${s.model ? ` (${s.model})` : ""}${s.request_id ? ` request ${s.request_id}` : ""}`),
          ],
          judge: judgeNote,
        },
        mode: minMode(skill.mode, deps.judge.mode),
      });
    } catch (e) {
      errors.push({ case_id: c.id, variant: c.variant, stage: "grade", error: (e as Error).message });
    }
  }

  // 6. summary, gate, write
  const created = now();
  const summary = summarize(results);
  const gate = evaluateGate(summary, results, errors);
  const run = SkillEvalRunSchema.parse({
    id: runIdFor(opts.skillId, opts.version, created),
    skill_id: opts.skillId,
    version: opts.version,
    created_at: created.toISOString(),
    mode: results.length ? minMode(...results.map((r) => r.mode)) : minMode(deps.judge.mode, deps.learnerLive ? "real" : "mock"),
    results,
    summary,
    gate,
    cost_usd: anyPaid ? Number((judgeUsd + learnerUsd).toFixed(4)) : null,
  });
  const file = deps.writeRun(run);

  // 7. C8: apply the gate to the version
  const policy = opts.applyGate ?? "auto";
  let gateApplied: GateApplyResult | null = null;
  let gateNote: string;
  if (policy === "never") gateNote = "Gate computed, not applied (report only).";
  else if (policy === "auto" && run.mode !== "real")
    gateNote = `Gate computed, not applied: this run is ${run.mode}, not real (pass --apply-gate to apply anyway).`;
  else {
    try {
      gateApplied = await deps.applyGate(opts.skillId, opts.version, gate.passed, run.id);
      gateNote = `Version ${opts.version} set to ${gateApplied.status}${gateApplied.activated ? " and made active" : ""} (${gateApplied.via}).`;
    } catch (e) {
      gateNote = `Gate not applied: ${(e as Error).message}`;
    }
  }
  return { status: "done", run, file, errors, estimate, gateApplied, gateNote };
}
