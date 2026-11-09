/**
 * The model-driven browser loop (mode: real). Claude picks every action; this file only executes
 * them on the BrowserDriver and reports results back.
 *
 * Tools: [{ type: "browser_toolset_20260801" } via DriverBrowserToolset, custom `record_evidence`].
 * - Member tool_use blocks (toolset_name "browser") run in order through the SDK helper's
 *   toolResult() (echoes toolset_name, renders image / browser_state blocks).
 * - Halt rule: after a failed call in a batch, every later call gets is_error
 *   "Not executed: an earlier action in this turn failed."
 * - record_evidence: the fact's `source` is set HERE from the driver's current URL (fixture:/path?query),
 *   never from model input. A screenshot of that page is saved for the receipt (not sent to the model).
 * - Stops on end_turn, refusal, maxTurns, or 3 identical failures. pause_turn re-sends to continue;
 *   max_tokens without tool calls asks the model to continue concisely.
 * - Prompt caching: breakpoint on the system block (covers tools + system) and a moving breakpoint
 *   on the newest user turn.
 * onStep never receives image bytes or credentials.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { recordUsage } from "@/lib/usage";
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaToolResultBlockParam,
  BetaToolUseBlock,
} from "@anthropic-ai/sdk/resources/beta";
import { z } from "zod";
import type { AgentEvidenceFact, BrowserTaskRequest, BrowserTaskResult } from "@/contracts";
import { fixturePointerFor } from "@/agent/browser/url-policy";
import { DriverBrowserToolset } from "./browser-toolset";

export const NOT_EXECUTED = "Not executed: an earlier action in this turn failed.";

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export type BrowserStopReason = "end_turn" | "refusal" | "max_turns" | "repeated_failures" | "error";

/** BrowserTaskResult plus loop diagnostics (structurally compatible with the frozen contract). */
export interface BrowserLoopResult extends BrowserTaskResult {
  usage: TokenUsage;
  stopReason: BrowserStopReason;
  /** Screenshot paths saved during the run (repo-relative). */
  screenshots: string[];
}

/** An AgentEvidenceFact plus the screenshot saved when it was recorded. */
export type RecordedFact = AgentEvidenceFact & { screenshot: string | null };

/** The slice of the Anthropic client the loop uses (fakeable in tests). */
export interface MessagesClient {
  beta: { messages: { create(params: Record<string, unknown>): Promise<BetaMessage> } };
}

export const RECORD_EVIDENCE_TOOL = {
  name: "record_evidence",
  description:
    "Record one fact you read on the page that is CURRENTLY open in the active tab. The source pointer is taken " +
    "from the browser's current URL at the moment this call runs (calls in one turn run in order), so record facts " +
    "BEFORE navigating away from the page they came from. Use one call per fact. value must be exactly what the " +
    "page shows (a number for numeric fields). Never guess a value you did not read.",
  input_schema: {
    type: "object" as const,
    properties: {
      key: { type: "string", description: "Fact name, e.g. approved_hours" },
      value: { anyOf: [{ type: "number" }, { type: "string" }], description: "The value exactly as shown on the page" },
      subject_ref: {
        type: "object",
        additionalProperties: { type: "string" },
        description: 'Which subject the fact belongs to, e.g. {"employee_id":"E-103","week_ending":"2026-10-18"}',
      },
      note: { type: "string", description: "Short note: where on the page you read it" },
    },
    required: ["key", "value", "subject_ref", "note"],
  },
};

const RecordInput = z.object({
  key: z.string().min(1),
  value: z.union([z.number(), z.string()]),
  subject_ref: z.record(z.string(), z.union([z.string(), z.number()]).transform(String)),
  note: z.string().default(""),
});

const clip = (s: string, n = 300) => (s.length > n ? `${s.slice(0, n)}… (${s.length} chars)` : s);

/** Redact action inputs for tracing: no long free text, never a password-field value. */
function traceInput(name: string, input: unknown): Record<string, unknown> {
  const o = { ...(input as Record<string, unknown>) };
  if (name === "type" && typeof o.text === "string") o.text = `[${o.text.length} chars]`;
  if (name === "form_input" && o.value !== undefined) o.value = "[value redacted in trace]";
  return o;
}

