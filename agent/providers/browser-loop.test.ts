import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta";
import {
  BETA_FALLBACK,
  BETA_TASK_BUDGETS,
  BETA_THINKING_UPDATES,
  INTERRUPTED_NOTE,
  NOT_EXECUTED,
  NOT_EXECUTED_MAX_TOKENS,
  browserTurnParams,
  progressNotes,
  runBrowserLoop,
  type BrowserLoopRequest,
  type MessagesClient,
  type ModelTurnInfo,
  type ToolCallInfo,
} from "./browser-loop";
import { FakeDriver } from "@/agent/test-fixtures/fake-driver";
import type { BrowserTaskRequest } from "@/contracts";

const origin = "http://localhost:3000";

type Block = Record<string, unknown>;
const msg = (content: Block[], stop_reason: string): BetaMessage =>
  ({
    id: "msg",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content,
    stop_reason,
    usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 50, cache_read_input_tokens: 10 },
  }) as unknown as BetaMessage;
const member = (id: string, name: string, input: Block): Block => ({ type: "tool_use", id, name, input, toolset_name: "browser" });
const custom = (id: string, name: string, input: Block): Block => ({ type: "tool_use", id, name, input });

/** Fake Anthropic client: returns queued responses and records every request. */
function fakeClient(responses: BetaMessage[]) {
  const requests: Array<Record<string, unknown>> = [];
  const client: MessagesClient = {
    beta: {
      messages: {
        stream(params: Record<string, unknown>) {
          requests.push(JSON.parse(JSON.stringify(params)));
          const next = responses.shift();
          return {
            request_id: next ? `req_${requests.length}` : null,
            async finalMessage() {
              if (!next) throw new Error("no more fake responses");
              return next;
            },
          };
        },
      },
    },
  };
  return { client, requests };
}

function request(driver: FakeDriver, steps: Array<{ kind: string; detail: Record<string, unknown> }>, maxTurns = 10): BrowserTaskRequest {
  return {
    system: "SYSTEM",
    task: "TASK",
    startUrl: `${origin}/portal/login`,
    allowedOrigins: [origin],
    maxTurns,
    driver,
    onStep: (s) => steps.push(s),
  };
}

type ToolResult = { type: string; tool_use_id: string; is_error?: boolean; toolset_name?: string; content: unknown };
const userResults = (req: Record<string, unknown>, idx: number): ToolResult[] =>
  ((req.messages as Array<{ role: string; content: unknown }>)[idx].content as ToolResult[]);

