/**
 * Pre-commit guard: the committed run artifacts must stay the real-mode results, never rehearsal/offline output.
 *   npx tsx scripts/guard-artifacts.ts   (exit 1 on a problem)
 */
import fs from "node:fs";

const problems: string[] = [];
const j = (p: string) => JSON.parse(fs.readFileSync(p, "utf8"));
const meta = j("rules/learn_meta.json");
if (meta.mode !== "real") problems.push(`rules/learn_meta.json mode=${meta.mode} (expected real)`);
// The committed extension recording, or (after a real film take keeps rules/ synced from its learned skill) the
// recording that take sent from the extension.
const filmTake = /(^|\/)runtime\/recordings\/rec_[\w.-]+\.json$/.test(meta.recording_path ?? "");
if (meta.recording_path !== "extension/recordings/portal-HSG-1010.json" && !filmTake) problems.push(`rules/learn_meta.json recording_path=${meta.recording_path}`);
const r = j("receipts/HSG-1011.json");
if (r.mode !== "real") problems.push(`receipts/HSG-1011.json mode=${r.mode} (expected real)`);
for (const p of ["receipts/HSG-1012.json", "runs/HSG-1012"]) if (fs.existsSync(p)) problems.push(`${p} exists (rehearsal/film output; archive it, do not commit)`);
const ev = j("runs/HSG-1011/evidence.json");
if (ev.mode !== "real") problems.push(`runs/HSG-1011/evidence.json mode=${ev.mode}`);
// Skill evals and learned skills: only real runs/versions may be committed (offline output stays local).
if (fs.existsSync("evals/runs"))
  for (const f of fs.readdirSync("evals/runs").filter((x) => x.endsWith(".json"))) {
    const run = j(`evals/runs/${f}`);
    if (run.mode !== "real") problems.push(`evals/runs/${f} mode=${run.mode}`);
  }
if (fs.existsSync("skills"))
  for (const id of fs.readdirSync("skills"))
    for (const v of fs.existsSync(`skills/${id}`) ? fs.readdirSync(`skills/${id}`).filter((x) => /^v\d+$/.test(x)) : []) {
      const sk = fs.existsSync(`skills/${id}/${v}/skill.json`) ? j(`skills/${id}/${v}/skill.json`) : null;
      if (sk && sk.mode !== "real") problems.push(`skills/${id}/${v} mode=${sk.mode}`);
    }
if (problems.length) {
  console.error("artifact guard FAILED:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log("artifact guard OK (committed artifacts are real-mode results)");
