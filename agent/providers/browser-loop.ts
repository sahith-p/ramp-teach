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
 * - Every turn is streamed (client.beta.messages.stream + finalMessage) because it carries a task budget
 *   (beta task-budgets-2026-03-13, output_config.task_budget; streaming keeps the large max_tokens clear
 *   of HTTP timeouts). The server tracks the countdown; `remaining` is never sent (full history is resent).
 * - Progress notes (beta thinking-display-updates-2026-08-18, thinking.display "updates"): every non-empty
 *   `thinking` block is a short note the model wrote before the tool call it introduces. Notes go to onStep
 *   (kind "note"), to the model-turn hook (span attrs.note) and to the tool hook of the call they introduce.
 *   Thinking blocks are echoed back unchanged with the assistant turn.
 * - Refusal fallback opt-in (beta server-side-fallback-2026-07-01, fallbacks "default"), as elsewhere in the repo.
 * - record_evidence sets eager_input_streaming (client tool on a streamed request); its input is always
 *   validated with Zod before it runs, and no tool of a turn cut off by max_tokens or refusal is executed.
 * - Optional per-action screenshots (D5): <stepScreenshotDir>/step-<n>.png, reported to the tool hook.
 * onStep never receives image bytes or credentials.
 */
import fs from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { APIError } from "@anthropic-ai/sdk";
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
export const NOT_EXECUTED_MAX_TOKENS =
  "Not executed: your response hit max_tokens before this call was complete. Issue it again, more concisely.";

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
  /** Progress notes the model wrote between tool calls, in order. */
  notes: string[];
}

/** An AgentEvidenceFact plus the screenshot saved when it was recorded. */
export type RecordedFact = AgentEvidenceFact & { screenshot: string | null };

/** The slice of the Anthropic client the loop uses (fakeable in tests): a streamed beta request. */
export interface MessagesClient {
  beta: {
    messages: {
      stream(params: Record<string, unknown>): { finalMessage(): Promise<BetaMessage>; readonly request_id?: string | null };
    };
  };
}

/** Beta flags of the browser-loop requests. */
export const BETA_FALLBACK = "server-side-fallback-2026-07-01";
export const BETA_THINKING_UPDATES = "thinking-display-updates-2026-08-18";
export const BETA_TASK_BUDGETS = "task-budgets-2026-03-13";

/** Minimum task budget the API accepts. */
export const MIN_TASK_BUDGET = 20_000;
export const DEFAULT_TASK_BUDGET = 60_000;

/**
 * Task budget for one browser run (tokens the model generates plus the tool results it reads, across
 * the whole loop). RAMP_TEACH_TASK_BUDGET overrides; "0" turns the budget off.
 */
export function defaultTaskBudget(): number | null {
  const raw = process.env.RAMP_TEACH_TASK_BUDGET;
  if (raw === "0") return null;
  const n = Number(raw ?? DEFAULT_TASK_BUDGET);
  return Number.isFinite(n) && n > 0 ? Math.max(MIN_TASK_BUDGET, Math.round(n)) : DEFAULT_TASK_BUDGET;
}

/** Sentinel text of a progress block that stands in for interrupted work (not a real note). */
export const INTERRUPTED_NOTE = "This part of the response was interrupted before it finished.";

export interface ModelTurnInfo {
  turn: number;
  model: string;
  request_id: string | null;
  message_id: string | null;
  usage: Partial<TokenUsage> | null;
  stop_reason: string | null;
  /** Progress notes of this turn, in order. */
  notes: string[];
  start: string;
  end: string;
}

export interface ToolCallInfo {
  turn: number;
  /** Running action counter over the whole run (step-<n>.png). */
  step: number;
  tool: string;
  input: Record<string, unknown>;
  result: Record<string, unknown>;
  is_error: boolean;
  url: string | null;
  /** Repo-relative screenshot taken after the action (or the fact page's screenshot for record_evidence). */
  screenshot: string | null;
  /** The progress note that introduced this call, if any. */
  note: string | null;
  start: string;
  end: string;
}

export interface LoopHooks {
  onModelTurn?(t: ModelTurnInfo): void;
  onToolCall?(c: ToolCallInfo): void;
}

/**
 * BrowserTaskRequest plus optional observability (structurally compatible with the frozen contract:
 * AIProvider.runBrowserTask passes the extra fields through untouched).
 */
export interface BrowserLoopRequest extends BrowserTaskRequest {
  hooks?: LoopHooks;
  /** Absolute dir for step-<n>.png after each browser action; null/undefined ⇒ no step screenshots. */
  stepScreenshotDir?: string | null;
  /** Step screenshot paths are reported relative to this (default: process.cwd()). */
  repoRoot?: string;
  /** Task budget in tokens; undefined ⇒ defaultTaskBudget(); null ⇒ none. */
  taskBudget?: number | null;
}

