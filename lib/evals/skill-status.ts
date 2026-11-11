/**
 * Applying the gate to a skill version: status "active" (+ setActiveSkill) on pass, "blocked" on failure.
 *
 * The skill lane owns lib/skills/status.ts (setSkillStatus). Until it lands, this minimal local helper patches
 * skills/<id>/v<n>/skill.json itself (validated with SkillVersionSchema). When the lane helper exists it is used for
 * the status and this file only records eval_run_id.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { SkillVersionSchema, type SkillVersion } from "@/contracts";
import { ROOT } from "@/lib/paths";
import { setActiveSkill, skillVersionDir } from "@/lib/pillars";

type Status = SkillVersion["status"];

function patchSkillJson(skillId: string, version: number, patch: Partial<Pick<SkillVersion, "status" | "eval_run_id">>): void {
  const file = path.join(skillVersionDir(skillId, version), "skill.json");
  if (!fs.existsSync(file)) throw new Error(`skills/${skillId}/v${version}/skill.json not found`);
  const cur = SkillVersionSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
  const next = SkillVersionSchema.parse({ ...cur, ...patch });
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
}

async function laneSetStatus(): Promise<((id: string, v: number, s: Status) => unknown) | null> {
  for (const f of ["lib/skills/status.ts", "lib/skills/status.js"]) {
    const abs = path.join(ROOT, f);
    if (!fs.existsSync(abs)) continue;
    const mod = (await import(pathToFileURL(abs).href)) as { setSkillStatus?: (id: string, v: number, s: Status) => unknown };
    if (typeof mod.setSkillStatus === "function") return mod.setSkillStatus;
  }
  return null;
}

export interface GateApplyResult {
  status: Status;
  activated: boolean;
  via: "lib/skills/status.ts" | "local helper";
}

export async function applyGateToSkill(
  skillId: string,
  version: number,
  passed: boolean,
  runId: string,
): Promise<GateApplyResult> {
  const status: Status = passed ? "active" : "blocked";
  const lane = await laneSetStatus();
  if (lane) {
    await lane(skillId, version, status);
    patchSkillJson(skillId, version, { eval_run_id: runId });
  } else {
    patchSkillJson(skillId, version, { status, eval_run_id: runId });
  }
  if (passed) setActiveSkill(skillId, version);
  return { status, activated: passed, via: lane ? "lib/skills/status.ts" : "local helper" };
}
