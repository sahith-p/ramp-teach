/**
 * Anthropic adapter for the AIProvider boundary (contracts/engine.ts).
 * Phase 0 (orchestrator) wrote generateStructured; agent-builder owns this file from T-21 on.
 * runBrowserTask runs the browser_toolset_20260801 loop in ./browser-loop.ts.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type {
  AIProvider,
  BrowserTaskRequest,
  StructuredRequest,
  StructuredResult,
} from "@/contracts";
import { anthropicBaseUrl, engineConfig, resolveAnthropicKey } from "@/config/engine";
import { recordUsage } from "@/lib/usage";
import { runBrowserLoop, type BrowserLoopResult } from "./browser-loop";

export class ProviderRefusalError extends Error {
  constructor(public category: string | null, public explanation: string | null) {
    super(`Model declined the request (category: ${category ?? "unknown"})`);
  }
}

export class AnthropicProvider implements AIProvider {
  readonly id = "anthropic";
  readonly model: string;
  protected client: Anthropic;

  constructor(opts: { model?: string } = {}) {
    this.model = opts.model ?? engineConfig.model;
    const cred = resolveAnthropicKey();
    if (!cred) throw new Error("No Anthropic credentials (RAMP_ANTHROPIC_API_KEY / ANTHROPIC_API_KEY / $HOME/ramp-teach.env)");
    // Key and base URL passed explicitly; the key is never logged.
    this.client = new Anthropic({ apiKey: cred.key, baseURL: anthropicBaseUrl });
  }

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const res = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: req.maxTokens ?? 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: engineConfig.effort, format: betaZodOutputFormat(req.schema as never) },
      // Refusal fallback opt-in: on a safety decline the API retries on a recommended model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: req.system,
      messages: [{ role: "user", content: req.prompt }],
    } as never);
    const msg = res as unknown as {
      stop_reason: string;
      stop_details?: { category?: string | null; explanation?: string | null } | null;
      parsed_output: unknown;
      model: string;
      usage?: Record<string, unknown>;
      id?: string;
      _request_id?: string | null;
    };
    const ids = { request_id: msg._request_id ?? null, message_id: msg.id ?? null };
    recordUsage("structured", msg.model ?? this.model, msg.usage, ids);
    if (msg.stop_reason === "refusal") {
      throw new ProviderRefusalError(msg.stop_details?.category ?? null, msg.stop_details?.explanation ?? null);
    }
    if (msg.stop_reason === "max_tokens") throw new Error("Structured output truncated (max_tokens)");
    if (msg.parsed_output == null) throw new Error("Structured output failed to parse");
    // Re-validate against the caller's (frozen) schema.
    const output = req.schema.parse(msg.parsed_output);
    // The ids ride along in `usage` (the frozen StructuredResult has no other slot) so the learn and
    // synthesis traces record which API request produced them.
    return { output, model: msg.model, usage: msg.usage ? { ...msg.usage, ...ids } : msg.usage };
  }

  /**
   * Model-driven browser loop over the BrowserDriver (mode: real). See ./browser-loop.ts.
   * Streams every turn (task budget, progress notes via thinking display "updates", refusal fallback).
   * `req` may carry the BrowserLoopRequest extras (hooks, step screenshots, task budget); they pass through.
   * Returns a BrowserLoopResult (BrowserTaskResult + usage, stopReason, screenshots, notes).
   */
  async runBrowserTask(req: BrowserTaskRequest): Promise<BrowserLoopResult> {
    return runBrowserLoop(this.client, { model: this.model, effort: engineConfig.effort }, req);
  }
}
