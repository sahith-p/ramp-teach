/**
 * `npm run skill:learn -- --recording <file> [--offline] [--no-persist] [--no-checks] [--job]`
 *
 * Learns a new draft version of the invoice-review skill from one recording and prints a summary.
 *   --recording <file>  repo-relative or absolute Recording JSON (default: extension/recordings/portal-HSG-1010.json)
 *   --offline           no API call: deterministic distiller, checks skipped, no upload (labeled deterministic)
 *   --no-persist        learn into a temp dir (no new version under skills/, no upload)
 *   --no-checks         skip the code-execution checks stage
 *   --job               report live stage progress to runtime/learn-job.json (used by lib/learnjob.ts)
 * Never promotes the version: the evals lane does that (lib/pillars setActiveSkill).
 */
import fs from "node:fs";
import path from "node:path";
import { RecordingSchema } from "@/contracts";
import { credentialSource } from "@/config/engine";
import { ROOT } from "@/lib/paths";
import { jobSetVersion, jobStageEvent } from "@/lib/learnjob";
import { learnSkillWith } from "./index";

async function main() {
  const argv = process.argv.slice(2);
  const argOf = (f: string) => {
    const i = argv.indexOf(f);
    return i >= 0 ? (argv[i + 1] ?? null) : null;
  };
  const file = argOf("--recording") ?? "extension/recordings/portal-HSG-1010.json";
  const offline = argv.includes("--offline");
  const persist = !argv.includes("--no-persist");
  const job = argv.includes("--job");
  const abs = path.isAbsolute(file) ? file : path.join(ROOT, file);
  const recording = RecordingSchema.parse(JSON.parse(fs.readFileSync(abs, "utf8")));
  const source = offline ? null : credentialSource();

  console.log(`SKILL LEARN — recording ${file} (session ${recording.session_id}, ${recording.steps.length} steps${recording.speech ? `, ${recording.speech.utterances.length} utterances` : ""})`);
  console.log(`  ${source ? `real mode (key from ${source})` : offline ? "offline: --offline flag (deterministic, no API call)" : "offline: no Anthropic key (deterministic, no API call)"}`);

  const skill = await learnSkillWith(recording, {
    offline,
    persist,
    checks: !argv.includes("--no-checks"),
    onVersion: (v) => {
      console.log(`  version ${v.skill_id} v${v.version} -> ${v.package_dir}`);
      if (job) jobSetVersion(v.skill_id, v.version);
    },
    onStage: (ev) => {
      if (job) jobStageEvent(ev);
      if (ev.status !== "running") console.log(`  [${ev.name}] ${ev.status}${ev.mode ? ` (${ev.mode})` : ""}${ev.note ? ` — ${ev.note}` : ""}`);
    },
  });

  console.log(`  mode: ${skill.mode}; status: ${skill.status}; vendor: ${skill.vendor}`);
  console.log(`  rules (${skill.rules.length}):`);
  for (const r of skill.rules) {
    console.log(`    ${r.id} [${r.kind}/${r.source}] ${r.text}`);
    for (const c of r.citations) console.log(`        ${c.utterance_id ? `"${c.quote}" (${c.utterance_id})` : `step ${c.step_index} ${c.selector ?? ""}`}`);
  }
  console.log(`  portal map (${skill.portal_map.length}):`);
  for (const p of skill.portal_map) console.log(`    ${p.page} [${p.fields.map((f) => f.name).join(", ")}]`);
  console.log(`  open questions (${skill.open_questions.length}):`);
  for (const q of skill.open_questions) console.log(`    - ${q}`);
  console.log(`  checks: ${skill.checks.length ? skill.checks.map((c) => c.name).join(", ") : "none"}`);
  console.log(`  anthropic skill: ${skill.anthropic_skill ? `${skill.anthropic_skill.id} @ ${skill.anthropic_skill.version}` : "not uploaded"}`);
  console.log(`  stages: ${skill.stages.map((s) => `${s.name}=${s.mode}`).join(", ")}`);
  console.log(`  wrote ${skill.package_dir}/ (SKILL.md, skill.json, stages/${skill.checks.length ? ", checks/" : ""}); status draft — promotion is the evals' job`);
}

main().catch((err) => {
  console.error("skill learn failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