/** Summarize tool_result content for tracing — never image bytes. */
export function summarizeResult(r: BetaToolResultBlockParam): Record<string, unknown> {
  const content = typeof r.content === "string" ? [{ type: "text", text: r.content }] : (r.content ?? []);
  const parts = (content as Array<Record<string, unknown>>).map((b) => {
    if (b.type === "text") return clip(String(b.text ?? ""));
    if (b.type === "image") return "[image omitted]";
    if (b.type === "browser_state") {
      const tabs = (b.tabs as Array<{ url?: string; active?: boolean }> | undefined) ?? [];
      return `[browser_state: ${tabs.map((t) => `${t.active ? "*" : ""}${t.url ?? ""}`).join(", ")}]`;
    }
    return `[${String(b.type)}]`;
  });
  return { is_error: Boolean(r.is_error), content: parts };
}

function addUsage(acc: TokenUsage, u: Partial<Record<keyof TokenUsage, number | null>> | undefined): void {
  if (!u) return;
  acc.input_tokens += u.input_tokens ?? 0;
  acc.output_tokens += u.output_tokens ?? 0;
  acc.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0;
  acc.cache_read_input_tokens += u.cache_read_input_tokens ?? 0;
}

/** Keep exactly one moving cache breakpoint: on the last block of the newest user message. */
function moveCacheBreakpoint(messages: BetaMessageParam[]): void {
  for (const m of messages) {
    if (m.role !== "user" || typeof m.content === "string") continue;
    for (const b of m.content as unknown as Array<Record<string, unknown>>) delete b.cache_control;
  }
  const last = messages[messages.length - 1];
  if (last?.role === "user" && Array.isArray(last.content) && last.content.length > 0) {
    (last.content[last.content.length - 1] as unknown as Record<string, unknown>).cache_control = { type: "ephemeral" };
  }
}