describe("runBrowserLoop (fake client, fake driver — no network)", () => {
  it("applies the halt rule, sets record_evidence source from the driver URL, and ends on end_turn", async () => {
    const driver = new FakeDriver(origin);
    const { client, requests } = fakeClient([
      msg(
        [
          member("a1", "navigate", { url: "https://example.com/" }),
          member("a2", "screenshot", {}),
          custom("a3", "record_evidence", { key: "approved_hours", value: 1, subject_ref: { employee_id: "E-1" }, note: "x" }),
        ],
        "tool_use",
      ),
      msg(
        [
          member("b1", "navigate", { url: "/portal/employees/E-104?week=2026-10-18" }),
          custom("b2", "record_evidence", {
            key: "approved_hours",
            value: 38,
            subject_ref: { employee_id: "E-104", week_ending: "2026-10-18" },
            note: "Approved hours field",
          }),
        ],
        "tool_use",
      ),
      msg([{ type: "text", text: "Recorded 38 h for E-104." }], "end_turn"),
    ]);
    const steps: Array<{ kind: string; detail: Record<string, unknown> }> = [];
    const res = await runBrowserLoop(client, { model: "claude-opus-5-5", effort: "medium" }, request(driver, steps));

    expect(res.turns).toBe(3);
    expect(res.stopReason).toBe("end_turn");
    expect(res.finalText).toContain("38 h");

    // Turn 1: external navigate refused; the later calls in the batch are not executed.
    const t1 = userResults(requests[1], 2);
    expect(t1.map((r) => r.tool_use_id)).toEqual(["a1", "a2", "a3"]);
    expect(t1[0].is_error).toBe(true);
    expect(t1[0].toolset_name).toBe("browser");
    expect(t1[1]).toMatchObject({ is_error: true, content: NOT_EXECUTED, toolset_name: "browser" });
    expect(t1[2]).toMatchObject({ is_error: true, content: NOT_EXECUTED });
    expect(t1[2].toolset_name).toBeUndefined();
    // Only one screenshot ever ran: the evidence snapshot in turn 2 (turn 1's screenshot was halted).
    expect(driver.shots).toBe(1);

    // Turn 2: the fact's source comes from the driver's current URL, not from model input.
    expect(res.facts).toHaveLength(1);
    expect(res.facts[0]).toMatchObject({
      source: "fixture:/portal/employees/E-104?week=2026-10-18",
      key: "approved_hours",
      value: 38,
      subject_ref: { employee_id: "E-104", week_ending: "2026-10-18" },
    });
    expect((res.facts[0] as { screenshot?: string }).screenshot).toMatch(/^runs\/TEST\/screenshots\//);

    // Request shape: browser toolset + record_evidence, adaptive thinking, cached system prefix.
    const first = requests[0];
    expect((first.tools as Array<{ type?: string; name?: string }>).map((t) => t.type ?? t.name)).toEqual([
      "browser_toolset_20260801",
      "record_evidence",
      "sign_in",
    ]);
    expect(first.thinking).toEqual({ type: "adaptive", display: "updates" });
    expect(first.output_config).toEqual({ effort: "medium", task_budget: { type: "tokens", total: 60000 } });
    expect((first.system as Array<{ cache_control?: unknown }>)[0].cache_control).toEqual({ type: "ephemeral" });

    // Usage accumulates; onStep never sees image bytes.
    expect(res.usage).toEqual({ input_tokens: 300, output_tokens: 60, cache_creation_input_tokens: 150, cache_read_input_tokens: 30 });
    expect(JSON.stringify(steps)).not.toContain(Buffer.from("PNGDATA").toString("base64"));
    expect(steps.some((s) => s.kind === "evidence")).toBe(true);
  });

  it("stops after 3 identical failures", async () => {
    const driver = new FakeDriver(origin);
    const bad = () => msg([member(`x${Math.random()}`, "left_click", { target: { type: "ref", ref: "ref_404" } })], "tool_use");
    const { client } = fakeClient([bad(), bad(), bad(), bad(), bad()]);
    const res = await runBrowserLoop(client, { model: "m", effort: "low" }, request(driver, []));
    expect(res.stopReason).toBe("repeated_failures");
    expect(res.turns).toBe(3);
  });

  it("respects maxTurns, re-sends on pause_turn, and stops on refusal", async () => {
    const driver = new FakeDriver(origin);
    const nav = (id: string) => msg([member(id, "get_page_text", {})], "tool_use");
    const capped = await runBrowserLoop(fakeClient([nav("1"), nav("2"), nav("3")]).client, { model: "m", effort: "low" }, request(driver, [], 2));
    expect(capped).toMatchObject({ turns: 2, stopReason: "max_turns" });

    const { client, requests } = fakeClient([msg([{ type: "text", text: "working" }], "pause_turn"), msg([{ type: "text", text: "done" }], "end_turn")]);
    const paused = await runBrowserLoop(client, { model: "m", effort: "low" }, request(driver, []));
    expect(paused).toMatchObject({ turns: 2, stopReason: "end_turn", finalText: "done" });
    const msgs = requests[1].messages as Array<{ role: string }>;
    expect(msgs[msgs.length - 1].role).toBe("assistant"); // continued without a new user turn

    const refused = await runBrowserLoop(
      fakeClient([{ ...msg([], "refusal"), stop_details: { category: "cyber" } } as unknown as BetaMessage]).client,
      { model: "m", effort: "low" },
      request(driver, []),
    );
    expect(refused.stopReason).toBe("refusal");
    expect(refused.finalText).toContain("cyber");
  });
});

describe("browser loop: progress notes, task budget, step screenshots (fake client)", () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
    delete process.env.RAMP_TEACH_TASK_BUDGET;
  });
  const thinking = (text: string): Block => ({ type: "thinking", thinking: text, signature: "sig" });

  it("builds the streamed request: display updates, task budget, refusal fallback", () => {
    const p = browserTurnParams({ model: "claude-opus-5-5", effort: "medium", taskBudget: 60000, system: [], tools: [{ name: "x" }], messages: [] });
    expect(p).toMatchObject({
      model: "claude-opus-5-5",
      max_tokens: 64000,
      thinking: { type: "adaptive", display: "updates" },
      output_config: { effort: "medium", task_budget: { type: "tokens", total: 60000 } },
      fallbacks: "default",
    });
    expect(p.betas).toEqual([BETA_FALLBACK, BETA_THINKING_UPDATES, BETA_TASK_BUDGETS]);
    expect((p.output_config as { task_budget: Record<string, unknown> }).task_budget).not.toHaveProperty("remaining");
    // Below the API minimum it is raised to 20k; null turns the budget (and its beta) off.
    expect(browserTurnParams({ model: "m", effort: "low", taskBudget: 5000, system: [], tools: [], messages: [] }).output_config).toEqual({
      effort: "low",
      task_budget: { type: "tokens", total: 20000 },
    });
    const off = browserTurnParams({ model: "m", effort: "low", taskBudget: null, system: [], tools: [], messages: [] });
    expect(off.output_config).toEqual({ effort: "low" });
    expect(off.betas).toEqual([BETA_FALLBACK, BETA_THINKING_UPDATES]);
  });

  it("uses the request's task budget, or RAMP_TEACH_TASK_BUDGET, on every turn; record_evidence streams eagerly", async () => {
    process.env.RAMP_TEACH_TASK_BUDGET = "45000";
    const driver = new FakeDriver(origin);
    const a = fakeClient([msg([{ type: "text", text: "done" }], "end_turn")]);
    await runBrowserLoop(a.client, { model: "m", effort: "low" }, request(driver, []));
    expect((a.requests[0].output_config as { task_budget: { total: number } }).task_budget.total).toBe(45000);
    const tools = a.requests[0].tools as Array<{ name?: string; eager_input_streaming?: boolean }>;
    expect(tools.find((t) => t.name === "record_evidence")?.eager_input_streaming).toBe(true);

    const b = fakeClient([msg([{ type: "text", text: "done" }], "end_turn")]);
    await runBrowserLoop(b.client, { model: "m", effort: "low" }, { ...request(driver, []), taskBudget: 30000 } as BrowserLoopRequest);
    expect((b.requests[0].output_config as { task_budget: { total: number } }).task_budget.total).toBe(30000);
  });

  it("captures progress notes into onStep, the turn hook and the tool hook; writes step screenshots", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loop-"));
    tmpDirs.push(dir);
    const driver = new FakeDriver(origin);
    const { client, requests } = fakeClient([
      msg(
        [
          thinking(""), // reasoning (hidden under "updates")
          thinking("Signing in, then opening Sam's timecard."),
          member("n1", "navigate", { url: "/portal/employees/E-104?week=2026-10-18" }),
          thinking("On the timecard page; recording the approved hours."),
          custom("n2", "record_evidence", { key: "approved_hours", value: 38, subject_ref: { employee_id: "E-104", week_ending: "2026-10-18" }, note: "field" }),
        ],
        "tool_use",
      ),
      msg([thinking(INTERRUPTED_NOTE), { type: "text", text: "Recorded." }], "end_turn"),
    ]);
    const steps: Array<{ kind: string; detail: Record<string, unknown> }> = [];
    const turnsSeen: ModelTurnInfo[] = [];
    const calls: ToolCallInfo[] = [];
    const req: BrowserLoopRequest = {
      ...request(driver, steps),
      stepScreenshotDir: path.join(dir, "screenshots"),
      repoRoot: dir,
      hooks: { onModelTurn: (m) => turnsSeen.push(m), onToolCall: (c) => calls.push(c) },
    };
    const res = await runBrowserLoop(client, { model: "claude-opus-5-5", effort: "medium" }, req);

    expect(res.notes).toEqual(["Signing in, then opening Sam's timecard.", "On the timecard page; recording the approved hours."]);
    expect(steps.filter((s) => s.kind === "note").map((s) => s.detail.note)).toEqual(res.notes);
    expect(turnsSeen[0]).toMatchObject({ turn: 1, request_id: "req_1", message_id: "msg", stop_reason: "tool_use", notes: res.notes });
    expect(turnsSeen[0].usage).toMatchObject({ input_tokens: 100, output_tokens: 20 });
    expect(turnsSeen[1].notes).toEqual([]); // the interrupted-work sentinel is not a note

    expect(calls.map((c) => [c.tool, c.step, c.note])).toEqual([
      ["browser.navigate", 1, "Signing in, then opening Sam's timecard."],
      ["record_evidence", 2, "On the timecard page; recording the approved hours."],
    ]);
    expect(calls[0].screenshot).toBe("screenshots/step-1.png");
    expect(fs.existsSync(path.join(dir, "screenshots", "step-1.png"))).toBe(true);
    expect(calls[0].url).toBe(`${origin}/portal/employees/E-104?week=2026-10-18`);
    expect(calls[1].screenshot).toMatch(/^runs\/TEST\/screenshots\//); // the fact page's evidence screenshot

    // Thinking blocks (progress notes included) are echoed back unchanged.
    const echoed = (requests[1].messages as Array<{ role: string; content: Block[] }>)[1];
    expect(echoed.role).toBe("assistant");
    expect(echoed.content.filter((b) => b.type === "thinking")).toHaveLength(3);
    expect(progressNotes(echoed.content as never)).toEqual(res.notes);
  });

  it("never executes tools of a turn cut off by max_tokens", async () => {
    const driver = new FakeDriver(origin);
    const { client, requests } = fakeClient([
      msg([member("m1", "navigate", { url: "/portal/invoices" }), custom("m2", "record_evidence", { key: "approved_hours" })], "max_tokens"),
      msg([{ type: "text", text: "ok" }], "end_turn"),
    ]);
    const res = await runBrowserLoop(client, { model: "m", effort: "low" }, request(driver, []));
    expect(res.stopReason).toBe("end_turn");
    expect(driver.calls.filter((c) => c[0] === "navigate")).toHaveLength(0);
    const results = userResults(requests[1], 2);
    expect(results.map((r) => [r.tool_use_id, r.is_error, r.content])).toEqual([
      ["m1", true, NOT_EXECUTED_MAX_TOKENS],
      ["m2", true, NOT_EXECUTED_MAX_TOKENS],
    ]);
    expect(results[0].toolset_name).toBe("browser");
  });

  it("answers an invalid record_evidence input with an INVALID_JSON error instead of running it", async () => {
    const driver = new FakeDriver(origin);
    const { client, requests } = fakeClient([
      msg([custom("v1", "record_evidence", { key: "approved_hours", subject_ref: { employee_id: "E-1" } })], "tool_use"),
      msg([{ type: "text", text: "ok" }], "end_turn"),
    ]);
    const res = await runBrowserLoop(client, { model: "m", effort: "low" }, request(driver, []));
    expect(res.facts).toHaveLength(0);
    const r = userResults(requests[1], 2)[0];
    expect(r.is_error).toBe(true);
    expect(JSON.parse(String(r.content))).toHaveProperty("INVALID_JSON");
  });
});
