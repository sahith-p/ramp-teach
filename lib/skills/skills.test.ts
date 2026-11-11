import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LearnMetaSchema, SkillVersionSchema, WorkflowSpecSchema, type SkillRule, type SkillVersion } from "@/contracts";
import { syncWorkflowSpec, workflowSpecFromSkill } from "./compat";
import { diffSkills, similarity } from "./diff";
import { setSkillStatus } from "./status";

const rule = (id: string, text: string, over: Partial<SkillRule> = {}): SkillRule => ({
  id,
  text,
  kind: "check",
  source: "said",
  citations: [{ utterance_id: "u1", quote: text.toLowerCase(), step_index: null, selector: null, url: null }],
  ...over,
});

const base: SkillVersion = SkillVersionSchema.parse({
  skill_id: "halcyon-invoice-review",
  version: 1,
  title: "Halcyon Staffing invoice review",
  created_at: "2026-11-11T00:00:00.000Z",
  mode: "real",
  recordings: ["rec_20261109T085307Z_iwtx"],
  vendor: "Halcyon Staffing Group",
  rules: [
    rule("r1", "Every labor rate must equal the contract rate card."),
    rule("r2", "No employee may be billed twice for the same week."),
    rule("r3", "Line amounts and the total must tie."),
  ],
  portal_map: [
    { page: "/portal/invoices/<invoice_id>", fields: [{ name: "view_timecard", selector: 'a[href^="/portal/employees/"]' }] },
    { page: "/portal/employees/<employee_id>?week=<YYYY-MM-DD>", fields: [{ name: "approved_hours", selector: '[data-field="approved_hours"]' }] },
  ],
  open_questions: ["Is overtime billable at 1.5x?"],
  checks: [],
  stages: [
    { name: "segment", mode: "deterministic", started_at: "a", finished_at: "b", output_path: "x", model: null },
    { name: "synthesize", mode: "real", started_at: "a", finished_at: "b", output_path: "x", model: "claude-opus-5-5", request_id: "req_1" },
  ],
  package_dir: "skills/halcyon-invoice-review/v1",
  anthropic_skill: null,
  status: "draft",
  eval_run_id: null,
});

describe("diffSkills", () => {
  it("reports no change for the same skill", () => {
    const d = diffSkills(base, { ...base, version: 2 });
    expect(d.same).toBe(true);
    expect(d.rules.unchanged).toBe(3);
  });

  it("finds added, removed and changed rules regardless of ids", () => {
    const b: SkillVersion = {
      ...base,
      version: 2,
      rules: [
        rule("r1", "Line amounts and the total must tie."), // moved: unchanged
        rule("r2", "Every labor rate must equal the contract rate card for the role.", { source: "both" }), // edited
        rule("r3", "Billed hours must not exceed approved hours."), // new
      ],
    };
    const d = diffSkills(base, b);
    expect(d.same).toBe(false);
    expect(d.rules.unchanged).toBe(1);
    expect(d.rules.changed).toHaveLength(1);
    expect(d.rules.changed[0].before.text).toBe("Every labor rate must equal the contract rate card.");
    expect(d.rules.changed[0].fields).toEqual(["text", "source", "citations"]);
    expect(d.rules.added.map((r) => r.text)).toEqual(["Billed hours must not exceed approved hours."]);
    expect(d.rules.removed.map((r) => r.text)).toEqual(["No employee may be billed twice for the same week."]);
  });

  it("reports a kind change on identical text", () => {
    const b = { ...base, version: 2, rules: base.rules.map((r, i) => (i === 2 ? { ...r, kind: "procedure" as const } : r)) };
    expect(diffSkills(base, b).rules.changed[0].fields).toEqual(["kind"]);
  });

  it("reports portal map, vendor and open question changes", () => {
    const b: SkillVersion = {
      ...base,
      version: 2,
      vendor: "Halcyon",
      portal_map: [
        { page: "/portal/employees/<employee_id>?week=<YYYY-MM-DD>", fields: [{ name: "approved_hours", selector: '[data-field="approved_hours"]' }, { name: "status", selector: '[data-field="status"]' }] },
        { page: "/portal/invoices", fields: [] },
      ],
      open_questions: ["Do postings need pre-approval?"],
    };
    const d = diffSkills(base, b);
    expect(d.vendor).toEqual({ before: "Halcyon Staffing Group", after: "Halcyon" });
    expect(d.portal_map.pages_added.map((p) => p.page)).toEqual(["/portal/invoices"]);
    expect(d.portal_map.pages_removed.map((p) => p.page)).toEqual(["/portal/invoices/<invoice_id>"]);
    expect(d.portal_map.fields_changed).toEqual([{ page: "/portal/employees/<employee_id>?week=<YYYY-MM-DD>", added: [{ name: "status", selector: '[data-field="status"]' }], removed: [] }]);
    expect(d.open_questions).toEqual({ added: ["Do postings need pre-approval?"], removed: ["Is overtime billable at 1.5x?"] });
  });

  it("similarity is word overlap", () => {
    expect(similarity("a b c", "a b c")).toBe(1);
    expect(similarity("rates must match", "hours must not exceed")).toBeLessThan(0.5);
  });
});

