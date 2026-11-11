/**
 * npm run agent -- <SUBJECT_ID> [--offline] [--base-url URL] [--workflow invoice-review] [--max-turns N] [--quiet]
 *
 * 1. ROUTE   agent/router.ts picks the workflow (skill) for the arriving invoice, or none
 *            → runs/<id>/route.json, a trace line and a "route" span.
 * 2. RUN     if a workflow was chosen, the engine runs it (with the skill version the router picked)
 *            and writes runs/<id>/{calc,evidence,evidence-check}.json, spans.jsonl, screenshots/, live/,
 *            receipts/<id>.json, agent/trace.jsonl.
 *            If none fits, the invoice goes to manual review: no agent run, no receipt.
 * Without credentials (or with --offline) everything runs in its labeled offline mode: plain-code routing
 * (mode deterministic), scripted evidence (mode scripted) + mock receipt (mode mock).
 * RAMP_TEACH_ROUTER=deterministic forces plain-code routing while the rest of the run stays real.
 * It never attaches, approves, or decides.
 */
import { credentialSource, engineConfig } from "@/config/engine";
import { BASE_URL, ROOT } from "@/lib/paths";
import { getSkillVersion, routePath } from "@/lib/pillars";
import { trace as writeTrace } from "@/lib/trace";
import { getProvider } from "@/agent/providers";
import { runWorkflow, type RunSummary } from "@/agent/engine";
import { routeInvoice } from "@/agent/router";
import { SpanRecorder } from "@/agent/spans";
import { DEFAULT_WORKFLOW, getWorkflow, workflows } from "@/workflows/registry";
import type { PillarMode, RouteDecision } from "@/contracts";
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

function printRoute(d: RouteDecision): void {
  console.log(
    [
      "",
      `route           ${d.workflow_id ? `${d.workflow_id}${d.version ? ` v${d.version}` : ""}` : "none → manual review"}  (mode ${d.mode}${d.model ? `, ${d.model}` : ""}, confidence ${d.confidence.toFixed(2)})`,
      `  reason      ${d.reason}`,
      ...d.candidates.map((c) => `  candidate   ${c.workflow_id.padEnd(28)} ${c.score.toFixed(2)}  ${c.why}`),
    ].join("\n"),
  );
}

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
      `browser loop    ${s.browser.turns} turns, stop: ${s.browser.stopReason}, ${s.browser.facts} facts, ${s.browser.notes?.length ?? 0} progress notes, model ${s.browser.model}`,
      u
        ? `  tokens      input ${u.input_tokens} · cache write ${u.cache_creation_input_tokens} · cache read ${u.cache_read_input_tokens} · output ${u.output_tokens}`
        : "  tokens      n/a",
    );
  } else lines.push("browser loop    not run (offline)");
  if (s.evidenceCheck) {
    const e = s.evidenceCheck;
    lines.push(`evidence check  ${e.match}/${e.checks} match, ${e.mismatch} mismatch, ${e.unavailable} unavailable (deterministic re-read) · ${e.path}`);
  }
  if (s.synthesisUsage) lines.push(`synthesis usage ${JSON.stringify(s.synthesisUsage)}`);
  lines.push("reasons");
  for (const x of r.reasons) lines.push(`  - ${x}`);
  if (s.notes.length) {
    lines.push("notes");
    for (const n of s.notes) lines.push(`  - ${n}`);
  }
  lines.push(
    `files           ${rel(s.receiptPath)} · ${rel(s.calcPath)} · ${rel(s.evidencePath)} · ${s.spansPath ?? "spans.jsonl"} · agent/trace.jsonl`,
    "The engine never attaches, approves, or decides. A human decides via the receipt page (POST /api/decisions).",
    "",
  );
  console.log(lines.join("\n"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  getWorkflow(args.workflow); // validate --workflow early
  const provider = args.offline ? null : getProvider();
  if (!provider) {
    console.log(
      args.offline
        ? "[offline] --offline: plain-code routing, scripted evidence (mode scripted) + deterministic mock receipt (mode mock)."
        : "[offline] No Anthropic credentials found: plain-code routing, scripted evidence (mode scripted) + deterministic mock receipt (mode mock).",
    );
  } else {
    console.log(`[real] provider ${provider.id}, model ${provider.model}, credentials from ${credentialSource()}.`);
  }

  // One run id for the routing step and the engine run (trace_id of every span).
  const runId = `${args.workflow}:${args.subject}:${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15)}`;
  const spans = new SpanRecorder({ invoiceId: args.subject, traceId: runId });
  spans.reset();
  const runSpan = spans.start(`run ${args.subject}`, "run", provider ? "real" : "scripted", null, { base_url: args.baseUrl });
  const trace = (step: string, mode: PillarMode, detail: Record<string, unknown>) =>
    writeTrace({ run_id: runId, stage: "calc", mode, step, detail });

  /* 1. route */
  const decision = await routeInvoice(args.subject, {
    offline: args.offline,
    spans: { recorder: spans, parentId: runSpan.id },
    trace,
  });
  if (!args.quiet) printRoute(decision);
  if (!decision.workflow_id) {
    trace("route.manual_review", decision.mode, {
      invoice_id: args.subject,
      route: path.relative(ROOT, routePath(args.subject)),
      note: "No workflow fits this invoice: no agent run. It waits for a person to review it by hand.",
    });
    runSpan.end({ outcome: "manual_review", workflow_id: null }, decision.mode);
    console.log(`No workflow fits ${args.subject}: sent to manual review (no agent run). Route: ${path.relative(ROOT, routePath(args.subject))}`);
    return;
  }

  /* 2. run the chosen workflow */
  const skill = decision.version != null ? getSkillVersion(decision.workflow_id, decision.version) : null;
  if (decision.version != null && !skill) throw new Error(`Routed to ${decision.workflow_id} v${decision.version}, but that skill version is missing`);
  // Skills run on the invoice-review engine workflow; a registry id runs that workflow directly.
  const def = getWorkflow(workflows[decision.workflow_id] ? decision.workflow_id : args.workflow);
  const summary = await runWorkflow(def, args.subject, {
    baseUrl: args.baseUrl,
    provider,
    maxTurns: args.maxTurns,
    runId,
    spans,
    spanParentId: runSpan.id,
    skill,
    log: args.quiet ? undefined : (l) => console.log(l),
  });
  runSpan.end(
    { outcome: "receipt", workflow_id: decision.workflow_id, version: decision.version, recommendation: summary.receipt.recommendation },
    summary.modes.synthesis === "real" ? "real" : provider ? "real" : "scripted",
  );
  printSummary(summary);
}

main().catch((e) => {
  console.error(`agent failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
