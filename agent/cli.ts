/**
 * npm run agent -- <SUBJECT_ID> [--offline] [--base-url URL] [--workflow invoice-review] [--max-turns N] [--quiet]
 *
 * Runs the engine for one subject (e.g. HSG-1011) against the local fixture app and writes
 * runs/<id>/{calc,evidence}.json, runs/<id>/screenshots/, receipts/<id>.json, agent/trace.jsonl.
 * Without credentials (or with --offline) it runs the labeled offline mode: scripted evidence + mock receipt.
 * It never attaches, approves, or decides.
 */
import { credentialSource, engineConfig } from "@/config/engine";
import { BASE_URL, ROOT } from "@/lib/paths";
import { getProvider } from "@/agent/providers";
import { runWorkflow, type RunSummary } from "@/agent/engine";
import { DEFAULT_WORKFLOW, getWorkflow } from "@/workflows/registry";
import path from "node:path";

function parseArgs(argv: string[]) {
  const out = { subject: "", offline: false, baseUrl: BASE_URL, workflow: DEFAULT_WORKFLOW, maxTurns: engineConfig.browser.maxTurns, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--offline") out.offline = true;
    else if (a === "--quiet") out.quiet = true;
    else if (a === "--base-url") out.baseUrl = argv[++i];
    else if (a.startsWith("--base-url=")) out.baseUrl = a.slice(11);
    else if (a === "--workflow") out.workflow = argv[++i];
    else if (a.startsWith("--workflow=")) out.workflow = a.slice(11);
    else if (a === "--max-turns") out.maxTurns = Number(argv[++i]);
    else if (a.startsWith("--max-turns=")) out.maxTurns = Number(a.slice(12));
    else if (!a.startsWith("--") && !out.subject) out.subject = a;
    else throw new Error(`Unknown argument ${a}`);
  }
  if (!out.subject) throw new Error("Usage: npm run agent -- <SUBJECT_ID> [--offline] [--base-url URL] [--workflow ID] [--max-turns N]");
  return out;
}

const rel = (p: string | null) => (p ? path.relative(ROOT, p) : "—");

function printSummary(s: RunSummary): void {
  const r = s.receipt;
  const lines = [
    "",
    "═══ Ramp Teach — engine run summary (unofficial demo, synthetic data) ═══",
    `workflow      ${s.workflowId}   subject ${s.subject.subject_id} — ${s.subject.label}`,
    `run id        ${s.runId}`,
    "modes",
    `  calc        ${s.modes.calc}`,
    `  spec        ${s.modes.spec}`,
    `  evidence    ${s.modes.evidence}${s.browser?.fallbackTasks.length ? `  (scripted fallback: ${s.browser.fallbackTasks.join(", ")})` : ""}`,
    `  synthesis   ${s.modes.synthesis}${s.synthesisCacheHit ? " (cached response of an earlier real call)" : ""}`,
    `recommendation  ${r.recommendation.toUpperCase()}   (receipt mode: ${r.mode}; human decision: ${r.human_decision ?? "pending"})`,
    `failing checks  ${s.failingChecks.join(", ") || "none"}`,
    `unverified      ${s.unverifiedChecks.join(", ") || "none"}`,
  ];
  for (const c of r.checks) lines.push(`  ${c.result.padEnd(10)} ${c.name.padEnd(26)} ${c.evidence}`);
  if (s.browser) {
    const u = s.browser.usage;
    lines.push(
      `browser loop    ${s.browser.turns} turns, stop: ${s.browser.stopReason}, ${s.browser.facts} facts, model ${s.browser.model}`,
      u
        ? `  tokens      input ${u.input_tokens} · cache write ${u.cache_creation_input_tokens} · cache read ${u.cache_read_input_tokens} · output ${u.output_tokens}`
        : "  tokens      n/a",
    );
  } else lines.push("browser loop    not run (offline)");
  if (s.synthesisUsage) lines.push(`synthesis usage ${JSON.stringify(s.synthesisUsage)}`);
  lines.push("reasons");
  for (const x of r.reasons) lines.push(`  - ${x}`);
  if (s.notes.length) {
    lines.push("notes");
    for (const n of s.notes) lines.push(`  - ${n}`);
  }
  lines.push(
    `files           ${rel(s.receiptPath)} · ${rel(s.calcPath)} · ${rel(s.evidencePath)} · agent/trace.jsonl`,
    "The engine never attaches, approves, or decides. A human decides via the receipt page (POST /api/decisions).",
    "",
  );
  console.log(lines.join("\n"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const def = getWorkflow(args.workflow);
  const provider = args.offline ? null : getProvider();
  if (!provider) {
    console.log(
      args.offline
        ? "[offline] --offline: scripted evidence (mode scripted) + deterministic mock receipt (mode mock)."
        : "[offline] No Anthropic credentials found: scripted evidence (mode scripted) + deterministic mock receipt (mode mock).",
    );
  } else {
    console.log(`[real] provider ${provider.id}, model ${provider.model}, credentials from ${credentialSource()}.`);
  }
  const summary = await runWorkflow(def, args.subject, {
    baseUrl: args.baseUrl,
    provider,
    maxTurns: args.maxTurns,
    log: args.quiet ? undefined : (l) => console.log(l),
  });
  printSummary(summary);
}

main().catch((e) => {
  console.error(`agent failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
