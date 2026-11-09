/**
 * Anthropic adapter for the AIProvider boundary (contracts/engine.ts).
 * Phase 0 (orchestrator) wrote generateStructured; agent-builder owns this file from T-21 on
 * and implements runBrowserTask with the browser_toolset_20260801 toolset.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type {
  AIProvider,
  BrowserTaskRequest,
  BrowserTaskResult,
  StructuredRequest,
  StructuredResult,
} from "@/contracts";
import { anthropicBaseUrl, engineConfig, resolveAnthropicKey } from "@/config/engine";

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
    };
    if (msg.stop_reason === "refusal") {
      throw new ProviderRefusalError(msg.stop_details?.category ?? null, msg.stop_details?.explanation ?? null);
    }
    if (msg.stop_reason === "max_tokens") throw new Error("Structured output truncated (max_tokens)");
    if (msg.parsed_output == null) throw new Error("Structured output failed to parse");
    // Re-validate against the caller's (frozen) schema.
    const output = req.schema.parse(msg.parsed_output);
    return { output, model: msg.model, usage: msg.usage };
  }

  async runBrowserTask(_req: BrowserTaskRequest): Promise<BrowserTaskResult> {
    throw new Error("runBrowserTask not implemented yet (T-21 agent-builder)");
  }
}
