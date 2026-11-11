import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SpanSchema } from "@/contracts";
import { costUsd, modelAttrs, readSpansFile, SpanRecorder } from "./spans";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "spans-"));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("SpanRecorder", () => {
  it("resets the file, writes validated spans with parent ids, trace id and duration", async () => {
    const file = path.join(tmp, "runs", "X-1", "spans.jsonl");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "stale line from a previous run\n");
    const rec = new SpanRecorder({ invoiceId: "X-1", traceId: "invoice-review:X-1:T", file });
    rec.reset();
    expect(fs.readFileSync(file, "utf8")).toBe("");

    const run = rec.start("run X-1", "run", "real", null, { base_url: "http://localhost:3000" });
    const child = rec.start("calc.initial", "calc", "deterministic", run.id);
    child.end({ results: { a: "pass" } });
    const again = child.end({ ignored: true }); // idempotent
    expect(again.attrs).not.toHaveProperty("ignored");
    rec.record({
      name: "turn 1",
      kind: "model",
      mode: "real",
      parentId: run.id,
      start: "2026-11-11T00:00:00.000Z",
      end: "2026-11-11T00:00:02.500Z",
      attrs: modelAttrs("claude-opus-5-5", { input_tokens: 1000, output_tokens: 200 }, { request_id: "req_1", message_id: "msg_1" }),
    });
    run.end({ outcome: "receipt" }, "scripted");

    const spans = readSpansFile(file);
    expect(spans.map((s) => s.name)).toEqual(["calc.initial", "turn 1", "run X-1"]); // appended when they end
    for (const s of spans) {
      expect(() => SpanSchema.parse(s)).not.toThrow();
      expect(s.trace_id).toBe("invoice-review:X-1:T");
    }
    expect(spans[0].parent_id).toBe(run.id);
    expect(spans[2]).toMatchObject({ parent_id: null, mode: "scripted", kind: "run" });
    expect(spans[2].attrs).toMatchObject({ base_url: "http://localhost:3000", outcome: "receipt" });
    expect(spans[1].attrs).toMatchObject({ duration_ms: 2500, request_id: "req_1", message_id: "msg_1", input_tokens: 1000, output_tokens: 200 });
    expect(new Set(spans.map((s) => s.span_id)).size).toBe(3);
  });

  it("prices calls with the repo's Opus 5.5 table and returns null for unpriced models", () => {
    expect(costUsd("claude-opus-5-5", { input_tokens: 1_000_000 })).toBe(4);
    expect(costUsd("claude-opus-5-5", { output_tokens: 1_000_000, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000 })).toBe(25.2);
    expect(costUsd("claude-opus-4-8", { input_tokens: 10 })).toBeNull();
    expect(costUsd(null, { input_tokens: 10 })).toBeNull();
  });
});
