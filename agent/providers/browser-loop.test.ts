import { describe, expect, it } from "vitest";
import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta";
import { NOT_EXECUTED, runBrowserLoop, type MessagesClient } from "./browser-loop";
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
        async create(params) {
          requests.push(JSON.parse(JSON.stringify(params)));
          const next = responses.shift();
          if (!next) throw new Error("no more fake responses");
          return next;
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
    ]);
    expect(first.thinking).toEqual({ type: "adaptive" });
    expect(first.output_config).toEqual({ effort: "medium" });
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
