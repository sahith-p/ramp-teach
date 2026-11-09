import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  RecordingSchema,
  WorkflowSpecSchema,
  type AIProvider,
  type StructuredRequest,
  type WorkflowSpec,
} from "@/contracts";
import { buildDistillPrompt, distill, type DistillTraceEvent, type LearnDefinition } from "./distill";

const recording = RecordingSchema.parse(
  JSON.parse(fs.readFileSync(path.resolve(__dirname, "../data/recording.sample.json"), "utf8")),
);

const deterministicSpec: WorkflowSpec = {
  vendor: "Det Vendor",
  proof_sources: [{ app: "App", location: "/x", fields: ["f"] }],
  rules: ["deterministic rule"],
  open_questions: [],
};

// A minimal learn definition: the distiller is generic, no workflow import needed.
const learnDef: LearnDefinition = {
  recordingPath: "data/recording.sample.json",
  specPath: "rules/workflow_spec.json",
  distillHints: "TEST HINTS",
  deterministicDistill: () => deterministicSpec,
};

const realSpec: WorkflowSpec = {
  vendor: "Halcyon Staffing Group",
  proof_sources: [
    { app: "Fixture vendor portal", location: "/portal/employees/<employee_id>?week=<YYYY-MM-DD>", fields: ["approved_hours"] },
  ],
  rules: ["Labor rate must equal the contract rate card."],
  open_questions: ["Is overtime above 40 h billable at 1.5x?"],
};

type FakeProvider = AIProvider & { calls: StructuredRequest<unknown>[] };

function fakeProvider(behavior: "ok" | "throw" | "invalid"): FakeProvider {
  const calls: StructuredRequest<unknown>[] = [];
  return {
    id: "fake",
    model: "fake-model",
    calls,
    async generateStructured<T>(req: StructuredRequest<T>) {
      calls.push(req as StructuredRequest<unknown>);
      if (behavior === "throw") throw Object.assign(new Error("connection refused"), { name: "APIConnectionError" });
      const output = behavior === "invalid" ? { ...realSpec, vendor: "" } : realSpec;
      return { output: output as T, model: "fake-model-served" };
    },
    async runBrowserTask() {
      throw new Error("not used");
    },
  };
}

function collect() {
  const events: DistillTraceEvent[] = [];
  return { events, onTrace: (e: DistillTraceEvent) => events.push(e) };
}

describe("learn/distill", () => {
  it("falls back to deterministic when the provider is null", async () => {
    const { events, onTrace } = collect();
    const r = await distill(recording, learnDef, null, { useCache: false, onTrace });
    expect(r.spec).toEqual(deterministicSpec);
    expect(r.meta.mode).toBe("deterministic");
    expect(r.meta.model).toBeNull();
    expect(r.meta.recording_path).toBe("data/recording.sample.json");
    expect(r.fallbackReason).toBeNull();
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.mode === "deterministic")).toBe(true);
  });

  it("labels the result real only when the provider returns (exactly one call)", async () => {
    const p = fakeProvider("ok");
    const { events, onTrace } = collect();
    const r = await distill(recording, learnDef, p, { useCache: false, onTrace });
    expect(p.calls).toHaveLength(1);
    expect(p.calls[0].prompt).toContain("TEST HINTS");
    expect(r.meta.mode).toBe("real");
    expect(r.meta.model).toBe("fake-model-served");
    expect(WorkflowSpecSchema.parse(r.spec)).toEqual(realSpec);
    expect(events.map((e) => [e.step, e.mode])).toEqual([["distill.real", "real"]]);
  });

  it("falls back to deterministic (never real) when the provider throws", async () => {
    const { events, onTrace } = collect();
    const r = await distill(recording, learnDef, fakeProvider("throw"), { useCache: false, onTrace });
    expect(r.meta.mode).toBe("deterministic");
    expect(r.meta.model).toBeNull();
    expect(r.spec).toEqual(deterministicSpec);
    expect(r.fallbackReason).toMatch(/APIConnectionError/);
    expect(events.some((e) => e.mode === "real")).toBe(false);
    expect(events.map((e) => e.step)).toEqual(["distill.real_failed", "distill.deterministic"]);
  });

  it("falls back when the model output fails WorkflowSpecSchema re-validation", async () => {
    const r = await distill(recording, learnDef, fakeProvider("invalid"), { useCache: false });
    expect(r.meta.mode).toBe("deterministic");
    expect(r.fallbackReason).toBeTruthy();
  });

  it("builds a prompt with the hints and the recording but no secret values", () => {
    const prompt = buildDistillPrompt(recording, learnDef);
    expect(prompt).toContain("TEST HINTS");
    expect(prompt).toContain("/portal/employees/E-104?week=2026-10-11");
    expect(prompt).not.toContain("demo-only");
  });
});
