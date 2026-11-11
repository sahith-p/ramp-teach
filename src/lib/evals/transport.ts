/**
 * The judge's wire to the Claude API (real mode only). Tests inject a fake JudgeTransport.
 *   call()        one structured-output request (beta Messages + server-side refusal fallback)
 *   batch()       all requests through the Message Batches API (half price; no `fallbacks` there), polled to the end
 *   countTokens() free token count for the cost estimate
 * Every completed call is written to the usage ledger (lib/usage.ts) with its request id.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { recordUsage } from "@/lib/usage";
import { ConsistencyJudgeSchema, JUDGE_EFFORT, MatchJudgeSchema, type JudgeCallMeta, type JudgeRequest } from "./judge";

export type TransportResult = { ok: true; json: unknown; meta: JudgeCallMeta } | { ok: false; error: string; meta: JudgeCallMeta | null };

export interface JudgeTransport {
  call(req: JudgeRequest, model: string): Promise<TransportResult>;
  batch(reqs: JudgeRequest[], model: string): Promise<Record<string, TransportResult>>;
  countTokens(req: JudgeRequest, model: string): Promise<number>;
}

export const USAGE_PURPOSE = "skill-eval-judge";
const MAX_TOKENS = 16000;

const schemaFor = (kind: JudgeRequest["kind"]) => (kind === "match" ? MatchJudgeSchema : ConsistencyJudgeSchema);

interface MsgLike {
  id?: string;
  model?: string;
  stop_reason?: string | null;
  stop_details?: { category?: string | null; explanation?: string | null } | null;
  usage?: Record<string, unknown>;
  content?: { type: string; text?: string }[];
  parsed_output?: unknown;
  _request_id?: string | null;
}

/** Shared stop-reason handling: refusal / truncation are grader errors, never scores. */
function interpret(msg: MsgLike, model: string, batch: boolean, requestId: string | null): TransportResult {
  const meta: JudgeCallMeta = {
    model: msg.model ?? model,
    request_id: requestId,
    message_id: msg.id ?? null,
    usage: msg.usage ?? null,
    batch,
    served_model_mismatch: msg.model && msg.model !== model ? msg.model : null,
  };
  if (msg.stop_reason === "refusal")
    return { ok: false, error: `judge refused (${msg.stop_details?.category ?? "no category"})`, meta };
  if (msg.stop_reason === "max_tokens") return { ok: false, error: "judge output truncated (max_tokens)", meta };
  if (msg.parsed_output != null) return { ok: true, json: msg.parsed_output, meta };
  const text = (msg.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
  try {
    return { ok: true, json: JSON.parse(text), meta };
  } catch {
    return { ok: false, error: "judge output was not valid JSON", meta };
  }
}

export class AnthropicJudgeTransport implements JudgeTransport {
  constructor(
    private client: Anthropic,
    private opts: { pollMs?: number; sleep?: (ms: number) => Promise<void>; log?: (s: string) => void } = {},
  ) {}

  private baseParams(req: JudgeRequest, model: string) {
    return {
      model,
      max_tokens: MAX_TOKENS,
      thinking: { type: "adaptive" as const },
      system: req.system,
      messages: [{ role: "user" as const, content: req.user }],
    };
  }

  async call(req: JudgeRequest, model: string): Promise<TransportResult> {
    try {
      const res = (await this.client.beta.messages.parse({
        ...this.baseParams(req, model),
        output_config: { effort: JUDGE_EFFORT, format: betaZodOutputFormat(schemaFor(req.kind) as never) },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      } as never)) as unknown as MsgLike;
      const requestId = res._request_id ?? null;
      recordUsage(USAGE_PURPOSE, res.model ?? model, res.usage, { request_id: requestId, message_id: res.id ?? null });
      return interpret(res, model, false, requestId);
    } catch (e) {
      return { ok: false, error: `judge API error: ${(e as Error).message}`, meta: null };
    }
  }

  async batch(reqs: JudgeRequest[], model: string): Promise<Record<string, TransportResult>> {
    const sleep = this.opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    const created = await this.client.messages.batches.create({
      requests: reqs.map((r) => ({
        custom_id: r.custom_id,
        params: {
          ...this.baseParams(r, model),
          // The format object's parse() is dropped on the wire; results are parsed by hand below.
          output_config: { effort: JUDGE_EFFORT, format: zodOutputFormat(schemaFor(r.kind) as never) },
        },
      })),
    } as never);
    this.opts.log?.(`  judge batch ${created.id} submitted (${reqs.length} requests); polling…`);
    let status = created.processing_status;
    while (status !== "ended") {
      await sleep(this.opts.pollMs ?? 30_000);
      const b = await this.client.messages.batches.retrieve(created.id);
      status = b.processing_status;
      this.opts.log?.(`  judge batch ${created.id}: ${status} (${b.request_counts.succeeded} done, ${b.request_counts.processing} processing)`);
    }
    const out: Record<string, TransportResult> = {};
    for await (const item of await this.client.messages.batches.results(created.id)) {
      const r = item.result;
      if (r.type === "succeeded") {
        const msg = r.message as unknown as MsgLike;
        recordUsage(`${USAGE_PURPOSE}-batch`, msg.model ?? model, msg.usage, { request_id: created.id, message_id: msg.id ?? null });
        out[item.custom_id] = interpret(msg, model, true, created.id);
      } else {
        out[item.custom_id] = {
          ok: false,
          error: r.type === "errored" ? `batch request errored: ${JSON.stringify(r.error).slice(0, 200)}` : `batch request ${r.type}`,
          meta: null,
        };
      }
    }
    return out;
  }

  async countTokens(req: JudgeRequest, model: string): Promise<number> {
    const res = await this.client.messages.countTokens({
      ...this.baseParams(req, model),
      output_config: { effort: JUDGE_EFFORT, format: zodOutputFormat(schemaFor(req.kind) as never) },
    } as never);
    return res.input_tokens;
  }
}

/** The SDK client, constructed through the repo's provider class (explicit key + base URL; key never logged). */
export async function makeAnthropicClient(): Promise<Anthropic | null> {
  const { providerCredentialsPresent } = await import("@/config/engine");
  if (!providerCredentialsPresent()) return null;
  const { AnthropicProvider } = await import("@/agent/providers/anthropic");
  class EvalProvider extends AnthropicProvider {
    raw(): Anthropic {
      return this.client;
    }
  }
  return new EvalProvider().raw();
}
