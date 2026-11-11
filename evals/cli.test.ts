import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseArgs } from "./cli";
import { LearnerMissingError, loadLearner } from "./learner";

const tmp: string[] = [];
const mkTmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "skill-evals-"));
  tmp.push(d);
  return d;
};
afterEach(() => {
  for (const d of tmp.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  delete process.env.RAMP_TEACH_ROOT;
  vi.resetModules();
});

describe("eval:skill CLI args", () => {
  it("parses every flag", () => {
    expect(parseArgs(["--", "--skill", "x", "--version", "3", "--offline", "--sample", "2", "--batch", "--yes", "--case", "a,b", "--apply-gate"])).toEqual({
      skill: "x",
      version: 3,
      offline: true,
      sample: 2,
      cases: ["a", "b"],
      batch: true,
      yes: true,
      applyGate: "force",
    });
    expect(parseArgs([])).toMatchObject({ skill: "halcyon-invoice-review", version: null, yes: false, applyGate: "auto" });
    expect(parseArgs(["--no-gate"]).applyGate).toBe("never");
  });
  it("rejects bad input", () => {
    expect(() => parseArgs(["--version", "0"])).toThrow(/positive/);
    expect(() => parseArgs(["--sample"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--frobnicate"])).toThrow(/Unknown flag/);
  });
});

describe("learner adapter", () => {
  it("fails with a clear message when learn/skill is missing", async () => {
    const root = mkTmp();
    await expect(loadLearner(root)).rejects.toBeInstanceOf(LearnerMissingError);
    await expect(loadLearner(root)).rejects.toThrow(/learn\/skill\/index\.ts exporting learnSkill/);
  });
  it("loads learnSkill from learn/skill/index", async () => {
    const root = mkTmp();
    fs.mkdirSync(path.join(root, "learn", "skill"), { recursive: true });
    fs.writeFileSync(path.join(root, "learn", "skill", "index.js"), "export async function learnSkill(rec) { return { from: rec.session_id }; }\n");
    const fn = await loadLearner(root);
    expect(await fn({ session_id: "s1" } as never)).toEqual({ from: "s1" });
  });
  it("rejects a module without learnSkill", async () => {
    const root = mkTmp();
    fs.mkdirSync(path.join(root, "learn", "skill"), { recursive: true });
    fs.writeFileSync(path.join(root, "learn", "skill", "index.js"), "export const nope = 1;\n");
    await expect(loadLearner(root)).rejects.toThrow(/does not export learnSkill/);
  });
});

describe("gate application (local helper)", () => {
  async function withRoot() {
    const root = mkTmp();
    process.env.RAMP_TEACH_ROOT = root;
    vi.resetModules();
    const { emptySkill } = await import("@/lib/evals/fakes");
    const dir = path.join(root, "skills", "halcyon-invoice-review", "v2");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "skill.json"), JSON.stringify(emptySkill({ version: 2, package_dir: "skills/halcyon-invoice-review/v2" })));
    const mod = await import("@/lib/evals/skill-status");
    const read = () => JSON.parse(fs.readFileSync(path.join(dir, "skill.json"), "utf8"));
    const active = path.join(root, "skills", "halcyon-invoice-review", "active.json");
    return { mod, read, active };
  }
  it("pass: status active, eval_run_id set, version made active", async () => {
    const { mod, read, active } = await withRoot();
    const r = await mod.applyGateToSkill("halcyon-invoice-review", 2, true, "eval_x");
    expect(r).toEqual({ status: "active", activated: true, via: "local helper" });
    expect(read()).toMatchObject({ status: "active", eval_run_id: "eval_x" });
    expect(JSON.parse(fs.readFileSync(active, "utf8"))).toEqual({ version: 2 });
  });
  it("fail: status blocked, active.json untouched", async () => {
    const { mod, read, active } = await withRoot();
    await mod.applyGateToSkill("halcyon-invoice-review", 2, false, "eval_y");
    expect(read()).toMatchObject({ status: "blocked", eval_run_id: "eval_y" });
    expect(fs.existsSync(active)).toBe(false);
  });
  it("missing skill.json is an error", async () => {
    const { mod } = await withRoot();
    await expect(mod.applyGateToSkill("halcyon-invoice-review", 9, true, "e")).rejects.toThrow(/not found/);
  });
});
