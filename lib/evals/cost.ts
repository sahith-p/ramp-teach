/**
 * Cost: prices, cost from recorded usage, and the pre-run estimate (token counts from the free count_tokens endpoint).
 * Prices are USD per million tokens (claude-api skill table, cached 2026-11-03). Cache writes 1.25x input,
 * cache reads 0.1x input, Message Batches 0.5x.
 */
import type { Recording } from "@/contracts";
import { buildJudgeRequest, type JudgeTask } from "./judge";
import type { JudgeTransport } from "./transport";

export const PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

export function priceFor(model: string | null | undefined): { input: number; output: number } {
  return (model && PRICES[model]) || PRICES["claude-opus-5-5"];
}

export function costOfUsage(model: string | null | undefined, usage: unknown, opts: { batch?: boolean } = {}): number {
  const u = (usage ?? {}) as Record<string, unknown>;
  const n = (k: string) => (typeof u[k] === "number" ? (u[k] as number) : 0);
  const p = priceFor(model);
  const usd =
    (n("input_tokens") * p.input +
      n("cache_creation_input_tokens") * p.input * 1.25 +
      n("cache_read_input_tokens") * p.input * 0.1 +
      n("output_tokens") * p.output) /
    1e6;
  return opts.batch ? usd / 2 : usd;
}

/* ------------------------------- estimate ------------------------------- */

/** Assumptions for what count_tokens cannot see (outputs, and the learner's own prompts). */
export const ESTIMATE = {
  /** Learner pipeline calls per recording (segment, claims, synthesize, critique, checks, package). */
  learnCallsPerRecording: 6,
  /** Learner instruction tokens per call, on top of the recording (rough; the prompts live in learn/skill). */
  learnPromptOverhead: 2500,
  learnOutputPerCall: 4000,
  /** Judge output incl. adaptive thinking at low effort. */
  judgeOutput: 4000,
};

export interface CostEstimate {
  learner: { input_tokens: number; output_tokens: number; usd: number; cases: number };
  judge: { input_tokens: number; output_tokens: number; usd: number; requests: number; batch: boolean };
  total_usd: number;
  lines: string[];
}

/**
 * Upper-bound estimate before any paid call. Learner input is the counted recording size plus an overhead per call;
 * judge input is counted exactly on a request built with the gold rules standing in for the learned rules.
 */
export async function estimateCost(args: {
  transport: JudgeTransport;
  recordings: { case_id: string; recording: Recording }[];
  judgeTasks: JudgeTask[];
  learnerModel: string;
  judgeModel: string;
  batch: boolean;
  learnerLive: boolean;
}): Promise<CostEstimate> {
  const lines: string[] = [];
  let lIn = 0;
  let lOut = 0;
  if (args.learnerLive) {
    for (const { case_id, recording } of args.recordings) {
      const recTokens = await args.transport.countTokens(
        { custom_id: `count_${case_id}`, kind: "consistency", system: "", user: JSON.stringify(recording) },
        args.learnerModel,
      );
      const inTok = (recTokens + ESTIMATE.learnPromptOverhead) * ESTIMATE.learnCallsPerRecording;
      const outTok = ESTIMATE.learnOutputPerCall * ESTIMATE.learnCallsPerRecording;
      lIn += inTok;
      lOut += outTok;
      lines.push(`  learn ${case_id.padEnd(16)} recording ${recTokens} tok -> ~${inTok} in / ~${outTok} out (${ESTIMATE.learnCallsPerRecording} calls, assumed)`);
    }
  }
  let jIn = 0;
  for (const t of args.judgeTasks) {
    const tok = await args.transport.countTokens(buildJudgeRequest(t), args.judgeModel);
    jIn += tok;
    lines.push(`  judge ${t.id.padEnd(28)} ${tok} tok in (counted) / ~${ESTIMATE.judgeOutput} out (assumed)`);
  }
  const jOut = ESTIMATE.judgeOutput * args.judgeTasks.length;
  const lp = priceFor(args.learnerModel);
  const jp = priceFor(args.judgeModel);
  const learnerUsd = (lIn * lp.input + lOut * lp.output) / 1e6;
  const judgeUsd = ((jIn * jp.input + jOut * jp.output) / 1e6) * (args.batch ? 0.5 : 1);
  return {
    learner: { input_tokens: lIn, output_tokens: lOut, usd: learnerUsd, cases: args.recordings.length },
    judge: { input_tokens: jIn, output_tokens: jOut, usd: judgeUsd, requests: args.judgeTasks.length, batch: args.batch },
    total_usd: learnerUsd + judgeUsd,
    lines,
  };
}
