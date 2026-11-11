/**
 * Skill-eval case files (evals/cases/*.json). Each file is a SkillEvalCase plus a few extra fields this lane reads:
 * the gold rules' CHECK_NAMES (for replay), the consistency group and the hand-authored provenance note.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { CheckNameSchema, RecordingSchema, SkillEvalCaseSchema, type Recording } from "@/contracts";
import { ROOT } from "@/lib/paths";
import { PP } from "@/lib/pillars";

export const EvalCaseFileSchema = SkillEvalCaseSchema.extend({
  description: z.string().default(""),
  /** CHECK_NAMES the gold rules correspond to: the replay target is built from these. */
  gold_checks: z.array(CheckNameSchema),
  /** Cases sharing a group are different wordings of the same review (consistency eval). */
  consistency_group: z.string().nullable().default(null),
  provenance: z.object({ kind: z.string(), derived_from: z.string(), note: z.string() }),
});
export type EvalCaseFile = z.infer<typeof EvalCaseFileSchema>;

export function loadEvalCaseFiles(dir: string = PP.evalCases): EvalCaseFile[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const file = path.join(dir, f);
      try {
        return EvalCaseFileSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
      } catch (e) {
        throw new Error(`Invalid eval case ${path.relative(ROOT, file)}: ${(e as Error).message}`);
      }
    });
}

export function loadCaseRecording(c: EvalCaseFile, root: string = ROOT): Recording {
  const file = path.join(root, c.recording_path);
  if (!fs.existsSync(file)) throw new Error(`Recording for case ${c.id} not found: ${c.recording_path}`);
  return RecordingSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
}

/**
 * Deterministic sample of K cases: baseline first, then by id. Consistency partners are kept together
 * (so the sample can be larger than K by one).
 */
export function sampleCases(cases: EvalCaseFile[], k: number | null): EvalCaseFile[] {
  if (k == null || k >= cases.length) return cases;
  const ordered = [...cases].sort((a, b) =>
    a.variant === "baseline" ? -1 : b.variant === "baseline" ? 1 : a.id.localeCompare(b.id),
  );
  const picked = new Map<string, EvalCaseFile>();
  for (const c of ordered) {
    if (picked.size >= k) break;
    picked.set(c.id, c);
    if (c.consistency_group) {
      for (const p of cases) if (p.consistency_group === c.consistency_group) picked.set(p.id, p);
    }
  }
  return ordered.filter((c) => picked.has(c.id));
}
