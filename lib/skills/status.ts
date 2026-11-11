/**
 * setSkillStatus: rewrite a version's skill.json with a new status (and the eval run that decided it), validated
 * against SkillVersionSchema and written atomically (temp file + rename). Promotion to active is the evals lane's
 * call: it uses this plus lib/pillars setActiveSkill.
 */
import fs from "node:fs";
import path from "node:path";
import { SkillVersionSchema, type SkillVersion } from "@/contracts";
import { PP } from "@/lib/pillars";

export function setSkillStatus(
  skillId: string,
  version: number,
  status: SkillVersion["status"],
  evalRunId?: string | null,
  opts: { skillsRoot?: string } = {},
): SkillVersion {
  const file = path.join(opts.skillsRoot ?? PP.skills, skillId, `v${version}`, "skill.json");
  if (!fs.existsSync(file)) throw new Error(`no skill.json for ${skillId} v${version}`);
  const current = SkillVersionSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
  const next = SkillVersionSchema.parse({ ...current, status, eval_run_id: evalRunId === undefined ? current.eval_run_id : evalRunId });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n");
  fs.renameSync(tmp, file);
  return next;
}
