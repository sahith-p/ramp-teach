/**
 * The skill learner: Recording -> SkillVersion, in six stages (contracts/pillars.ts LearnStageName):
 *
 *   segment     deterministic   episodes by page + the reviewer's words (speech utterances, else narration)
 *   claims      real            transcript + steps as documents with citations -> cited claims
 *   synthesize  real            structured output -> rules (kind, source, citations), portal map, vendor, questions
 *   critique    real            structured output -> unsupported / invented rules dropped, gaps added
 *   checks      real            Claude-written Python checks run in the code execution sandbox, compared with calc/
 *   package     deterministic   SKILL.md + skill.json + checks/*.py, uploaded with the Skills API when a key exists
 *
 * Offline (no key, or --offline): segment, deterministic claims + distiller (exact narration quotes), the code half
 * of critique (uncited rules dropped), checks skipped with a stage record, package without upload. A failed real
 * call falls back to the deterministic path for that stage, and the stage says so. Nothing is labeled real unless a
 * model produced it.
 *
 * Generic: the workflow's config (skill id, hints, past data) is passed in; learn/skill/index.ts wires invoice review.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CHECK_NAMES,
  LearnStageSchema,
  SkillVersionSchema,
  type CheckName,
  type Invoice,
  type LearnSkillOptions,
  type LearnStage,
  type PillarMode,
  type Recording,
  type SkillVersion,
  type Timecard,
  type VendorProfile,
} from "@/contracts";
import { PP } from "@/lib/pillars";
import { ROOT } from "@/lib/paths";
import { trace } from "@/lib/trace";
import { describeError } from "@/learn/distill";
import { runClaims } from "./claims";
import { buildRunner, compareWithCalc, runInSandbox, writeCheckScripts, type CheckAgreement } from "./checks";
import { makeSkillClient, stageUsage, SKILL_MODEL, type SkillClient } from "./client";
import { applyCritique, runCritique, type CritiqueApi } from "./critique";
import { deterministicClaims, deterministicDraft } from "./deterministic";
import { renderSkillMd, skillName, uploadSkill } from "./package";
import { segment } from "./segment";
import { runSynthesize } from "./synthesize";
import type { CallMeta, Claim, SkillDraft, StageStatus } from "./types";

export interface SkillLearnConfig {
  skillId: string;
  title: string;
  /** Domain hints for the synthesize prompt (never answers). */
  hints: string;
  vendorPattern?: RegExp;
  vendorNotStated: string;
  /** Past data the checks stage runs on (and calc/ compares against). Never the answer key. */
  checkData?: () => { invoices: { invoice: Invoice; path: string }[]; vendor: VendorProfile; timecards: Timecard[] };
}

export type StageEvent = { name: LearnStage["name"]; status: StageStatus; at: string; mode?: PillarMode; note?: string };

export interface LearnSkillRunOptions extends LearnSkillOptions {
  config: SkillLearnConfig;
  /** undefined = real client when credentials exist; null = offline. Tests pass a fake. */
  client?: SkillClient | null;
  /** Trace file; null = no trace. Default learn/trace.jsonl when persisting, else <outDir>/trace.jsonl. */
  traceFile?: string | null;
  onStage?: (ev: StageEvent) => void;
  /** Called once the version number is reserved (before any stage runs). */
  onVersion?: (info: { skill_id: string; version: number; package_dir: string }) => void;
  /** Run the checks stage when online (default true). */
  checks?: boolean;
  now?: () => Date;
}

export const STAGE_NAMES: LearnStage["name"][] = ["segment", "claims", "synthesize", "critique", "checks", "package"];

const relOrAbs = (abs: string) => {
  const r = path.relative(ROOT, abs);
  return r.startsWith("..") || path.isAbsolute(r) ? abs : r.split(path.sep).join("/");
};

/** Next free version under <root>/<skillId>/ (v1, v2, ...), reserved by creating its folder. */
export function reserveVersion(skillRoot: string): { version: number; dir: string } {
  fs.mkdirSync(skillRoot, { recursive: true });
  const existing = fs
    .readdirSync(skillRoot)
    .map((d) => /^v(\d+)$/.exec(d)?.[1])
    .filter((x): x is string => !!x)
    .map(Number);
  let v = existing.length ? Math.max(...existing) + 1 : 1;
  for (;;) {
    const dir = path.join(skillRoot, `v${v}`);
    try {
      fs.mkdirSync(dir);
      return { version: v, dir };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      v++;
    }
  }
}

