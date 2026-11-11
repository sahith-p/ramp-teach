/**
 * npm run eval:skill -- [--skill halcyon-invoice-review] [--version N] [--offline] [--sample K] [--case id,id]
 *                       [--batch] [--yes] [--apply-gate] [--no-gate]
 *
 * Learns every eval recording (evals/cases) with learnSkill({ persist: false }), grades the skills, writes
 * evals/runs/<run_id>.json and applies the gate to the skill version (real runs only, unless --apply-gate).
 *   --offline     no API calls: the learner runs offline and the judge is the keyword matcher (labeled deterministic)
 *   --batch       judge requests go through the Message Batches API (half price, slower)
 *   --yes         confirm the printed cost estimate; without it a paid run stops after the estimate
 * Exit codes: 0 gate passed, 1 gate failed, 2 stopped (needs --yes, or a setup problem).
 * Never reads data/answer_key.json.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { engineConfig } from "@/config/engine";
import { ROOT } from "@/lib/paths";
import { DEFAULT_SKILL_ID, PP, listSkillVersions } from "@/lib/pillars";
import { loadCaseRecording, loadEvalCaseFiles } from "@/lib/evals/cases";
import { ClaudeJudge, JUDGE_MODEL, KeywordJudge } from "@/lib/evals/judge";
import { loadReplayWorld } from "@/lib/evals/replay";
import { runSkillEvals } from "@/lib/evals/runner";
import { applyGateToSkill } from "@/lib/evals/skill-status";
import { AnthropicJudgeTransport, makeAnthropicClient } from "@/lib/evals/transport";
import { LearnerMissingError, loadLearner } from "./learner";

export interface CliArgs {
  skill: string;
  version: number | null;
  offline: boolean;
  sample: number | null;
  cases: string[] | null;
  batch: boolean;
  yes: boolean;
  applyGate: "auto" | "force" | "never";
}

export function parseArgs(argv: string[]): CliArgs {
  const a: CliArgs = {
    skill: DEFAULT_SKILL_ID,
    version: null,
    offline: false,
    sample: null,
    cases: null,
    batch: false,
    yes: false,
    applyGate: "auto",
  };
  const val = (i: number, flag: string) => {
    const v = argv[i + 1];
    if (v == null || v.startsWith("--")) throw new Error(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i];
    switch (f) {
      case "--skill":
        a.skill = val(i++, f);
        break;
      case "--version":
        a.version = Number(val(i++, f));
        if (!Number.isInteger(a.version) || a.version < 1) throw new Error("--version must be a positive integer");
        break;
      case "--sample":
        a.sample = Number(val(i++, f));
        if (!Number.isInteger(a.sample) || a.sample < 1) throw new Error("--sample must be a positive integer");
        break;
      case "--case":
      case "--cases":
        a.cases = val(i++, f).split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "--offline":
        a.offline = true;
        break;
      case "--batch":
        a.batch = true;
        break;
      case "--yes":
      case "-y":
        a.yes = true;
        break;
      case "--apply-gate":
        a.applyGate = "force";
        break;
      case "--no-gate":
        a.applyGate = "never";
        break;
      case "--":
        break;
      default:
        throw new Error(`Unknown flag ${f}`);
    }
  }
  return a;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const versions = listSkillVersions(args.skill);
  const version = args.version ?? versions.at(-1)?.version ?? null;
  if (version == null) {
    console.error(`No version of skill "${args.skill}" in skills/${args.skill}/. Learn one first (npm run skill:learn) or pass --version.`);
    return 2;
  }
  if (!versions.some((v) => v.version === version))
    console.warn(`warning: skills/${args.skill}/v${version}/skill.json not found; the gate cannot be applied to it.`);

  let learner;
  try {
    learner = await loadLearner();
  } catch (e) {
    if (e instanceof LearnerMissingError) {
      console.error(e.message);
      return 2;
    }
    throw e;
  }

  const client = args.offline ? null : await makeAnthropicClient();
  const live = client != null;
  const transport = client ? new AnthropicJudgeTransport(client, { log: (s) => console.log(s) }) : null;
  const judge = transport ? new ClaudeJudge(transport, JUDGE_MODEL, { batch: args.batch }) : new KeywordJudge();
  console.log(
    `Skill evals: ${args.skill} v${version} | ${live ? `REAL (learner + ${judge.label})` : `OFFLINE (${args.offline ? "--offline" : "no API key"}): learner offline, ${judge.label}`}`,
  );

  const tmpDir = path.join(ROOT, "runtime", "evals-tmp", new Date().toISOString().replace(/[:.]/g, ""));
  const outcome = await runSkillEvals(
    { skillId: args.skill, version, sample: args.sample, caseIds: args.cases, yes: args.yes, batch: args.batch, applyGate: args.applyGate },
    {
      learner,
      learnerLive: live,
      learnerModel: engineConfig.model,
      judge,
      transport,
      cases: loadEvalCaseFiles(),
      loadRecording: (c) => loadCaseRecording(c),
      replayWorld: await loadReplayWorld(),
      tmpDir,
      writeRun: (run) => {
        fs.mkdirSync(PP.evalRuns, { recursive: true });
        const file = path.join(PP.evalRuns, `${run.id}.json`);
        fs.writeFileSync(file, JSON.stringify(run, null, 2) + "\n");
        return path.relative(ROOT, file);
      },
      applyGate: applyGateToSkill,
      log: (s) => console.log(s),
    },
  );

  if (outcome.status === "needs_confirmation") {
    console.log("\nThis run makes paid API calls. Re-run with --yes to accept the estimate above (or --offline for a free run).");
    return 2;
  }
  const { run, file, errors, gateNote } = outcome;
  console.log(`\n${"case".padEnd(16)} ${"variant".padEnd(24)} recall  prec  cite   cov  replay  cons   wer   key  mode`);
  const f = (x: number | null) => (x == null ? "   - " : x.toFixed(2).padStart(5));
  for (const r of run.results) {
    const m = r.metrics;
    console.log(
      `${r.case_id.padEnd(16)} ${r.variant.padEnd(24)} ${f(m.rule_recall)} ${f(m.rule_precision)} ${f(m.citations_valid)} ${f(m.coverage)} ${f(m.replay_agreement)}  ${f(m.consistency)} ${f(m.wer)} ${f(m.keyterm_accuracy)}  ${r.mode}`,
    );
  }
  for (const e of errors) console.log(`${e.case_id.padEnd(16)} NOT GRADED (${e.stage}): ${e.error}`);
  const s = run.summary;
  console.log(
    `${"SUMMARY".padEnd(41)} ${f(s.rule_recall)} ${f(s.rule_precision)} ${f(s.citations_valid)} ${f(s.coverage)} ${f(s.replay_agreement)}  ${f(s.consistency)} ${f(s.wer)} ${f(s.keyterm_accuracy)}  ${run.mode}`,
  );
  console.log(`\nGate: ${run.gate.passed ? "PASSED" : "FAILED"}`);
  for (const x of run.gate.failures) console.log(`  - ${x}`);
  console.log(gateNote);
  console.log(`Cost: ${run.cost_usd == null ? "no paid calls" : `$${run.cost_usd.toFixed(4)}`}`);
  console.log(`Wrote ${file}${run.mode !== "real" ? " (not real mode: do not commit)" : ""}`);
  return run.gate.passed ? 0 : 1;
}

const isMain = !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(2);
    },
  );
}
