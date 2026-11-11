import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import spansJson from "../__samples__/spans.json";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "dash-teach-"));
type Server = typeof import("./server");
let S: Server;

const write = (rel: string, data: unknown) => {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, typeof data === "string" ? data : JSON.stringify(data));
};

beforeAll(async () => {
  vi.stubEnv("RAMP_TEACH_ROOT", root);
  vi.resetModules();
  write("runs/INV-1/spans.jsonl", spansJson.map((s) => JSON.stringify(s)).join("\n") + "\n");
  write("runs/INV-1/route.json", {
    invoice_id: "INV-1",
    decided_at: "2026-11-11T02:07:58.000Z",
    workflow_id: "wf-a",
    version: 2,
    confidence: 0.9,
    reason: "matches",
    candidates: [],
    mode: "real",
    model: null,
    request_id: null,
  });
  write("runs/INV-1/crops/a.png", "png");
  write("runs/INV-2/secret.txt", "no");
  write("runs/INV-1/live/status.json", { running: true, url: "http://localhost:3000/portal", updated_at: "2020-01-01T00:00:00.000Z" });
  S = await import("./server");
});

afterAll(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("run readers", () => {
  it("lists runs per workflow with totals", () => {
    const runs = S.listRuns("wf-a");
    expect(runs.map((r) => r.invoice_id)).toEqual(["INV-1"]);
    expect(runs[0].turns).toBeGreaterThan(0);
    expect(S.listRuns("other")).toEqual([]);
  });
  it("a stale running status without a live agent job is not running", () => {
    const st = S.readLiveStatus("INV-1");
    expect(st.running).toBe(false);
    expect(st.url).toBe("http://localhost:3000/portal");
    expect(st.has_frame).toBe(false);
  });
  it("a fresh running status is running", () => {
    write("runs/INV-1/live/status.json", { running: true, updated_at: new Date().toISOString() });
    expect(S.readLiveStatus("INV-1").running).toBe(true);
  });
  it("serves only images under the run's own folder", () => {
    expect(S.resolveRunImage("INV-1", "runs/INV-1/crops/a.png")).toBe(path.join(root, "runs/INV-1/crops/a.png"));
    expect(S.resolveRunImage("INV-1", "runs/INV-2/secret.txt")).toBeNull();
    expect(S.resolveRunImage("INV-1", "runs/INV-1/../INV-2/secret.txt")).toBeNull();
    expect(S.resolveRunImage("INV-1", "data/vendor.json")).toBeNull();
    expect(S.resolveRunImage("../x", "runs/../x/a.png")).toBeNull();
  });
});

describe("learn job", () => {
  it("reads stages from the job file while running", () => {
    write("runtime/learn-job.json", {
      status: "running",
      started_at: "2026-11-11T02:00:00.000Z",
      session_id: "rec_1",
      recording_path: "runtime/recordings/rec_1.json",
      operator: "human",
      pid: process.pid,
      stages: [
        { name: "segment", status: "done", started_at: "2026-11-11T02:00:00.000Z", finished_at: "2026-11-11T02:00:02.000Z" },
        { name: "claims", started_at: "2026-11-11T02:00:02.000Z" },
      ],
    });
    const v = S.learnView()!;
    expect(v.status).toBe("running");
    expect(v.stages.map((s) => s.status)).toEqual(["done", "running", "pending", "pending", "pending", "pending"]);
    expect(v.version).toBeNull();
  });
  it("no job file means nothing to show", () => {
    fs.rmSync(path.join(root, "runtime/learn-job.json"));
    expect(S.learnView()).toBeNull();
  });
});