/** The newest earlier version's Skills API id, so a new version uploads as a version of the same skill. */
function previousAnthropicSkill(skillRoot: string, version: number): { id: string } | null {
  const versions = fs
    .readdirSync(skillRoot)
    .map((d) => Number(/^v(\d+)$/.exec(d)?.[1]))
    .filter((n) => Number.isFinite(n) && n < version)
    .sort((a, b) => b - a);
  for (const v of versions) {
    try {
      const s = SkillVersionSchema.parse(JSON.parse(fs.readFileSync(path.join(skillRoot, `v${v}`, "skill.json"), "utf8")));
      if (s.anthropic_skill) return { id: s.anthropic_skill.id };
    } catch {
      /* incomplete version */
    }
  }
  return null;
}

function writeJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

export async function runSkillLearner(recording: Recording, opts: LearnSkillRunOptions): Promise<SkillVersion> {
  const cfg = opts.config;
  const now = opts.now ?? (() => new Date());
  const persist = opts.persist !== false;
  const client: SkillClient | null = opts.offline ? null : opts.client === undefined ? makeSkillClient() : opts.client;
  const offline = client === null;
  const noCache = opts.noCache ?? false;
  const skillsRoot = opts.outDir ?? (persist ? PP.skills : fs.mkdtempSync(path.join(os.tmpdir(), "ramp-skill-")));
  const skillRoot = path.join(skillsRoot, cfg.skillId);
  const { version, dir: pkgDir } = reserveVersion(skillRoot);
  const stagesDir = path.join(pkgDir, "stages");
  fs.mkdirSync(stagesDir, { recursive: true });
  opts.onVersion?.({ skill_id: cfg.skillId, version, package_dir: relOrAbs(pkgDir) });

  const runId = `skill_${cfg.skillId}_v${version}_${now().toISOString().replace(/[-:.]/g, "").slice(0, 15)}`;
  const traceFile = opts.traceFile === undefined ? (persist ? path.join(ROOT, "src", "learn", "trace.jsonl") : path.join(skillsRoot, "trace.jsonl")) : opts.traceFile;
  const t = (step: string, mode: PillarMode, detail: Record<string, unknown>) => {
    if (traceFile) trace({ run_id: runId, stage: "learn", mode, step, detail }, traceFile);
  };
  t("skill.start", "deterministic", { skill_id: cfg.skillId, version, session_id: recording.session_id, offline, persist, package_dir: relOrAbs(pkgDir) });

  const stages: LearnStage[] = [];
  /** Run one stage: time it, save its output to stages/<name>.json, record the LearnStage and a trace line. */
  async function stage<T>(
    name: LearnStage["name"],
    fn: () => Promise<{ output: T; mode: PillarMode; meta?: CallMeta | null; skipped?: boolean; note?: string }>,
  ): Promise<T> {
    const started_at = now().toISOString();
    opts.onStage?.({ name, status: "running", at: started_at });
    let res: Awaited<ReturnType<typeof fn>>;
    try {
      res = await fn();
    } catch (e) {
      opts.onStage?.({ name, status: "failed", at: now().toISOString(), note: describeError(e) });
      t(`skill.${name}.failed`, "deterministic", { error: describeError(e) });
      throw e;
    }
    const file = path.join(stagesDir, `${name}.json`);
    writeJson(file, res.output);
    const finished_at = now().toISOString();
    const rec = LearnStageSchema.parse({
      name,
      mode: res.mode,
      started_at,
      finished_at,
      output_path: relOrAbs(file),
      model: res.meta?.model ?? null,
      request_id: res.meta?.request_id ?? null,
      usage: stageUsage(res.meta ?? null),
    });
    stages.push(rec);
    t(`skill.${name}`, res.mode, {
      output: rec.output_path,
      model: rec.model,
      request_id: rec.request_id ?? null,
      cache_hit: res.meta?.cache_hit ?? null,
      ms: Date.parse(finished_at) - Date.parse(started_at),
      ...(res.note ? { note: res.note } : {}),
    });
    opts.onStage?.({ name, status: res.skipped ? "skipped" : "done", at: finished_at, mode: res.mode, note: res.note });
    return res.output;
  }

  /* 1. segment */
  const seg = await stage("segment", async () => ({ output: segment(recording), mode: "deterministic" }));

  /* 2. claims */
  const claimsOut = await stage("claims", async () => {
    const det = (reason: string | null) => ({
      output: { mode: "deterministic" as PillarMode, claims: deterministicClaims(seg), fallback_reason: reason },
      mode: "deterministic" as PillarMode,
      note: reason ? `fell back to deterministic claims: ${reason}` : "offline: narration sentences quoted exactly",
    });
    if (!client) return det(null);
    try {
      const r = await runClaims(client, seg, { noCache });
      return { output: { mode: "real" as PillarMode, claims: r.claims, raw_citations: r.raw, fallback_reason: null }, mode: "real" as PillarMode, meta: r.meta };
    } catch (e) {
      return det(describeError(e));
    }
  });
  const claims: Claim[] = claimsOut.claims;

  /* 3. synthesize */
  const synth = await stage("synthesize", async () => {
    const det = (reason: string | null) => ({
      output: { mode: "deterministic" as PillarMode, draft: deterministicDraft(seg, cfg), fallback_reason: reason, rejected_citations: 0 },
      mode: "deterministic" as PillarMode,
      note: reason ? `fell back to the deterministic distiller: ${reason}` : "offline: deterministic distiller",
    });
    if (!client) return det(null);
    try {
      const r = await runSynthesize(client, seg, claims, cfg.hints, { noCache });
      return {
        output: { mode: "real" as PillarMode, draft: r.draft, model_output: r.api, rejected_citations: r.rejected_citations, fallback_reason: null },
        mode: "real" as PillarMode,
        meta: r.meta,
      };
    } catch (e) {
      return det(describeError(e));
    }
  });
  const skillMode: PillarMode = synth.mode === "real" ? "real" : "deterministic";

  /* 4. critique */
  const critiqued = await stage("critique", async () => {
    let api: CritiqueApi | null = null;
    let meta: CallMeta | null = null;
    let reason: string | null = null;
    if (client && synth.mode === "real") {
      try {
        const r = await runCritique(client, seg, synth.draft, { noCache });
        api = r.api;
        meta = r.meta;
      } catch (e) {
        reason = describeError(e);
      }
    }
    const applied = applyCritique(synth.draft, api);
    const mode: PillarMode = api ? "real" : "deterministic";
    return {
      output: { mode, ...applied, fallback_reason: reason },
      mode,
      meta,
      note: api ? undefined : reason ? `model critique failed (${reason}); uncited rules dropped in code` : "no model critique; uncited rules dropped in code",
    };
  });
  const draft: SkillDraft = critiqued.draft;

  /* 5. checks */
  const checkFiles: { name: CheckName; file: string }[] = [];
  await stage<Record<string, unknown>>("checks", async () => {
    const checkRules = draft.rules.filter((r) => r.kind === "check");
    const skip = (reason: string) => ({ output: { skipped: true, reason, authoritative: "calc" }, mode: "deterministic" as PillarMode, skipped: true, note: reason });
    if (!client) return skip("offline: no model to write check scripts and no code execution sandbox; calc/ runs the checks");
    if (opts.checks === false) return skip("checks stage turned off for this run");
    if (checkRules.length === 0) return skip("the skill has no check rules");
    if (!cfg.checkData) return skip("no past data configured for the checks stage");
    const data = cfg.checkData();
    let written: Awaited<ReturnType<typeof writeCheckScripts>>;
    try {
      written = await writeCheckScripts(client, draft.rules, { noCache });
    } catch (e) {
      return { output: { skipped: true, reason: `check scripts could not be written: ${describeError(e)}`, authoritative: "calc" }, mode: "deterministic" as PillarMode, skipped: true };
    }
    const scripts = written.api.scripts.filter((s) => (CHECK_NAMES as readonly string[]).includes(s.check));
    const checksDir = path.join(pkgDir, "checks");
    fs.mkdirSync(checksDir, { recursive: true });
    const meta = written.meta;
    const scriptRecs = scripts.map((s) => {
      const abs = path.join(checksDir, `${s.check}.py`);
      fs.writeFileSync(
        abs,
        `# Check "${s.check}" for skill ${cfg.skillId} v${version}. Written by Claude (${meta.model ?? SKILL_MODEL}); rules ${s.rule_ids.join(", ") || "-"}.\n` +
          `# Mirrors the deterministic calc/ check of the same name. calc/ is authoritative.\n\n${s.code.trimEnd()}\n`,
      );
      checkFiles.push({ name: s.check, file: relOrAbs(abs) });
      return { check: s.check, rule_ids: s.rule_ids, file: relOrAbs(abs) };
    });
    const runner = buildRunner({ invoices: data.invoices.map((i) => i.invoice), vendor: data.vendor, timecards: data.timecards, scripts: scripts.map((s) => ({ check: s.check, code: s.code })) });
    let agreement: CheckAgreement[] = [];
    let sandbox: Record<string, unknown> = {};
    let sandboxError: string | null = null;
    try {
      const run = await runInSandbox(client, runner, { noCache });
      agreement = compareWithCalc(run.rows, scriptRecs, data.invoices, data.vendor, data.timecards);
      sandbox = {
        tool: "code_execution_20260521",
        container_id: run.container_id,
        file_id: run.file_id,
        cache_hit: run.cache_hit,
        requests: run.metas.map((m) => ({ request_id: m.request_id, message_id: m.message_id ?? null, usage: m.usage })),
      };
    } catch (e) {
      sandboxError = describeError(e);
    }
    return {
      output: {
        mode: "real",
        authoritative: "calc",
        invoices: data.invoices.map((i) => i.path),
        scripts: scriptRecs,
        sandbox,
        sandbox_error: sandboxError,
        agreement,
      },
      mode: "real" as PillarMode,
      meta,
      note: sandboxError ? `scripts written; sandbox run failed: ${sandboxError}` : undefined,
    };
  });

  /* 6. package */
  const name = skillName(cfg.skillId);
  let anthropic_skill: SkillVersion["anthropic_skill"] = null;
  await stage("package", async () => {
    const md = renderSkillMd({
      skill_id: cfg.skillId,
      title: draft.title || cfg.title,
      vendor: draft.vendor,
      version,
      mode: skillMode,
      rules: draft.rules,
      portal_map: draft.portal_map,
      open_questions: draft.open_questions,
      checks: checkFiles,
    });
    fs.writeFileSync(path.join(pkgDir, "SKILL.md"), md);
    let upload_error: string | null = null;
    let upload_skipped: string | null = null;
    if (!client) upload_skipped = "offline: no key";
    else if (!persist) upload_skipped = "not persisted (--no-persist)";
    else {
      try {
        anthropic_skill = await uploadSkill(client, pkgDir, name, draft.title || cfg.title, previousAnthropicSkill(skillRoot, version));
      } catch (e) {
        upload_error = describeError(e);
      }
    }
    return {
      output: { files: ["SKILL.md", "skill.json", ...checkFiles.map((c) => `checks/${path.basename(c.file)}`)], skill_name: name, anthropic_skill, upload_error, upload_skipped },
      mode: "deterministic" as PillarMode,
      note: upload_error ? `Skills API upload failed: ${upload_error}` : (upload_skipped ?? "uploaded with the Skills API"),
    };
  });

  const skill = SkillVersionSchema.parse({
    skill_id: cfg.skillId,
    version,
    title: draft.title || cfg.title,
    created_at: now().toISOString(),
    mode: skillMode,
    recordings: [recording.session_id],
    vendor: draft.vendor,
    rules: draft.rules,
    portal_map: draft.portal_map,
    open_questions: draft.open_questions,
    checks: checkFiles.map((c) => ({ name: c.name, file: c.file, language: "python" })),
    stages,
    package_dir: relOrAbs(pkgDir),
    anthropic_skill,
    status: "draft",
    eval_run_id: null,
  });
  writeJson(path.join(pkgDir, "skill.json"), skill);
  t("skill.done", skillMode, {
    skill_id: cfg.skillId,
    version,
    rules: skill.rules.length,
    portal_pages: skill.portal_map.length,
    open_questions: skill.open_questions.length,
    checks: skill.checks.length,
    anthropic_skill: anthropic_skill ? true : false,
    stage_modes: Object.fromEntries(stages.map((s) => [s.name, s.mode])),
  });
  return skill;
}
