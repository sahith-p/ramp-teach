import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jobSetVersion, jobStageEvent, learnProgress, pendingStages, readLearnJob, type LearnJob } from "./learnjob";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ramp-job-"));
const file = path.join(dir, "learn-job.json");
const prev = process.env.RAMP_TEACH_LEARN_JOB;

beforeAll(() => {
  process.env.RAMP_TEACH_LEARN_JOB = file;
});
afterAll(() => {
  if (prev === undefined) delete process.env.RAMP_TEACH_LEARN_JOB;
  else process.env.RAMP_TEACH_LEARN_JOB = prev;
});

describe("learn job progress (runtime/learn-job.json)", () => {
  it("records version and stage status as the learner reports them", () => {
    const job: LearnJob = {
      status: "running",
      started_at: "2026-11-11T00:00:00.000Z",
      session_id: "rec_1",
      recording_path: "runtime/recordings/rec_1.json",
      operator: "human",
      skill_id: "halcyon-invoice-review",
      version: null,
      stages: pendingStages(),
    };
    fs.writeFileSync(file, JSON.stringify(job));
    jobSetVersion("halcyon-invoice-review", 4);
    jobStageEvent({ name: "segment", status: "running", at: "2026-11-11T00:00:01.000Z" });
    jobStageEvent({ name: "segment", status: "done", at: "2026-11-11T00:00:02.000Z", mode: "deterministic" });
    jobStageEvent({ name: "claims", status: "done", at: "2026-11-11T00:00:03.000Z", mode: "real" });
    jobStageEvent({ name: "checks", status: "skipped", at: "2026-11-11T00:00:04.000Z", mode: "deterministic", note: "offline" });
    const j = readLearnJob()!;
    expect(j.version).toBe(4);
    expect(j.stages![0]).toEqual({ name: "segment", status: "done", started_at: "2026-11-11T00:00:01.000Z", finished_at: "2026-11-11T00:00:02.000Z", mode: "deterministic", note: null });
    expect(j.stages!.map((s) => s.status)).toEqual(["done", "done", "pending", "pending", "skipped", "pending"]);
    expect(learnProgress(j)).toEqual([
      "Grouped your steps by page and lined up what you said",
      "Claude listed what you said, quoting your words",
      "Skipped testing checks in a sandbox (offline)",
    ]);
  });

  it("progress lines never contain em dashes", () => {
    const stages = pendingStages().map((s) => ({ ...s, status: "done" as const, mode: "real" as const }));
    const lines = learnProgress({ status: "done", started_at: "x", session_id: "s", recording_path: "r", operator: "human", version: 2, stages });
    expect(lines).toHaveLength(6);
    expect(lines.join(" ")).not.toContain("—");
    expect(lines[5]).toBe("Saved skill version 2 as a draft");
  });
});
