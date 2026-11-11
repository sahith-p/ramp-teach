/**
 * Stage 6, package: write the Agent Skills package (SKILL.md with YAML frontmatter `name` + `description`,
 * checks/*.py) and, when a key is present, upload it through the Skills API:
 *   first upload      client.skills.create({ files, display_name })      -> { id, latest_version_id }
 *   later versions    client.skills.versions.create(skill_id, { files }) -> { id }
 * Files are named "<skill_id>/SKILL.md", "<skill_id>/checks/<name>.py" so SKILL.md sits at the top of one folder.
 */
import fs from "node:fs";
import path from "node:path";
import { toFile } from "@anthropic-ai/sdk";
import type { PortalPage, SkillRule } from "@/contracts";
import type { SkillClient } from "./client";

export interface SkillMdInput {
  skill_id: string;
  title: string;
  vendor: string;
  version: number;
  mode: string;
  rules: SkillRule[];
  portal_map: PortalPage[];
  open_questions: string[];
  checks: { name: string; file: string }[];
}

/** Frontmatter `name`: lowercase letters, digits, hyphens; max 64; no reserved words. */
export function skillName(id: string): string {
  const n = id.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").replace(/\b(anthropic|claude)\b/g, "x");
  return (n || "skill").slice(0, 64);
}

const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").replace(/[<>]/g, "").trim();
const yamlStr = (s: string) => JSON.stringify(oneLine(s)); // JSON strings are valid YAML double-quoted scalars

export function skillDescription(input: Pick<SkillMdInput, "title" | "vendor" | "rules">): string {
  const vendor = /not stated/i.test(input.vendor) ? "this vendor" : input.vendor;
  const checks = input.rules.filter((r) => r.kind === "check").length;
  const d = `${input.title}. Use when reviewing a service (staffing) invoice from ${vendor} before it is paid: ` +
    `applies ${checks} learned check${checks === 1 ? "" : "s"}, reads approved hours from the vendor portal, and recommends approve or dispute. ` +
    `Learned from a recorded human review; every rule cites the reviewer's words.`;
  return oneLine(d).slice(0, 1024);
}

function quotes(r: SkillRule): string {
  return r.citations
    .map((c) => (c.utterance_id ? `"${oneLine(c.quote)}" (${c.utterance_id}${c.step_index != null ? `, step ${c.step_index}` : ""})` : `shown at step ${c.step_index}: \`${c.selector ?? oneLine(c.quote)}\``))
    .join("; ");
}

/** SKILL.md: frontmatter + a concise body (when to use, rules with quotes, where to look, decision rule, checks). */
export function renderSkillMd(input: SkillMdInput): string {
  const checks = input.rules.filter((r) => r.kind === "check");
  const procedures = input.rules.filter((r) => r.kind === "procedure");
  const decisions = input.rules.filter((r) => r.kind === "decision");
  const ruleLine = (r: SkillRule) => `- **${r.id}** ${oneLine(r.text)}${r.source !== "said" ? ` _(${r.source})_` : ""}\n  - ${quotes(r)}`;
  const lines: string[] = [
    "---",
    `name: ${skillName(input.skill_id)}`,
    `description: ${yamlStr(skillDescription(input))}`,
    "---",
    "",
    `# ${oneLine(input.title)}`,
    "",
    `Version ${input.version} (${input.mode}). Vendor: ${oneLine(input.vendor)}. Rules are quoted from the recorded review; ` +
      `"shown" means the reviewer inspected it on screen without saying it.`,
    "",
    "## When to use",
    "",
    `A new invoice from ${/not stated/i.test(input.vendor) ? "the vendor in the recording" : oneLine(input.vendor)} needs checking before payment. ` +
      "You gather evidence and recommend; a person approves or disputes. Never approve, pay, submit or attach anything.",
    "",
    "## Rules",
    "",
    ...(checks.length ? checks.map(ruleLine) : ["- (none learned)"]),
    "",
    "## How to gather evidence",
    "",
    ...(procedures.length ? procedures.map(ruleLine) : ["- (none learned)"]),
    "",
    "## Where to look",
    "",
    ...(input.portal_map.length
      ? input.portal_map.map((p) => `- \`${p.page}\`${p.fields.length ? `: ${p.fields.map((f) => `${f.name} \`${f.selector}\``).join(", ")}` : ""}`)
      : ["- (no pages recorded)"]),
    "",
    "## Decision rule",
    "",
    ...(decisions.length ? decisions.map(ruleLine) : ["- Not stated in the recording: recommend review by a person."]),
    "",
    "## Checks",
    "",
    ...(input.checks.length
      ? [
          "Python scripts in `checks/` (written by Claude, run in a sandbox and compared with the deterministic calculator; the calculator decides):",
          ...input.checks.map((c) => `- \`checks/${path.basename(c.file)}\` (${c.name})`),
        ]
      : ["No check scripts in this version. The deterministic calculator runs the checks."]),
    "",
  ];
  if (input.open_questions.length) {
    lines.push("## Open questions", "", ...input.open_questions.map((q) => `- ${oneLine(q)}`), "");
  }
  return lines.join("\n");
}

/** Every file of the package to upload, with its upload name "<name>/<relative path>". */
export function packageFiles(pkgDir: string, name: string): { upload: string; abs: string }[] {
  const out = [{ upload: `${name}/SKILL.md`, abs: path.join(pkgDir, "SKILL.md") }];
  const checksDir = path.join(pkgDir, "checks");
  if (fs.existsSync(checksDir)) {
    for (const f of fs.readdirSync(checksDir).filter((x) => x.endsWith(".py")).sort()) {
      out.push({ upload: `${name}/checks/${f}`, abs: path.join(checksDir, f) });
    }
  }
  return out;
}

/** Upload through the Skills API. `previous` = the anthropic_skill of an earlier version (new version of the same skill). */
export async function uploadSkill(
  client: SkillClient,
  pkgDir: string,
  name: string,
  title: string,
  previous: { id: string } | null,
): Promise<{ id: string; version: string }> {
  const files = await Promise.all(
    packageFiles(pkgDir, name).map(async (f) =>
      toFile(fs.readFileSync(f.abs), f.upload, { type: f.upload.endsWith(".md") ? "text/markdown" : "text/x-python" }),
    ),
  );
  if (previous) {
    const v = await client.skills.versions.create(previous.id, { files });
    return { id: previous.id, version: v.id };
  }
  const s = await client.skills.create({ files, display_name: title.slice(0, 255) });
  return { id: s.id, version: s.latest_version_id };
}
