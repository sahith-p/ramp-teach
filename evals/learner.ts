/**
 * Adapter to the skill learner (learn/skill/index.ts, `learnSkill: LearnSkillFn`), built by the skill lane in
 * parallel. Loaded dynamically so the evals typecheck and test without it; tests inject a fake LearnSkillFn.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { LearnSkillFn } from "@/contracts";
import { ROOT } from "@/lib/paths";

export class LearnerMissingError extends Error {}

const CANDIDATES = ["learn/skill/index.ts", "learn/skill/index.js"];

export async function loadLearner(root: string = ROOT): Promise<LearnSkillFn> {
  const file = CANDIDATES.map((f) => path.join(root, f)).find((f) => fs.existsSync(f));
  if (!file) {
    throw new LearnerMissingError(
      "The skill learner is not in this checkout (expected learn/skill/index.ts exporting learnSkill: LearnSkillFn, " +
        "from the skill lane). Merge it first, or run the graders' tests (npx vitest run lib/evals evals), which use a fake learner.",
    );
  }
  const mod = (await import(pathToFileURL(file).href)) as { learnSkill?: unknown; default?: unknown };
  const fn = mod.learnSkill ?? (mod.default as { learnSkill?: unknown } | undefined)?.learnSkill ?? mod.default;
  if (typeof fn !== "function") {
    throw new LearnerMissingError(`${path.relative(root, file)} does not export learnSkill (LearnSkillFn).`);
  }
  return fn as LearnSkillFn;
}