describe("syncWorkflowSpec (compat writer)", () => {
  it("maps the skill onto the frozen WorkflowSpec and LearnMeta", () => {
    const spec = workflowSpecFromSkill(base);
    expect(WorkflowSpecSchema.parse(spec)).toEqual(spec);
    expect(spec.rules).toEqual(base.rules.map((r) => r.text));
    expect(spec.proof_sources.map((p) => p.location)).toEqual([
      "/portal/invoices/<invoice_id>",
      "/portal/employees/<employee_id>?week=<YYYY-MM-DD>",
      "data/vendor.json#contract", // the rules rely on the contract
    ]);
    expect(spec.proof_sources[1].fields).toEqual(["approved_hours"]);
  });

  it("writes rules/workflow_spec.json + rules/learn_meta.json (only from the active version unless told otherwise)", () => {
    const rulesDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramp-rules-"));
    expect(() => syncWorkflowSpec({ ...base, skill_id: "no-such-skill" }, { rulesDir })).toThrow(/not the active/);
    expect(() => syncWorkflowSpec(null, { rulesDir })).toThrow(/no active skill/);
    const { files, meta } = syncWorkflowSpec(base, { rulesDir, allowInactive: true, now: new Date("2026-11-11T00:00:00Z") });
    expect(files.map((f) => path.basename(f))).toEqual(["workflow_spec.json", "learn_meta.json"]);
    const written = LearnMetaSchema.parse(JSON.parse(fs.readFileSync(files[1], "utf8")));
    expect(written).toEqual(meta);
    expect(meta.mode).toBe("real");
    expect(meta.model).toBe("claude-opus-5-5");
    // The recording is found by session id among the known recordings.
    expect(meta.recording_path).toBe("extension/recordings/portal-HSG-1010.json");
    expect(WorkflowSpecSchema.parse(JSON.parse(fs.readFileSync(files[0], "utf8"))).vendor).toBe("Halcyon Staffing Group");
  });

  it("labels a skill learned offline as deterministic", () => {
    const rulesDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramp-rules-"));
    const { meta } = syncWorkflowSpec({ ...base, mode: "deterministic", recordings: ["rec_unknown"] }, { rulesDir, allowInactive: true });
    expect(meta).toMatchObject({ mode: "deterministic", model: null, recording_path: "runtime/recordings/rec_unknown.json" });
  });
});

describe("setSkillStatus", () => {
  it("rewrites skill.json with the new status and eval run, validated", () => {
    const skillsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ramp-skills-"));
    const dir = path.join(skillsRoot, base.skill_id, "v1");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "skill.json"), JSON.stringify(base));
    const out = setSkillStatus(base.skill_id, 1, "active", "eval_x", { skillsRoot });
    expect(out).toMatchObject({ status: "active", eval_run_id: "eval_x" });
    expect(SkillVersionSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, "skill.json"), "utf8")))).toMatchObject({ status: "active", eval_run_id: "eval_x" });
    expect(setSkillStatus(base.skill_id, 1, "blocked", undefined, { skillsRoot }).eval_run_id).toBe("eval_x"); // kept
    expect(fs.readdirSync(dir)).toEqual(["skill.json"]); // no temp files left
    expect(() => setSkillStatus(base.skill_id, 9, "active", null, { skillsRoot })).toThrow(/no skill.json/);
    expect(() => setSkillStatus(base.skill_id, 1, "promoted" as never, null, { skillsRoot })).toThrow();
  });
});
