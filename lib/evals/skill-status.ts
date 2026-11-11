/**
 * Applying the gate to a skill version: status "active" (+ setActiveSkill, + rules/ synced from it so the engine
 * uses it) on pass, "blocked" on failure. Uses the skill lane's setSkillStatus and syncWorkflowSpec.
 */
import type { SkillVersion } from "@/contracts";
import { getSkillVersion, setActiveSkill } from "@/lib/pillars";
import { syncWorkflowSpec } from "@/lib/skills/compat";
import { setSkillStatus } from "@/lib/skills/status";

type Status = SkillVersion["status"];

export interface GateApplyResult {
  status: Status;
  activated: boolean;
  via: "lib/skills/status.ts";
  synced: string[];
}

export async function applyGateToSkill(skillId: string, version: number, passed: boolean, runId: string): Promise<GateApplyResult> {
  const status: Status = passed ? "active" : "blocked";
  setSkillStatus(skillId, version, status, runId);
  let synced: string[] = [];
  if (passed) {
    setActiveSkill(skillId, version);
    const skill = getSkillVersion(skillId, version);
    if (skill) synced = syncWorkflowSpec(skill).files;
  }
  return { status, activated: passed, via: "lib/skills/status.ts", synced };
}
