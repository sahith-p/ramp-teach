import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { SkillRule } from "@/contracts";
import { fakeClient } from "./__fixtures__/fake-client";
import { packageFiles, renderSkillMd, skillDescription, skillName, uploadSkill } from "./package";

const rules: SkillRule[] = [
  { id: "r1", text: "Every labor rate must equal the contract rate card.", kind: "check", source: "said", citations: [{ utterance_id: "u2", quote: "every labor rate must equal the contract rate card", step_index: 6, selector: null, url: null }] },
  { id: "r2", text: "Read approved hours on each timecard.", kind: "procedure", source: "shown", citations: [{ utterance_id: null, quote: "40", step_index: 13, selector: '[data-field="approved_hours"]', url: null }] },
  { id: "r3", text: "If any check fails, recommend dispute; otherwise approve.", kind: "decision", source: "said", citations: [{ utterance_id: "u8", quote: "If any check fails I recommend dispute", step_index: null, selector: null, url: null }] },
];

const input = {
  skill_id: "halcyon-invoice-review",
  title: "Halcyon Staffing invoice review",
  vendor: "Halcyon Staffing Group",
  version: 3,
  mode: "real",
  rules,
  portal_map: [{ page: "/portal/employees/<employee_id>?week=<YYYY-MM-DD>", fields: [{ name: "approved_hours", selector: '[data-field="approved_hours"]' }] }],
  open_questions: ["Is overtime billable at 1.5x?"],
  checks: [{ name: "line_amounts_correct", file: "skills/halcyon-invoice-review/v3/checks/line_amounts_correct.py" }],
};

/** Minimal YAML frontmatter reader for `key: value` lines (values may be JSON-quoted). */
function frontmatter(md: string): Record<string, string> {
  const m = md.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) throw new Error("no frontmatter");
  return Object.fromEntries(
    m[1].split("\n").map((l) => {
      const i = l.indexOf(": ");
      const v = l.slice(i + 2);
      return [l.slice(0, i), v.startsWith('"') ? JSON.parse(v) : v];
    }),
  );
}

describe("SKILL.md writer", () => {
  const md = renderSkillMd(input);

  it("has Agent Skills frontmatter: name and description within limits", () => {
    const fm = frontmatter(md);
    expect(Object.keys(fm)).toEqual(["name", "description"]);
    expect(fm.name).toBe("halcyon-invoice-review");
    expect(fm.name).toMatch(/^[a-z0-9-]{1,64}$/);
    expect(fm.description.length).toBeGreaterThan(0);
    expect(fm.description.length).toBeLessThanOrEqual(1024);
    expect(fm.description).not.toMatch(/[<>]/);
    expect(fm.description).toContain("Halcyon Staffing Group");
  });

  it("lists rules with their quotes, where to look, the decision rule and the checks", () => {
    expect(md).toContain("## When to use");
    expect(md).toContain('"every labor rate must equal the contract rate card" (u2, step 6)');
    expect(md).toContain("**r2** Read approved hours on each timecard. _(shown)_");
    expect(md).toContain('shown at step 13: `[data-field="approved_hours"]`');
    expect(md).toContain("`/portal/employees/<employee_id>?week=<YYYY-MM-DD>`: approved_hours");
    expect(md).toMatch(/## Decision rule\n\n- \*\*r3\*\* If any check fails/);
    expect(md).toContain("`checks/line_amounts_correct.py` (line_amounts_correct)");
    expect(md).toContain("## Open questions");
  });

  it("sanitizes the skill name and keeps the description one line", () => {
    expect(skillName("Halcyon Invoice_Review!!")).toBe("halcyon-invoice-review");
    expect(skillName("claude-helper")).toBe("x-helper");
    expect(skillName("a".repeat(80))).toHaveLength(64);
    expect(skillDescription({ title: "T\nwith <tags>", vendor: "Not stated in recording", rules: [] })).not.toMatch(/[\n<>]/);
  });
});

describe("Skills API upload", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ramp-pkg-"));
  fs.writeFileSync(path.join(dir, "SKILL.md"), renderSkillMd(input));
  fs.mkdirSync(path.join(dir, "checks"));
  fs.writeFileSync(path.join(dir, "checks", "line_amounts_correct.py"), "def check(i, v, t):\n    return {}\n");
  fs.writeFileSync(path.join(dir, "skill.json"), "{}");

  it("uploads SKILL.md + checks under one top-level folder (skill.json and stages stay local)", () => {
    expect(packageFiles(dir, "halcyon-invoice-review").map((f) => f.upload)).toEqual([
      "halcyon-invoice-review/SKILL.md",
      "halcyon-invoice-review/checks/line_amounts_correct.py",
    ]);
  });

  it("creates the skill the first time, then adds versions to the same skill", async () => {
    const client = fakeClient({});
    const first = await uploadSkill(client, dir, "halcyon-invoice-review", "Halcyon", null);
    expect(first).toEqual({ id: "skill_fake_1", version: "skv_fake_1" });
    expect(client.calls[0]).toEqual({ method: "skills.create", params: { names: ["halcyon-invoice-review/SKILL.md", "halcyon-invoice-review/checks/line_amounts_correct.py"], display_name: "Halcyon" } });
    const next = await uploadSkill(client, dir, "halcyon-invoice-review", "Halcyon", { id: "skill_fake_1" });
    expect(next).toEqual({ id: "skill_fake_1", version: "skv_fake_2" });
    expect(client.calls[1].method).toBe("skills.versions.create");
  });
});