/** onStep widened with progress notes ("note"). The frozen union has action/result/evidence/text. */
export type LoopStep = Parameters<BrowserTaskRequest["onStep"]>[0] | { kind: "note"; detail: Record<string, unknown> };

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
  // Client tool on a streamed request: its input streams as generated; the loop validates it (RecordInput).
  eager_input_streaming: true,
};

const RecordInput = z.object({
  key: z.string().min(1),
  value: z.union([z.number(), z.string()]),
  subject_ref: z.record(z.string(), z.union([z.string(), z.number()]).transform(String)),
  note: z.string().default(""),
});

const clip = (s: string, n = 300) => (s.length > n ? `${s.slice(0, n)}… (${s.length} chars)` : s);

/** Redact action inputs for tracing: no long free text, never a password-field value. */
export function traceInput(name: string, input: unknown): Record<string, unknown> {
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

/** Non-empty progress notes (thinking blocks under display "updates"), in order. */
export function progressNotes(content: BetaContentBlock[]): string[] {
  return content
    .filter((b): b is Extract<BetaContentBlock, { type: "thinking" }> => b.type === "thinking")
    .map((b) => (b.thinking ?? "").trim())
    .filter((t) => t.length > 0 && t !== INTERRUPTED_NOTE);
}

/** The note that introduces each tool_use block (the nearest non-empty thinking block before it). */
function notesBeforeTools(content: BetaContentBlock[]): Map<string, string> {
  const out = new Map<string, string>();
  let pending: string | null = null;
  for (const b of content) {
    if (b.type === "thinking") {
      const t = (b.thinking ?? "").trim();
      if (t && t !== INTERRUPTED_NOTE) pending = t;
    } else if (b.type === "tool_use") {
      if (pending) out.set(b.id, pending);
      pending = null;
    }
  }
  return out;
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

/** The request body of one browser-loop turn (exported for tests of the request shape). */
export function browserTurnParams(a: {
  model: string;
  effort: string;
  maxTokens?: number;
  taskBudget: number | null;
  system: unknown;
  tools: unknown[];
  messages: BetaMessageParam[];
}): Record<string, unknown> {
  const budget = a.taskBudget == null ? null : Math.max(MIN_TASK_BUDGET, a.taskBudget);
  return {
    model: a.model,
    max_tokens: a.maxTokens ?? 64_000,
    thinking: { type: "adaptive", display: "updates" },
    output_config: budget ? { effort: a.effort, task_budget: { type: "tokens", total: budget } } : { effort: a.effort },
    betas: [BETA_FALLBACK, BETA_THINKING_UPDATES, ...(budget ? [BETA_TASK_BUDGETS] : [])],
    fallbacks: "default",
    system: a.system,
    tools: a.tools,
    messages: a.messages,
  };
}

export async function runBrowserLoop(
  client: MessagesClient | Anthropic,
  opts: BrowserLoopOptions,
  baseReq: BrowserTaskRequest,
): Promise<BrowserLoopResult> {
  const api = client as unknown as MessagesClient;
  const req = baseReq as BrowserLoopRequest;
  const hooks = req.hooks ?? {};
  const emit = req.onStep as (s: LoopStep) => void;
  const taskBudget = req.taskBudget === undefined ? defaultTaskBudget() : req.taskBudget;
  const repoRoot = req.repoRoot ?? process.cwd();
  const screenshots: string[] = [];
  const allNotes: string[] = [];
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
  let step = 0;
  let jsonRetries = 0;

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

  const relPath = (abs: string) => path.relative(repoRoot, abs).split(path.sep).join("/");
  const driverExtras = req.driver as typeof req.driver & { capturePng?: (tabId?: string) => Promise<Buffer> };
  async function stepScreenshot(n: number): Promise<string | null> {
    if (!req.stepScreenshotDir) return null;
    try {
      const png = driverExtras.capturePng ? await driverExtras.capturePng() : (await req.driver.screenshot()).png;
      fs.mkdirSync(req.stepScreenshotDir, { recursive: true });
      const abs = path.join(req.stepScreenshotDir, `step-${n}.png`);
      fs.writeFileSync(abs, png);
      const r = relPath(abs);
      screenshots.push(r);
      return r;
    } catch {
      return null;
    }
  }
  const currentUrl = async (): Promise<string | null> => {
    try {
      return await req.driver.currentUrl();
    } catch {
      return null;
    }
  };

  async function handleRecord(block: BetaToolUseBlock): Promise<BetaToolResultBlockParam> {
    const parsed = RecordInput.safeParse(block.input);
    if (!parsed.success) {
      // Also covers a malformed eager-streamed input: the model sees what it sent and retries.
      return {
        type: "tool_result",
        tool_use_id: block.id,
        is_error: true,
        content: JSON.stringify({ INVALID_JSON: clip(JSON.stringify(block.input ?? null), 500), error: clip(parsed.error.message, 300) }),
      };
    }
    const url = (await currentUrl()) ?? "";
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
    const started = new Date().toISOString();
    let res: BetaMessage;
    let requestId: string | null = null;
    try {
      const stream = api.beta.messages.stream(
        browserTurnParams({ model: opts.model, effort: opts.effort, maxTokens: opts.maxTokens, taskBudget, system, tools, messages }),
      );
      res = await stream.finalMessage();
      requestId = stream.request_id ?? null;
    } catch (e) {
      // Eager input streaming: tool input the SDK cannot parse at all rejects finalMessage(). Re-issue
      // (capped at 2). API errors (auth, rate limit, overload, ...) are not JSON problems and propagate.
      if (e instanceof APIError || jsonRetries >= 2) throw e;
      jsonRetries++;
      req.onStep({ kind: "text", detail: { turn: turns + 1, text: `Re-issuing the turn after a stream parse error: ${clip(e instanceof Error ? e.message : String(e), 200)}` } });
      continue loop;
    }
    turns++;
    model = res.model ?? model;
    addUsage(usage, res.usage as unknown as Partial<Record<keyof TokenUsage, number | null>>);
    const ids = { request_id: requestId ?? (res as unknown as { _request_id?: string | null })._request_id ?? null, message_id: res.id ?? null };
    recordUsage("browser-turn", res.model ?? model, res.usage, ids);
    messages.push({ role: "assistant", content: res.content as unknown as BetaContentBlockParam[] });
    const notes = progressNotes(res.content);
    allNotes.push(...notes);
    for (const note of notes) emit({ kind: "note", detail: { turn: turns, note: clip(note, 600) } });
    hooks.onModelTurn?.({
      turn: turns,
      model: res.model ?? model,
      ...ids,
      usage: (res.usage as unknown as Partial<TokenUsage>) ?? null,
      stop_reason: res.stop_reason ?? null,
      notes,
      start: started,
      end: new Date().toISOString(),
    });
    const text = textOf(res.content);
    if (text) {
      finalText = text;
      req.onStep({ kind: "text", detail: { turn: turns, text: clip(text, 600) } });
    }
    req.onStep({ kind: "result", detail: { turn: turns, stop_reason: res.stop_reason, usage: res.usage ?? null, ...ids } });
    const noteFor = notesBeforeTools(res.content);

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
        // A tool input cut off by max_tokens can still parse as a partial object: never run that turn's tools.
        messages.push({
          role: "user",
          content: toolUses.map((b) => ({
            type: "tool_result",
            tool_use_id: b.id,
            ...(b.toolset_name ? { toolset_name: b.toolset_name } : {}),
            is_error: true,
            content: NOT_EXECUTED_MAX_TOKENS,
          })) as unknown as BetaContentBlockParam[],
        });
        continue loop;
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
      const toolName = block.toolset_name ? `${block.toolset_name}.${block.name}` : block.name;
      const input = traceInput(block.name, block.input);
      req.onStep({ kind: "action", detail: { turn: turns, tool: toolName, input } });
      const callStart = new Date().toISOString();
      step++;
      let r: BetaToolResultBlockParam;
      let shot: string | null = null;
      if (block.toolset_name === "browser") {
        const before = screenshots.length;
        r = await toolset.toolResult(block);
        if (block.name === "screenshot" || block.name === "zoom") shot = screenshots.length > before ? screenshots[screenshots.length - 1] : null;
        else if (!r.is_error) shot = await stepScreenshot(step);
      } else if (block.name === "record_evidence") {
        r = await handleRecord(block);
        const src = fixturePointerFor((await currentUrl()) ?? "");
        shot = src && !r.is_error ? (shotBySource.get(src) ?? null) : null;
      } else {
        r = { type: "tool_result", tool_use_id: block.id, is_error: true, content: `Unknown tool "${block.name}".` };
      }
      const summary = summarizeResult(r);
      req.onStep({ kind: "result", detail: { turn: turns, tool: block.name, ...summary } });
      hooks.onToolCall?.({
        turn: turns,
        step,
        tool: toolName,
        input,
        result: summary,
        is_error: Boolean(r.is_error),
        url: await currentUrl(),
        screenshot: shot,
        note: noteFor.get(block.id) ?? null,
        start: callStart,
        end: new Date().toISOString(),
      });
      results.push(r);
      if (r.is_error) {
        failed = true;
        const errText = JSON.stringify(summary.content).slice(0, 200);
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

  return { facts: [...facts.values()], finalText, turns, model, usage, stopReason, screenshots, notes: allNotes };
}