const textOf = (content: BetaContentBlock[]) =>
  content
    .filter((b): b is Extract<BetaContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

export interface BrowserLoopOptions {
  model: string;
  effort: string;
  maxTokens?: number;
}

export async function runBrowserLoop(
  client: MessagesClient | Anthropic,
  opts: BrowserLoopOptions,
  req: BrowserTaskRequest,
): Promise<BrowserLoopResult> {
  const api = client as unknown as MessagesClient;
  const screenshots: string[] = [];
  const toolset = new DriverBrowserToolset(req.driver, {
    allowedOrigins: req.allowedOrigins,
    onScreenshot: (p) => {
      if (p) screenshots.push(p);
    },
  });
  const usage: TokenUsage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  const facts = new Map<string, RecordedFact>();
  const shotBySource = new Map<string, string | null>();
  const failureCounts = new Map<string, number>();
  let model = opts.model;
  let finalText = "";
  let stopReason: BrowserStopReason = "max_turns";
  let turns = 0;

  const system = [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }];
  const tools = [toolset.toJSON(), RECORD_EVIDENCE_TOOL];
  const messages: BetaMessageParam[] = [
    {
      role: "user",
      content: [{ type: "text", text: `${req.task}\n\nStart URL: ${req.startUrl}` }],
    },
  ];

  const recordFailure = (sig: string): boolean => {
    const n = (failureCounts.get(sig) ?? 0) + 1;
    failureCounts.set(sig, n);
    return n >= 3;
  };

  async function handleRecord(block: BetaToolUseBlock): Promise<BetaToolResultBlockParam> {
    const parsed = RecordInput.safeParse(block.input);
    if (!parsed.success) {
      return { type: "tool_result", tool_use_id: block.id, is_error: true, content: `Invalid record_evidence input: ${parsed.error.message}` };
    }
    let url = "";
    try {
      url = await req.driver.currentUrl();
    } catch {
      url = "";
    }
    const source = fixturePointerFor(url);
    if (!source) {
      return { type: "tool_result", tool_use_id: block.id, is_error: true, content: "The active tab is not on a fixture page; navigate to the page that shows this fact first." };
    }
    if (!shotBySource.has(source)) {
      try {
        const shot = await req.driver.screenshot();
        shotBySource.set(source, shot.savedPath);
        if (shot.savedPath) screenshots.push(shot.savedPath);
      } catch {
        shotBySource.set(source, null);
      }
    }
    const { key, value, subject_ref, note } = parsed.data;
    const fact: RecordedFact = { source, key, value, subject_ref, note, screenshot: shotBySource.get(source) ?? null };
    const dedupeKey = `${key}|${JSON.stringify(Object.entries(subject_ref).sort())}`;
    facts.set(dedupeKey, fact);
    req.onStep({ kind: "evidence", detail: { ...fact } });
    return { type: "tool_result", tool_use_id: block.id, content: `Recorded ${key}=${JSON.stringify(value)} for ${JSON.stringify(subject_ref)} from ${source}.` };
  }

  loop: while (turns < req.maxTurns) {
    moveCacheBreakpoint(messages);
    const res = await api.beta.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 12000,
      thinking: { type: "adaptive" },
      output_config: { effort: opts.effort },
      system,
      tools,
      messages,
    });
    turns++;
    model = res.model ?? model;
    addUsage(usage, res.usage as unknown as Partial<Record<keyof TokenUsage, number | null>>);
    recordUsage("browser-turn", res.model ?? model, res.usage);
    messages.push({ role: "assistant", content: res.content as unknown as BetaContentBlockParam[] });
    const text = textOf(res.content);
    if (text) {
      finalText = text;
      req.onStep({ kind: "text", detail: { turn: turns, text: clip(text, 600) } });
    }
    req.onStep({ kind: "result", detail: { turn: turns, stop_reason: res.stop_reason, usage: res.usage ?? null } });

    const toolUses = res.content.filter((b): b is BetaToolUseBlock => b.type === "tool_use");
    switch (res.stop_reason) {
      case "refusal": {
        const sd = (res as unknown as { stop_details?: { category?: string | null } | null }).stop_details;
        finalText = `Model declined the task (category: ${sd?.category ?? "unknown"}).`;
        stopReason = "refusal";
        break loop;
      }
      case "pause_turn":
        continue loop; // server paused a long turn: re-send as is to let it continue
      case "end_turn":
      case "stop_sequence":
        if (toolUses.length === 0) {
          stopReason = "end_turn";
          break loop;
        }
        break;
      case "max_tokens":
        if (toolUses.length === 0) {
          messages.push({ role: "user", content: [{ type: "text", text: "Your last response was cut off. Continue the task; be concise." }] });
          continue loop;
        }
        break;
      default:
        break;
    }

    // Execute the batch in order, applying the halt rule.
    const results: BetaToolResultBlockParam[] = [];
    let failed = false;
    let stopForRepeats = false;
    for (const block of toolUses) {
      if (failed) {
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          ...(block.toolset_name ? { toolset_name: block.toolset_name } : {}),
          is_error: true,
          content: NOT_EXECUTED,
        });
        continue;
      }
      req.onStep({ kind: "action", detail: { turn: turns, tool: block.toolset_name ? `${block.toolset_name}.${block.name}` : block.name, input: traceInput(block.name, block.input) } });
      let r: BetaToolResultBlockParam;
      if (block.toolset_name === "browser") {
        r = await toolset.toolResult(block);
      } else if (block.name === "record_evidence") {
        r = await handleRecord(block);
      } else {
        r = { type: "tool_result", tool_use_id: block.id, is_error: true, content: `Unknown tool "${block.name}".` };
      }
      req.onStep({ kind: "result", detail: { turn: turns, tool: block.name, ...summarizeResult(r) } });
      results.push(r);
      if (r.is_error) {
        failed = true;
        const errText = JSON.stringify(summarizeResult(r).content).slice(0, 200);
        if (recordFailure(`${block.name}|${JSON.stringify(block.input)}|${errText}`)) stopForRepeats = true;
      }
    }
    messages.push({ role: "user", content: results as unknown as BetaContentBlockParam[] });
    if (stopForRepeats) {
      stopReason = "repeated_failures";
      finalText = finalText || "Stopped after 3 identical failed actions.";
      break;
    }
  }

  return { facts: [...facts.values()], finalText, turns, model, usage, stopReason, screenshots };
}
