/**
 * T-30 — `npm run demo`: one complete pass of the Ramp Teach workflow, end to end.
 *
 *   LEARN (rules/ from the recording)  →  start the local Next app (fixture portal + bill inbox + UI)
 *   →  agent run on the test invoice (calc → browser evidence → receipt synthesis)
 *   →  assert the 3 planted errors are flagged and the recommendation matches the answer key
 *   →  render the receipt in the UI  →  record ONE decision through the UI (scripted stand-in for the human)
 *   →  verify the receipt is attached to the fixture bill.
 *
 * Honest labels: this script itself is orchestration. The decision click is a SCRIPTED stand-in for a
 * human reviewer (decided_by says so). The modes of learn / evidence / synthesis are read from their
 * outputs and printed, never assumed. The answer key is read HERE ONLY (scripts/ + tests), never by
 * agent/, learn/, or the provider.
 *
 * Flags: --invoice HSG-1011   --relearn (re-run LEARN even if rules/ exist)   --skip-learn
 *        --no-build (reuse an existing .next build)   --keep-server   --base-url http://localhost:3000
 *        --offline (force labeled offline modes: deterministic learn, scripted evidence, mock receipt)
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { AnswerKeySchema, LearnMetaSchema, billIdFor, type Receipt } from "@/contracts";
import { P, ROOT } from "@/lib/paths";
import { trace } from "@/lib/trace";
import { readReceipt } from "@/lib/store/receipts";
import { getBill, resetBills } from "@/lib/store/bills";
import { providerCredentialsPresent, engineConfig, credentialSource } from "@/config/engine";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string, dflt: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

const INVOICE = opt("invoice", "HSG-1011");
const BASE_URL = opt("base-url", process.env.BASE_URL ?? "http://localhost:3000");
const RUN_ID = `demo-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const DEMO_DIR = path.join(P.runs, INVOICE, "demo");
const results: { step: string; ok: boolean; detail: string }[] = [];

function log(step: string, ok: boolean, detail: string) {
  results.push({ step, ok, detail });
  console.log(`${ok ? "✔" : "✘"} ${step} — ${detail}`);
  trace({ run_id: RUN_ID, stage: "demo", mode: "deterministic", step, detail: { ok, detail } });
}

function run(cmd: string, cmdArgs: string[], env: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, cmdArgs, { cwd: ROOT, stdio: "inherit", env: { ...process.env, ...env } });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function serverUp(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { redirect: "manual" });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function ensureServer(): Promise<ChildProcess | null> {
  if (await serverUp(BASE_URL)) {
    log("server", true, `reusing app already running at ${BASE_URL}`);
    return null;
  }
  const port = new URL(BASE_URL).port || "3000";
  if (!flag("no-build") || !fs.existsSync(path.join(ROOT, ".next", "BUILD_ID"))) {
    console.log("… building the Next app (next build)");
    const code = await run("npx", ["next", "build"]);
    if (code !== 0) throw new Error("next build failed");
  }
  const child = spawn("npx", ["next", "start", "-p", port], { cwd: ROOT, stdio: "ignore", env: process.env });
  for (let i = 0; i < 60; i++) {
    if (await serverUp(BASE_URL)) {
      log("server", true, `started next start on ${BASE_URL}`);
      return child;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  child.kill();
  throw new Error(`app did not come up at ${BASE_URL}`);
}

async function main() {
  fs.mkdirSync(DEMO_DIR, { recursive: true });
  const offline = flag("offline");
  const childEnv: Record<string, string> = offline ? { RAMP_TEACH_OFFLINE: "1" } : {};
  const keyPresent = !offline && providerCredentialsPresent();
  console.log(`Ramp Teach demo — invoice ${INVOICE} — model ${engineConfig.model}`);
  console.log(
    keyPresent
      ? `Anthropic credential found (${credentialSource()}): evidence + synthesis use REAL Claude calls (synthesis cached in runtime/cache).`
      : offline
        ? "--offline: learn=deterministic, evidence=scripted, receipt=mock (all labeled)."
        : "No Anthropic credential visible to this process: learn=deterministic, evidence=scripted, receipt=mock (all labeled).",
  );

  // 1. LEARN — the committed rules/ are the canonical LEARN output; re-run only when asked or missing.
  const metaPath0 = path.join(P.rules, "learn_meta.json");
  const needLearn = !flag("skip-learn") && (flag("relearn") || !fs.existsSync(P.workflowSpec) || !fs.existsSync(metaPath0));
  if (needLearn) {
    const code = await run("npx", ["tsx", "src/learn/cli.ts", ...(offline ? ["--offline"] : [])], childEnv);
    if (code !== 0) throw new Error("learn failed");
  } else {
    console.log("… LEARN: using committed rules/ (pass --relearn to re-distill)");
  }
  const metaPath = path.join(P.rules, "learn_meta.json");
  const learnMeta = fs.existsSync(metaPath) ? LearnMetaSchema.parse(JSON.parse(fs.readFileSync(metaPath, "utf8"))) : null;
  log("learn", fs.existsSync(P.workflowSpec), `rules/workflow_spec.json present; mode=${learnMeta?.mode ?? "unknown"}`);
  const prov = learnMeta?.provenance;
  log(
    "learn:recording",
    !!learnMeta && prov?.role === "primary",
    `spec distilled from ${learnMeta?.recording_path ?? "?"} (session ${prov?.session_id ?? "?"}; capture=${prov?.capture ?? "?"}; operator=${prov?.operator ?? "?"}; ${prov?.role ?? "no provenance"})`,
  );

  // 2. Fresh bill state, app up
  resetBills();
  const server = await ensureServer();

  try {
    // 3. VERIFY + RECEIPT: the agent worker
    const code = await run("npx", ["tsx", "src/agent/cli.ts", INVOICE, "--base-url", BASE_URL, ...(offline ? ["--offline"] : [])], { BASE_URL, ...childEnv });
    if (code !== 0) throw new Error("agent run failed");
    const receipt = readReceipt(INVOICE);
    if (!receipt) throw new Error(`no receipt written for ${INVOICE}`);
    const evidencePath = path.join(P.runs, INVOICE, "evidence.json");
    const evidenceMode = fs.existsSync(evidencePath) ? JSON.parse(fs.readFileSync(evidencePath, "utf8")).mode : "none";
    log("agent", true, `receipt written; synthesis mode=${receipt.mode}; evidence mode=${evidenceMode}`);

    // 4. Assert against the answer key (scripts/ + tests only)
    const key = AnswerKeySchema.parse(JSON.parse(fs.readFileSync(P.answerKey, "utf8")));
    assertAgainstKey(receipt, key);

    // 5. Render in the UI + 6. one decision through the UI
    await uiDecision(receipt);

    // 7. Attached to the fixture bill?
    const bill = getBill(billIdFor(INVOICE));
    const expectedStatus = receipt.recommendation === "approve" ? "approved" : "disputed";
    log(
      "attach",
      !!bill && bill.receipt_id === `rcpt_${INVOICE}` && bill.status === expectedStatus,
      `bill ${bill?.bill_id} status=${bill?.status} receipt_id=${bill?.receipt_id}`,
    );

    const report = {
      run_id: RUN_ID,
      invoice_id: INVOICE,
      model: engineConfig.model,
      api_key_visible: keyPresent,
      learn_recording: { path: learnMeta?.recording_path ?? null, provenance: learnMeta?.provenance ?? null },
      modes: { learn: learnMeta?.mode ?? "unknown", evidence: evidenceMode, synthesis: receipt.mode, decision: "scripted (UI click standing in for a human)" },
      results,
      passed: results.every((r) => r.ok),
    };
    fs.writeFileSync(path.join(DEMO_DIR, "demo-report.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(`\nDemo report: runs/${INVOICE}/demo/demo-report.json — ${report.passed ? "ALL PASSED" : "FAILURES"}`);
    if (!report.passed) process.exitCode = 1;
  } finally {
    if (server && !flag("keep-server")) server.kill();
  }
}

function assertAgainstKey(receipt: Receipt, key: ReturnType<typeof AnswerKeySchema.parse>) {
  const failing = new Set(receipt.checks.filter((c) => c.result === "fail").map((c) => c.name));
  for (const e of key.planted_errors) {
    log(`planted:${e.check}`, failing.has(e.check), `${e.description} → receipt check ${failing.has(e.check) ? "FAIL (flagged)" : "not flagged"}`);
  }
  log(
    "recommendation",
    receipt.recommendation === key.expected_recommendation,
    `receipt=${receipt.recommendation} answer_key=${key.expected_recommendation}`,
  );
}

async function uiDecision(receipt: Receipt) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
    await page.goto(`${BASE_URL}/receipts/${INVOICE}`);
    const body = await page.textContent("body");
    const banner = body?.includes("Unofficial demo inspired by Ramp") ?? false;
    const recWord = receipt.recommendation[0].toUpperCase() + receipt.recommendation.slice(1);
    log("ui:render", banner && (body?.includes(recWord) ?? false), `receipt page shows demo label and "${recWord}"`);
    await page.screenshot({ path: path.join(DEMO_DIR, "receipt-page.png"), fullPage: true });

    // Scripted stand-in for the human reviewer: follow the recommendation unless it is "review".
    const decision = receipt.recommendation === "approve" ? "Approve" : "Dispute";
    const nameInput = page.getByLabel(/name/i).first();
    await nameInput.fill("Demo reviewer (scripted stand-in for a human)");
    await page.getByRole("button", { name: new RegExp(`^${decision}`, "i") }).first().click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(DEMO_DIR, "receipt-decided.png"), fullPage: true });
    const after = readReceipt(INVOICE);
    log("ui:decision", after?.human_decision === decision.toLowerCase(), `decision via UI → POST /api/decisions: ${after?.human_decision} by ${after?.decided_by}`);

    await page.goto(`${BASE_URL}/bills/${billIdFor(INVOICE)}`);
    await page.screenshot({ path: path.join(DEMO_DIR, "bill-attached.png"), fullPage: true });
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  log("demo", false, String(err?.message ?? err));
  process.exit(1);
});
