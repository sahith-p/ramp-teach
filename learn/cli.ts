/**
 * `npm run learn` — LEARN stage CLI. The ONLY place in learn/ (besides run-evals.ts) that wires a
 * workflow in; learn/distill.ts stays generic.
 *
 * Writes rules/workflow_spec.json, rules/learn_meta.json (LearnMeta), rules/evals.json and appends
 * TraceEvents (stage "learn", honest mode) to learn/trace.jsonl.
 *
 * Recording: the first existing entry of invoiceReviewRecordings — the MV3 extension capture (primary),
 * else the seeded sample (labeled fallback fixture). Its provenance is written into learn_meta.json.
 *
 * Flags: --offline            force deterministic mode (no API call) even when credentials exist.
 *        --recording <path>   use one specific listed recording (repo-relative).
 *        --recording-file <runtime/recordings/*.json> --operator human|scripted_playwright
 *                             a recording sent from the Recorder extension ("Send to Ramp").
 */
import fs from "node:fs";
import path from "node:path";
import { EvalsFileSchema, LearnMetaSchema, RecordingSchema, type TraceMode } from "@/contracts";
import { getProvider } from "@/agent/providers";
import { ROOT } from "@/lib/paths";
import { trace } from "@/lib/trace";
import { distill } from "@/learn/distill";
import { invoiceReviewLearn, invoiceReviewRecordings } from "@/workflows/invoice-review/learn";
import { invoiceReviewEvals } from "@/workflows/invoice-review/evals";

const TRACE_FILE = path.join(ROOT, "learn", "trace.jsonl");

function writeJson(rel: string, value: unknown) {
  const file = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

async function main() {
  const offline = process.argv.includes("--offline");
  const learnDef = invoiceReviewLearn;
  const runId = `learn_${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15)}`;
  const t = (step: string, mode: TraceMode, detail: Record<string, unknown> = {}) =>
    trace({ run_id: runId, stage: "learn", mode, step, detail }, TRACE_FILE);

  const argOf = (f: string) => {
    const i = process.argv.indexOf(f);
    return i >= 0 ? process.argv[i + 1] ?? null : null;
  };
  const requested = argOf("--recording");
  const uploaded = argOf("--recording-file");
  const operator = argOf("--operator") === "scripted_playwright" ? "scripted_playwright" : "human";
  if (uploaded && !/^runtime\/recordings\/[A-Za-z0-9_.-]+\.json$/.test(uploaded)) throw new Error("--recording-file must be runtime/recordings/<name>.json");
  const source = uploaded
    ? {
        path: uploaded,
        provenance: {
          capture: "mv3_extension" as const,
          operator: operator as "human" | "scripted_playwright",
          role: "primary" as const,
          note:
            "Sent from the Ramp Teach Recorder (MV3 extension) with Send to Ramp. " +
            (operator === "human" ? "Performed by a person." : "Performed by a scripted Playwright operator (demo film), not a person."),
        },
      }
    : requested
      ? invoiceReviewRecordings.find((r) => r.path === requested)
      : invoiceReviewRecordings.find((r) => fs.existsSync(path.join(ROOT, r.path)));
  if (!source) {
    throw new Error(
      requested
        ? `--recording ${requested} is not a listed LEARN recording (${invoiceReviewRecordings.map((r) => r.path).join(", ")})`
        : "no LEARN recording found",
    );
  }
  const recordingPath = source.path;
  const recording = RecordingSchema.parse(JSON.parse(fs.readFileSync(path.join(ROOT, recordingPath), "utf8")));
  const provenance = { session_id: recording.session_id, ...source.provenance };
  t("load_recording", "deterministic", {
    recording_path: recordingPath,
    session_id: recording.session_id,
    steps: recording.steps.length,
    narration: recording.steps.filter((s) => s.kind === "narration").length,
    provenance,
  });
  if (source.provenance.role === "fallback_fixture") {
    console.log(
      requested
        ? `  NOTE: --recording selected the labeled FALLBACK fixture ${recordingPath} (not the extension capture)`
        : `  NOTE: extension capture not found; LEARN is using the labeled FALLBACK fixture ${recordingPath}`,
    );
  }

  const provider = offline ? null : getProvider();
  if (!provider) {
    t("provider", "deterministic", { reason: offline ? "--offline flag" : "no credentials or RAMP_TEACH_OFFLINE=1" });
  }

  const result = await distill(recording, learnDef, provider, {
    recordingPath,
    onTrace: (ev) => t(ev.step, ev.mode, ev.detail),
  });

  writeJson(learnDef.specPath, result.spec);
  const meta = LearnMetaSchema.parse({ ...result.meta, provenance });
  writeJson("rules/learn_meta.json", meta);
  const evals = EvalsFileSchema.parse(invoiceReviewEvals());
  writeJson("rules/evals.json", evals);
  t("write_outputs", "deterministic", {
    spec: learnDef.specPath,
    meta: "rules/learn_meta.json",
    evals: "rules/evals.json",
    eval_cases: evals.length,
    spec_mode: result.meta.mode,
  });

  const s = result.spec;
  console.log(`LEARN — mode: ${result.meta.mode}${result.meta.model ? ` (model ${result.meta.model}${result.cacheHit ? ", from cache" : ", fresh API call"})` : ""}`);
  if (result.fallbackReason) console.log(`  real mode failed, fell back to deterministic: ${result.fallbackReason}`);
  if (!provider) console.log(`  deterministic distiller (no LLM): ${offline ? "--offline" : "no AI provider credentials"}`);
  console.log(`  recording: ${recordingPath} (session ${recording.session_id}; capture ${provenance.capture}; operator ${provenance.operator}; ${provenance.role})`);
  console.log(`  vendor: ${s.vendor}`);
  console.log(`  proof_sources (${s.proof_sources.length}):`);
  for (const p of s.proof_sources) console.log(`    - ${p.app} ${p.location} [${p.fields.join(", ")}]`);
  console.log(`  rules (${s.rules.length}):`);
  for (const r of s.rules) console.log(`    - ${r}`);
  console.log(`  open_questions (${s.open_questions.length}):`);
  for (const q of s.open_questions) console.log(`    - ${q}`);
  console.log(`  evals: ${evals.length} cases from data/corrections.json -> rules/evals.json`);
  console.log(`  wrote ${learnDef.specPath}, rules/learn_meta.json, rules/evals.json; trace -> learn/trace.jsonl (run ${runId})`);
}

main().catch((err) => {
  console.error("learn failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
