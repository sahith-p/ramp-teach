/**
 * Compatibility writer: the existing engine (agent/, workflows/invoice-review) reads rules/workflow_spec.json and
 * rules/learn_meta.json. syncWorkflowSpec writes both from the ACTIVE skill version, so the engine keeps working
 * while skills are the source of truth.
 *
 *   rules            rule texts in order
 *   proof_sources    the portal map (path template + field names), plus the vendor contract when rules rely on it
 *   open_questions   as is
 *   learn_meta       mode real when the skill was synthesized by Claude, else deterministic
 */
import fs from "node:fs";
import path from "node:path";
import { LearnMetaSchema, WorkflowSpecSchema, type LearnMeta, type SkillVersion, type WorkflowSpec } from "@/contracts";
import { P } from "@/lib/paths";
import { activeSkillVersion, DEFAULT_SKILL_ID, getActiveSkill, getRecording } from "@/lib/pillars";

const CONTRACT_MENTION = /\b(rate card|contract|allowed list|allowed charges?)\b/i;
export const CONTRACT_SOURCE = { app: "Vendor contract", location: "data/vendor.json#contract", fields: ["rate_card", "allowed_charges"] };

export function workflowSpecFromSkill(skill: SkillVersion): WorkflowSpec {
  const proof_sources = skill.portal_map.map((p) => ({
    app: p.page.startsWith("data/") ? "Vendor contract" : "Vendor portal",
    location: p.page,
    fields: p.fields.map((f) => f.name),
  }));
  if (!proof_sources.some((p) => p.location.startsWith("data/vendor.json")) && skill.rules.some((r) => CONTRACT_MENTION.test(r.text))) {
    proof_sources.push({ ...CONTRACT_SOURCE });
  }
  return WorkflowSpecSchema.parse({
    vendor: skill.vendor,
    proof_sources,
    rules: skill.rules.map((r) => r.text),
    open_questions: skill.open_questions,
  });
}

export function learnMetaFromSkill(skill: SkillVersion, now: Date = new Date()): LearnMeta {
  const sessionId = skill.recordings[0] ?? "unknown";
  let recording_path = `runtime/recordings/${sessionId.replace(/[^A-Za-z0-9_.-]/g, "_")}.json`;
  try {
    recording_path = getRecording(sessionId)?.file ?? recording_path;
  } catch {
    /* keep the default */
  }
  const model = skill.stages.find((s) => s.mode === "real" && s.model)?.model ?? null;
  return LearnMetaSchema.parse({
    mode: skill.mode === "real" ? "real" : "deterministic",
    model: skill.mode === "real" ? model : null,
    recording_path,
    generated_at: now.toISOString(),
  });
}

export interface SyncOptions {
  /** Where to write (default rules/). */
  rulesDir?: string;
  /** Write even if `skill` is not the active version (tests, previews). */
  allowInactive?: boolean;
  now?: Date;
}

/** Write rules/workflow_spec.json + rules/learn_meta.json from the active skill (or the given one, which must be active). */
export function syncWorkflowSpec(skill: SkillVersion | null = getActiveSkill(DEFAULT_SKILL_ID), opts: SyncOptions = {}): { spec: WorkflowSpec; meta: LearnMeta; files: string[] } {
  if (!skill) throw new Error("no active skill to sync from");
  if (!opts.allowInactive && activeSkillVersion(skill.skill_id) !== skill.version) {
    throw new Error(`${skill.skill_id} v${skill.version} is not the active version`);
  }
  const spec = workflowSpecFromSkill(skill);
  const meta = learnMetaFromSkill(skill, opts.now);
  const dir = opts.rulesDir ?? P.rules;
  fs.mkdirSync(dir, { recursive: true });
  const files = [path.join(dir, "workflow_spec.json"), path.join(dir, "learn_meta.json")];
  fs.writeFileSync(files[0], JSON.stringify(spec, null, 2) + "\n");
  fs.writeFileSync(files[1], JSON.stringify(meta, null, 2) + "\n");
  return { spec, meta, files };
}
