/**
 * Product film: one continuous take of the stage (public/stage/index.html) at 1920x1080, then post.
 *
 *   npx tsx demo/video/film.ts [--phase all|shoot|archive|assemble|outro|diagrams|captions|restore]
 *                              [--offline] [--evals real|sample:N|offline|skip] [--no-build] [--port 3000]
 *
 * shoot     Backs up the run artifacts a take touches, builds Next, starts `next start` with film env (1280x800
 *           agent viewport, live model calls without the output cache, plain-code routing), then records:
 *           the record flow on the vendor portal with the real Recorder side panel (word-timed transcript at
 *           Stop), Send to Ramp straight into Bill Pay > Workflows where the workflow is learned stage by stage,
 *           its rules and recording, the evals that promote it, then invoice HSG-1011 arriving: routing picks
 *           the workflow, its agent runs (the agent's real browser is the live view inside the bill's Review tab),
 *           the run page waterfall, the Evidence tab, Dispute; then the clean HSG-1012, Approve.
 * archive   Copies the take's outputs to demo/video/film-run/ (real take) or work-film/rehearsal-run/ (--offline).
 * restore   Puts the repo's run artifacts back as they were before the take (runs right after the shoot).
 * assemble  Trims pre-roll and speeds up the waits (learning, the agent run, the second review).
 * outro / diagrams / captions   Post: end card, the four diagrams, captions + compose + .srt.
 *
 * Staged parts (see demo/video/README.md): the cursor, typing and narration are scripted (Playwright); the voice
 * is the scripted narration path (no microphone); the decisions are scripted stand-ins through the real decision
 * API; the browser frame and desktop are a stage page; display URLs are fake demo domains. Learning, the agent's
 * browsing, the receipt and (in a real take) the evals are live Claude calls; routing uses its plain-code path.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { DIAGRAMS, renderDiagram, setRunDir } from "./diagrams";
import { fontFaceCss } from "./fonts";
import { resolveAnthropicKey } from "../../config/engine";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const opt = (n: string, d: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const PHASE = opt("phase", "all");
const PORT = opt("port", "3000");
/** Rehearsal: everything in its labeled offline mode (no API cost); output never replaces the committed film. */
const OFFLINE = args.includes("--offline");
/** Skip `next build` (rehearsal iterations on an unchanged app only). */
const NO_BUILD = args.includes("--no-build");
/**
 * How the take promotes the learned version (the router only picks active workflows):
 *   real       the full skill evals with Claude (learner + judge), gate applied. Default for a real take.
 *   sample:N   the same on N sampled cases (cheaper; still real).
 *   offline    the plain-code evals (keyword grader, offline learner), gate applied. Rehearsal only.
 *   skip       no evals: the version stays a draft and routing falls back to the built-in workflow.
 */
const EVALS = opt("evals", OFFLINE ? "offline" : "real");
if (!/^(real|offline|skip|sample:\d+)$/.test(EVALS)) {
  console.error(`--evals must be real, sample:N, offline or skip (got ${EVALS})`);
  process.exit(2);
}
if (!OFFLINE && EVALS === "offline") {
  console.error("--evals offline is for rehearsals: a real take must not promote a real skill on the offline grader.");
  process.exit(2);
}
// A real take without a key would silently fall back to offline mode and film a fake run.
if (!OFFLINE && ["all", "shoot"].includes(PHASE) && !resolveAnthropicKey()) {
  console.error("No Anthropic key (RAMP_ANTHROPIC_API_KEY, ANTHROPIC_API_KEY or $HOME/ramp-teach.env): refusing a real take. Use --offline to rehearse.");
  process.exit(2);
}
const BASE = `http://localhost:${PORT}`;
const WORK = path.join(ROOT, "demo", "video", "work-film");
// Rehearsals (--offline) never overwrite the committed film or its archived run.
const OUT = path.join(OFFLINE ? WORK : path.join(ROOT, "demo", "video"), OFFLINE ? "rehearsal.mp4" : "ramp-teach-film.mp4");
const RUN_OUT = OFFLINE ? path.join(WORK, "rehearsal-run") : path.join(ROOT, "demo", "video", "film-run");
setRunDir(RUN_OUT);
const W = 1920;
const H = 1080;
const AGENT_VP = { width: 1280, height: 800 };
const SKILL_ID = "halcyon-invoice-review";
/** The offline keyword grader cannot match paraphrased rules, so offline rehearsals leave that case out. */
const REHEARSAL_SKIP_CASES = ["paraphrase"];

/** Committed run artifacts a take overwrites (backed up before the take, put back after). */
const TRACKED = [
  "receipts/HSG-1011.json",
  "receipts/decisions.jsonl",
  "runs/HSG-1011/calc.json",
  "runs/HSG-1011/evidence.json",
  "agent/trace.jsonl",
  "rules/workflow_spec.json",
  "rules/learn_meta.json",
  "rules/evals.json",
  "learn/trace.jsonl",
];
/** Paths a take creates (removed after the take; if one existed before, it is backed up and put back too). */
const NEW_OUTPUTS = [
  "receipts/HSG-1012.json",
  "runs/HSG-1011/route.json",
  "runs/HSG-1011/spans.jsonl",
  "runs/HSG-1011/evidence-check.json",
  "runs/HSG-1011/evidence",
  "runs/HSG-1012",
  `skills/${SKILL_ID}`,
  "evals/runs",
];
const TOUCHED = [...TRACKED, ...NEW_OUTPUTS];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const readJson = <T>(p: string): T => JSON.parse(fs.readFileSync(p, "utf8")) as T;
const writeJson = (p: string, v: unknown) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2) + "\n");
};
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));
const rm = (rel: string) => fs.rmSync(path.join(ROOT, rel), { recursive: true, force: true });

/* ============================ backup / restore ============================ */

const BACKUP = path.join(WORK, "backup");
const MANIFEST = path.join(BACKUP, "manifest.json");

/**
 * Backs up every path a take touches. Fresh when those paths match git (nothing changed since the last
 * commit); when they don't (a take crashed before restore), the earlier backup is kept and used.
 */
function backup() {
  const dirty = execFileSync("git", ["status", "--porcelain", "--", ...TOUCHED], { cwd: ROOT }).toString().trim();
  if (dirty) {
    if (fs.existsSync(MANIFEST)) {
      console.log("run artifacts differ from git (an earlier take did not restore); keeping the earlier backup");
      return;
    }
    throw new Error(`run artifacts differ from git and there is no backup to restore from:\n${dirty}\nPut them back first (git show HEAD:<path> > <path>, delete new files).`);
  }
  fs.rmSync(BACKUP, { recursive: true, force: true });
  const existed = TOUCHED.filter(exists);
  for (const t of existed) fs.cpSync(path.join(ROOT, t), path.join(BACKUP, t), { recursive: true });
  writeJson(MANIFEST, { at: new Date().toISOString(), existed });
}

/** Puts the touched paths back exactly as they were before the take. */
function restoreFiles() {
  if (!fs.existsSync(MANIFEST)) {
    console.log("no backup manifest; nothing to restore");
    return;
  }
  const { existed } = readJson<{ existed: string[] }>(MANIFEST);
  for (const t of TOUCHED) {
    rm(t);
    if (existed.includes(t)) fs.cpSync(path.join(BACKUP, t), path.join(ROOT, t), { recursive: true });
  }
  // Parent folders the take created (skills/, evals/runs/ parent stays: it holds committed cases).
  if (exists("skills") && fs.readdirSync(path.join(ROOT, "skills")).length === 0) rm("skills");
}

/* =============================== shoot =============================== */

async function up(): Promise<boolean> {
  return fetch(`${BASE}/bills`).then((r) => r.ok).catch(() => false);
}

async function startServer(): Promise<ChildProcess> {
  if (await up()) throw new Error(`something is already serving ${BASE}; stop it so the film server can start with film env`);
  const log = path.join(WORK, "next.log");
  const child = spawn("npx", ["next", "start", "-p", PORT], {
    cwd: ROOT,
    detached: true, // own process group, so the real next-server child stops with it
    stdio: ["ignore", fs.openSync(log, "w"), fs.openSync(log, "a")],
    env: {
      ...process.env,
      RAMP_TEACH_VIEWPORT: `${AGENT_VP.width}x${AGENT_VP.height}`, // 16:10, the live view's shape
      RAMP_TEACH_NO_CACHE: "1", // live model calls, not cache replays
      RAMP_TEACH_ROUTER: "deterministic", // routing uses its plain-code path; learn, agent and receipt stay live
      ...(OFFLINE ? { RAMP_TEACH_OFFLINE: "1" } : {}),
    },
  });
  for (let i = 0; i < 60; i++) {
    if (await up()) return child;
    await sleep(1000);
  }
  child.kill();
  throw new Error("film server did not start");
}

const post = (p: string, body: unknown) =>
  fetch(`${BASE}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getJson = (p: string) => fetch(`${BASE}${p}`, { cache: "no-store" }).then((r) => r.json()) as Promise<any>;
const billStatus = async (id: string) => (await getJson(`/api/dash/bills/${id}`))?.bill?.status as string | undefined;

/** The skill evals for the version the take learned (child process; the film waits, the cut hides it). */
function runEvals(version: number) {
  if (EVALS === "skip") return;
  const a = ["tsx", "evals/cli.ts", "--skill", SKILL_ID, "--version", String(version)];
  if (EVALS === "offline") {
    const cases = readdirJson(path.join(ROOT, "evals", "cases")).filter((c) => !REHEARSAL_SKIP_CASES.includes(c));
    a.push("--offline", "--apply-gate", "--case", cases.join(","));
  } else {
    a.push("--yes");
    if (EVALS.startsWith("sample:")) a.push("--sample", EVALS.slice(7));
  }
  const res = spawnSyncLogged("npx", a, path.join(WORK, "evals.log"));
  const gate = readGate(version);
  console.log(`evals (${EVALS}): exit ${res}, gate ${gate ? (gate.passed ? "passed" : "failed") : "not found"}`);
  if (!gate?.passed) throw new Error(`the learned version did not pass the eval gate (see ${path.relative(ROOT, path.join(WORK, "evals.log"))}); stopping the take`);
}
const readdirJson = (dir: string) =>
  fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
function spawnSyncLogged(cmd: string, a: string[], log: string): number {
  try {
    const out = execFileSync(cmd, a, { cwd: ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 });
    fs.writeFileSync(log, out);
    return 0;
  } catch (e) {
    const err = e as { status?: number; stdout?: Buffer; stderr?: Buffer };
    fs.writeFileSync(log, Buffer.concat([err.stdout ?? Buffer.alloc(0), err.stderr ?? Buffer.alloc(0)]));
    return err.status ?? 1;
  }
}
function readGate(version: number): { passed: boolean } | null {
  const dir = path.join(ROOT, "evals", "runs");
  if (!fs.existsSync(dir)) return null;
  const runs = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(`eval_${SKILL_ID}_v${version}_`) && f.endsWith(".json"))
    .sort();
  return runs.length ? readJson<{ gate: { passed: boolean } }>(path.join(dir, runs.at(-1)!)).gate : null;
}

async function shoot() {
  fs.mkdirSync(WORK, { recursive: true });
  backup();
  restoreFiles(); // start from the committed state
  rm("runtime/learn-job.json");

  // Always film the current code.
  if (!NO_BUILD) execFileSync("npx", ["next", "build"], { cwd: ROOT, stdio: "ignore" });
  const server = await startServer();
  const marks: Record<string, number> = {};
  let t0 = 0;
  try {
    await post("/api/dash/reset", { hidden: ["HSG-1011", "HSG-1012"] });

    const browser = await chromium.launch();
    const rawDir = path.join(WORK, "raw");
    fs.rmSync(rawDir, { recursive: true, force: true });
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: rawDir, size: { width: W, height: H } } });
    t0 = Date.now();
    const page = await ctx.newPage();
    const mark = (k: string) => (marks[k] = (Date.now() - t0) / 1000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const S = <T>(fn: string, ...a: unknown[]) => page.evaluate(([f, xs]) => (window as any).stage[f as string](...(xs as unknown[])), [fn, a]) as Promise<T>;

    // helpers: move the cursor to an element in the app frame, then really click it
    const frame = () => page.frameLocator("#app");
    async function to(sel: string, opts: { click?: boolean; ms?: number; dx?: number } = {}) {
      const loc = frame().locator(sel).first();
      await loc.waitFor({ timeout: 15000 });
      await loc.scrollIntoViewIfNeeded().catch(() => {});
      const box = await loc.boundingBox();
      if (!box) throw new Error(`no element for ${sel}`);
      const x = box.x + Math.min(box.width / 2, opts.dx ?? box.width / 2);
      const y = box.y + box.height / 2;
      await S("move", x, y, opts.ms);
      if (opts.click !== false) {
        await S("press");
        await page.mouse.click(x, y);
      }
    }
    async function toStage(id: string, click = true) {
      const r = await S<{ x: number; y: number }>("rect", id);
      await S("move", r.x, r.y);
      if (click) await S("press");
    }
    async function type(text: string, delay = 70) {
      await page.keyboard.type(text, { delay });
    }
    const panel = () => page.frameLocator("#panelframe");
    async function toPanel(sel: string, click = true) {
      await panel().locator(sel).first().scrollIntoViewIfNeeded();
      await sleep(250);
      const box = await panel().locator(sel).first().boundingBox();
      if (!box) throw new Error(`no panel element ${sel}`);
      await S("move", box.x + box.width / 2, box.y + box.height / 2);
      if (!click) return;
      await S("press");
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }
    /** Click something in the app that navigates, then wait for the URL to change and the page to settle. */
    async function toAndWait(sel: string) {
      const from = await S<string>("href");
      await to(sel);
      await S("urlChange", from);
    }
    const count = (sel: string) => frame().locator(sel).count();

    try {
      await page.goto(`${BASE}/stage/index.html`);
      await S("go", "/portal/login");
      mark("start");
      await S("fadeIn", 900);
      await sleep(700);

      /* ---------- Scene 1: record the review with the real Recorder extension ---------- */
      await toStage("recbtn");
      await S("openPanel");
      await sleep(500);
      await toPanel("#btn-start");
      await sleep(700);
      await toPanel("#btn-mic");
      mark("record_start");
      await sleep(700);
      await S("say", "I'm checking this month's invoice from Halcyon Staffing.");
      await to('input[name="username"]');
      await type("ap.reviewer");
      await to('input[name="password"]');
      await type("demo-only", 60);
      await sleep(200);
      await toAndWait('button:has-text("Sign in")');
      await S("say", "Every rate on it has to match our contract.");
      await sleep(1400);
      await toAndWait('a[href="/portal/invoices/HSG-1010"]');
      await S("say", "And nobody should be billed twice for the same week.");
      await to("table tbody tr:nth-child(1)", { click: false, ms: 700 });
      await to("table tbody tr:nth-child(4)", { click: false, ms: 900 });
      await sleep(1000);
      await S("say", "Then I check each person's hours against their timecard.");
      await toAndWait('a[href^="/portal/employees/E-101"]');
      await to('[data-field="approved_hours"]');
      await S("say", "Maya is approved for 40 hours. Billed hours can't go over that.");
      await sleep(2600);
      await toStage("back");
      await S("back");
      await toAndWait('a[href^="/portal/employees/E-104"]');
      await to('[data-field="approved_hours"]');
      await S("say", "Sam is approved for 36.");
      await sleep(2000);
      await toStage("back");
      await S("back");
      await S("say", "If anything is off, I dispute it and ask for a credit.");
      await sleep(2800);
      await S("unsay");
      await toPanel("#btn-stop");
      mark("record_stop");
      // Stop: the panel shows the word-timed transcript, each sentence linked to the steps it is about.
      await panel().locator("#transcript .utt").first().waitFor({ timeout: 20000 });
      await sleep(900);
      await toPanel("#transcript .utt:nth-child(5)", false);
      await sleep(1600);
      await toPanel("#transcript .utt:nth-child(5) .refs", false);
      await sleep(1500);
      writeJson(path.join(WORK, "film-recording.json"), await page.evaluate(() => (window as any).__ext.recording()));
      mark("record_end");

      /* ---------- Scene 2: Send to Ramp -> Bill Pay > Workflows learns the workflow (live) ---------- */
      await toPanel("#btn-send");
      await frame().locator('[data-testid="learn-card"]').waitFor({ timeout: 20000 });
      await sleep(400);
      await page.evaluate(() => (window as any).stage.closePanel());
      await sleep(700);
      mark("learn_start");
      await to('[data-testid="learn-card"] li[data-stage="segment"]', { click: false, ms: 900 });
      let version = 0;
      for (let i = 0; i < 1200; i++) {
        const j = await getJson("/api/teach/learn");
        if (j.learn && j.learn.status !== "running") {
          if (j.learn.status !== "done") throw new Error(`learning ${j.learn.status} (see runtime/learn-job.log)`);
          version = j.learn.version;
          break;
        }
        await sleep(500);
      }
      if (!version) throw new Error("learning did not finish in 10 minutes");
      await frame().locator('[data-testid="learn-card"][data-status="done"]').waitFor({ timeout: 10000 });
      mark("learn_done");
      await sleep(1600);
      await to('[data-testid="learn-card"] li[data-stage="package"]', { click: false, ms: 900 });
      await sleep(1200);
      await toAndWait('[data-testid="learn-version-link"]');
      await sleep(1200);
      await toAndWait('[data-testid="workflow-tabs"] [data-tab="rules"]');
      mark("rules");
      await sleep(1400);
      await to('[data-rule="r1"] button');
      await frame().locator('[data-testid="rule-lineage"]').waitFor();
      await sleep(1200);
      await to('[data-testid="rule-lineage"] code', { click: false, ms: 800 });
      await sleep(1500);
      // The recording the rules cite: waveform and the transcript lined up with the clicks.
      await toAndWait('[data-testid="rule-lineage"] a[href*="/recordings/"]');
      mark("recording");
      await sleep(1500);
      const utts = await count("[data-utterance]");
      await to(`[data-utterance]:nth-child(${Math.min(5, Math.max(1, utts))}) button`);
      await sleep(2400);

      /* ---------- Evals: the learned version must pass the gate before routing can pick it (cut in post) ---------- */
      mark("eval_start");
      runEvals(version);
      await S("go", `/bills/workflows/${SKILL_ID}?tab=evals`);
      await sleep(1200);
      mark("eval_end");
      await to('[data-testid="eval-gate"]', { click: false, ms: 900 });
      await sleep(2600);
      await toAndWait('[data-testid="workflow-page"] a[href="/bills/workflows"]');
      await to(`tr[data-workflow="${SKILL_ID}"]`, { click: false, ms: 800 });
      await sleep(2200);
      await toAndWait('[data-testid="billpay-tabs"] a[href="/bills?tab=approval"]');
      await S("move", 1100, 560, 800);
      await sleep(1000);

      /* ---------- Scene 3: HSG-1011 arrives; routing picks the workflow; its agent runs in the bill ---------- */
      await post("/api/dash/deliver", { invoice_id: "HSG-1011" });
      mark("deliver_1011");
      await frame().locator('tr[data-bill="bill_HSG-1011"]').waitFor({ timeout: 10000 });
      await sleep(1500);
      await toAndWait('tr[data-bill="bill_HSG-1011"] a');
      await frame().getByTestId("bill-page").waitFor();
      if (!(await count('[data-testid="review-tab"]'))) await toAndWait('[data-testid="bill-tabs"] [data-tab="review"]');
      await frame().locator('[data-testid="route-card"] [data-testid="run-link"]').waitFor({ timeout: 30000 });
      mark("review");
      await sleep(600);
      await to('[data-testid="route-card"]', { click: false, ms: 800, dx: 200 });
      await sleep(1800);
      await to('[data-testid="run-link"]', { click: false, ms: 700 });
      await sleep(1200);
      await frame().locator('[data-testid="live-frame"]').waitFor({ timeout: 60000 });
      mark("agent_on");
      await to('[data-testid="live-frame"]', { click: false, ms: 900 });
      // Watch the agent's browser for a while (real time, then sped up in post).
      const onAt = Date.now();
      for (let i = 0; i < 600; i++) {
        const steps = await count('[data-testid="agent-steps"] li[data-step]');
        const done = (await billStatus("bill_HSG-1011")) !== "reviewing";
        if (done || (Date.now() - onAt > 9000 && steps >= 12) || Date.now() - onAt > 120000) break;
        await sleep(400);
      }
      mark("agent_leave");
      await to('[data-testid="agent-steps"] li[data-step]:last-child', { click: false, ms: 700 });
      await sleep(1000);
      // The trigger: the workflow agent's run, under Workflows > Runs.
      await toAndWait('[data-testid="run-link"]');
      await frame().getByTestId("run-page").waitFor();
      mark("run_open");
      await sleep(1500);
      for (let i = 0; i < 1200; i++) {
        if ((await billStatus("bill_HSG-1011")) !== "reviewing") break;
        await sleep(500);
      }
      await sleep(1200); // the page's last poll
      mark("result_1011");
      await sleep(800);
      const spanSel = (await count('[data-testid="waterfall"] [data-kind="model"]'))
        ? '[data-testid="waterfall"] [data-kind="model"]'
        : '[data-testid="waterfall"] [data-kind="synthesis"]';
      await to(spanSel, { dx: 120 });
      await sleep(1200);
      await to('[data-testid="span-details"]', { click: false, ms: 800 });
      await sleep(2600);
      await toAndWait('[data-testid="open-bill"]');
      await sleep(900);
      await toAndWait('[data-testid="bill-tabs"] [data-tab="evidence"]');
      mark("evidence");
      await sleep(1200);
      await to('[data-testid="fact"]', { click: false, ms: 800, dx: 260 });
      await sleep(1300);
      await to('[data-testid="fact"]:nth-of-type(3)', { click: false, ms: 700, dx: 260 }).catch(() => {});
      await sleep(1500);
      await to('[data-testid="dispute"]');
      await frame().locator('[data-testid="decision"]').waitFor({ timeout: 10000 });
      mark("dispute");
      await sleep(3200);

      /* ---------- Scene 4: a clean invoice ---------- */
      await toAndWait('[data-testid="bill-page"] a[href="/bills"]');
      await S("move", 1100, 560, 800);
      await sleep(600);
      await post("/api/dash/deliver", { invoice_id: "HSG-1012" });
      mark("deliver_1012");
      await frame().locator('tr[data-bill="bill_HSG-1012"]').waitFor({ timeout: 10000 });
      await sleep(1200);
      await to('tr[data-bill="bill_HSG-1012"]', { click: false, ms: 800, dx: 240 });
      for (let i = 0; i < 1200; i++) {
        if ((await billStatus("bill_HSG-1012")) !== "reviewing") break;
        await sleep(500);
      }
      await sleep(1200);
      mark("ready_1012");
      await sleep(800);
      await toAndWait('tr[data-bill="bill_HSG-1012"] a');
      await frame().getByTestId("bill-page").waitFor();
      await sleep(1600);
      await to('[data-testid="agent-review"]', { click: false, ms: 800, dx: 220 }).catch(() => {});
      await sleep(1400);
      await to('[data-testid="approve"]');
      await frame().locator('[data-testid="decision"]').waitFor({ timeout: 10000 });
      mark("approve");
      await sleep(1600);
      await toAndWait('[data-testid="bill-page"] a[href="/bills"]');
      await to('[data-testid="billpay-tabs"] button:has-text("Payment required")');
      await sleep(2600);
      await S("fadeOut", 1000, "");
      await sleep(1200);
      mark("end");
    } catch (err) {
      await page.screenshot({ path: path.join(WORK, "failure.png") }).catch(() => {});
      await ctx.close();
      await browser.close();
      throw err;
    }
    await ctx.close();
    await browser.close();
    const f = fs.readdirSync(rawDir).find((x) => x.endsWith(".webm"))!;
    fs.copyFileSync(path.join(rawDir, f), path.join(WORK, "film.webm"));
    writeJson(path.join(WORK, "marks.json"), { t0: new Date(t0).toISOString(), marks, offline: OFFLINE, evals: EVALS });
    console.log("shot film.webm", marks);
  } finally {
    try {
      process.kill(-server.pid!, "SIGTERM"); // whole group: npx + next-server
    } catch {
      server.kill();
    }
    await sleep(1500);
    // Archive what the take produced (only a finished take), then put the repo back.
    let archived = false;
    if (marks.end) {
      try {
        archive();
        archived = true;
      } catch (e) {
        console.error("archive failed:", e instanceof Error ? e.message : e);
      }
    }
    if (OFFLINE || archived || !marks.end) {
      restoreFiles();
      console.log(`restored the run artifacts${OFFLINE ? " (rehearsal)" : ""}`);
    } else {
      console.error("NOT restored: the take's outputs are still in place. Fix the archive, then run --phase archive and --phase restore.");
    }
  }
}

/* ============================== assemble ============================== */

function probe(f: string, entry = "format=duration") {
  return execFileSync("ffprobe", ["-v", "error", "-show_entries", entry, "-of", "csv=p=0", f]).toString().trim();
}

type Marks = Record<string, number>;
type Wait = [number, number, number]; // from, to (film time), speed

/** Waits to speed up: each one is fitted into a target length (only when it is a real wait). */
function waitsFor(m: Marks): Wait[] {
  const fit = (a: number, b: number, target: number): Wait | null => {
    const len = b - a;
    if (!(len > target + 1)) return null;
    return [a, b, len / target];
  };
  return [
    fit(m.learn_start + 1.4, m.learn_done - 0.3, 5), // the six learning stages
    fit(m.agent_on + 7, m.agent_leave - 0.2, 4), // the agent working in the live view
    fit(m.run_open + 3.5, m.result_1011 - 0.4, 4), // the rest of the run on the run page
    fit(m.deliver_1012 + 3, m.ready_1012 - 0.3, 3), // the second review
  ].filter((w): w is Wait => w !== null);
}

function assemble() {
  const { marks } = readJson<{ marks: Marks }>(path.join(WORK, "marks.json"));
  const film = path.join(WORK, "film.webm");
  const dur = Number(probe(film));
  const start = Math.max(0, marks.start - 0.1); // drop pre-roll before the first painted frame
  const waits = waitsFor(marks);
  const parts: [number, number, number][] = [];
  let cursor = start;
  for (const [x, y, sp] of waits) {
    parts.push([cursor, x, 1], [x, y, sp]);
    cursor = y;
  }
  parts.push([cursor, dur, 1]);
  const graph = [
    `[0:v]fps=30,format=yuv420p,split=${parts.length}${parts.map((_, i) => `[s${i}]`).join("")}`,
    ...parts.map(([x, y, sp], i) => `[s${i}]trim=${x.toFixed(3)}:${y.toFixed(3)},setpts=(PTS-STARTPTS)/${sp.toFixed(4)}[p${i}]`),
    `${parts.map((_, i) => `[p${i}]`).join("")}concat=n=${parts.length}:v=1:a=0,fps=30[out]`,
  ].join(";");
  const mid = path.join(WORK, "assembled.mp4"); // high quality; the captions phase makes the final file
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", film, "-filter_complex", graph, "-map", "[out]", "-c:v", "libx264", "-preset", "medium", "-crf", "14", "-pix_fmt", "yuv420p", "-an", mid]);
  const d = Number(probe(mid));
  console.log(`wrote ${path.relative(ROOT, mid)}: ${(fs.statSync(mid).size / 1e6).toFixed(2)} MB, ${d.toFixed(1)} s; waits ${waits.map(([a, b, s]) => `${a.toFixed(1)}-${b.toFixed(1)} s at ${s.toFixed(1)}x`).join(", ") || "none"}`);
  const asm = { start, out_duration: d, waits };
  writeJson(path.join(WORK, "assemble.json"), asm);
  if (fs.existsSync(RUN_OUT)) writeJson(path.join(RUN_OUT, "assemble.json"), asm);
}

/* =============================== outro =============================== */

const OUTRO_SECONDS = 4;

/** Ramp-style outro: logo + divider + "Teach" in Lausanne on dark. Rendered frame by frame (deterministic). */
async function outro() {
  const logoSrc = fs.readFileSync(path.join(ROOT, "components", "dash", "RampLogo.tsx"), "utf8");
  const WORD = /const WORD = "([^"]+)"/.exec(logoSrc)![1];
  const MARK = /const MARK = "([^"]+)"/.exec(logoSrc)![1];
  const ease = "cubic-bezier(.2,.8,.2,1)";
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    ${fontFaceCss()}
    html,body { margin:0; width:${W}px; height:${H}px; background: #121211; overflow:hidden; font-family: Lausanne, Inter, sans-serif; color: #fff; }
    .stage { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:44px; }
    .lockup { display:flex; align-items:center; gap:34px; }
    .logo { height:92px; width:auto; opacity:0; transform: translateY(26px); animation: up .75s ${ease} .15s forwards; }
    .div { width:2px; height:96px; background: rgb(80,77,74); transform: scaleY(0); transform-origin: top; animation: grow .5s ${ease} .55s forwards; }
    .teach { font-size:96px; font-weight:400; letter-spacing:-.02em; line-height:1; opacity:0; transform: translateX(-18px); animation: slide .65s ${ease} .7s forwards; }
    @keyframes up { to { opacity:1; transform:none; } }
    @keyframes grow { to { transform: scaleY(1); } }
    @keyframes slide { to { opacity:1; transform:none; } }
  </style></head><body><div class="stage">
    <div class="lockup">
      <svg class="logo" viewBox="0 0 227 61" fill="currentColor" aria-label="Ramp"><path d="${WORD}"/><path d="${MARK}"/></svg>
      <span class="div"></span><span class="teach">Teach</span>
    </div>
  </div></body></html>`;
  const dir = path.join(WORK, "outro");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const fontOk = await page.evaluate(() => document.fonts.check("400 96px Lausanne"));
  await page.evaluate(() => document.getAnimations().forEach((a) => a.pause()));
  const frames = OUTRO_SECONDS * 30;
  for (let i = 0; i < frames; i++) {
    await page.evaluate((t) => document.getAnimations().forEach((a) => (a.currentTime = t)), (i / 30) * 1000);
    await page.screenshot({ path: path.join(dir, `f${String(i).padStart(4, "0")}.png`) });
  }
  await browser.close();
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", "30", "-i", path.join(dir, "f%04d.png"), "-c:v", "libx264", "-preset", "medium", "-crf", "14", "-pix_fmt", "yuv420p", path.join(WORK, "outro.mp4")]);
  console.log(`outro: ${frames} frames, Lausanne loaded: ${fontOk}`);
}

/* ============================== diagrams ============================== */

async function diagrams() {
  const src = fs.readFileSync(path.join(ROOT, "components", "dash", "RampLogo.tsx"), "utf8");
  const logos = { word: /const WORD = "([^"]+)"/.exec(src)![1], mark: /const MARK = "([^"]+)"/.exec(src)![1] };
  for (const d of DIAGRAMS) {
    await renderDiagram(d, path.join(WORK, `diag-${d.id}.mp4`), WORK, logos);
    console.log(`diagram ${d.id}: ${d.duration}s`);
  }
}

/* ============================== captions ============================== */

/**
 * Voice-over captions for the whole take (the narrator's lines while recording are already in the take, said by
 * the stage). Times are film times from the take's marks; the speed-ups are mapped out. Plain words, short.
 */
function voiceover(m: Marks): [number, number, string][] {
  // "Sped up" is said only when that wait really was sped up.
  const spedAgent = waitsFor(m).some(([x]) => Math.abs(x - (m.agent_on + 7)) < 0.01);
  const lines: [number, number, string][] = [
    [m.start + 0.3, m.record_start + 0.2, "I record myself checking one invoice from our staffing vendor."],
    [m.record_stop + 0.6, m.record_end, "When I stop, my words show up next to the steps they go with."],
    [m.record_end + 0.2, m.learn_start + 0.2, "I send the recording to Ramp."],
    [m.learn_start + 0.5, m.learn_done + 2.6, "Bill Pay learns a new workflow from it, one stage at a time."],
    [m.learn_done + 2.9, m.rules + 1.2, "Here is what it learned."],
    [m.rules + 1.5, m.recording - 0.2, "Each rule points back to what I said and where I clicked."],
    [m.recording + 0.3, m.eval_start, "The recording keeps my words in time with my clicks."],
    [m.eval_end + 0.3, m.eval_end + 4.6, "Its evals ran, and every gate held."],
    [m.eval_end + 4.9, m.deliver_1011 - 0.2, "So this version is now the active workflow."],
    [m.deliver_1011 + 0.2, m.review - 0.2, "Now a new invoice from the same vendor arrives."],
    [m.review, m.agent_on + 0.4, "Ramp picks the workflow that fits and starts its agent."],
    [m.agent_on + 0.6, Math.min(m.agent_on + 6.8, m.agent_leave + 1.2), "The agent's own browser runs right here in the bill."],
    [m.agent_on + 7.0, m.agent_leave + 1.2, spedAgent ? "Sped up, it reads each timecard the same way I did." : "It reads each timecard the same way I did."],
    [m.agent_leave + 1.4, m.result_1011 + 0.6, "The run is under Workflows, with every model turn and tool call."],
    [m.result_1011 + 0.9, m.evidence - 0.3, "Each step shows its tokens, cost and request ID."],
    [m.evidence, m.evidence + 3.6, "Every fact it found was read again from the page by plain code."],
    [m.evidence + 3.8, m.dispute + 2.6, "Three problems, $3,448 to credit. I dispute it. The agent never approves or pays."],
    [m.deliver_1012 + 0.2, m.ready_1012 - 0.2, "Next, a clean invoice from the same vendor."],
    [m.ready_1012, m.end - 3.0, "Everything checks out. One click from me, and it moves on to payment."],
  ];
  // A line that would be too short to read (a wait that did not happen) is left out.
  return lines.filter(([a, b]) => b - a >= 1);
}

/** Diagram cut points, in film time: `at` cuts away, `resume` comes back (later than `at` when the take is cut). */
function slotsFor(m: Marks): { at: number; resume: number; id: string }[] {
  return [
    { at: m.record_end, resume: m.record_end, id: "voice" }, // after the transcript, before Send to Ramp
    { at: m.eval_start, resume: m.eval_end, id: "skill" }, // covers the eval run (cut out of the take)
    { at: m.dispute + 2.8, resume: m.dispute + 2.8, id: "execution" }, // after the dispute
    { at: m.end - 2.9, resume: m.end - 2.9, id: "trace" }, // after the approval, then the outro
  ];
}

const srtTime = (t: number) => {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3600000), mi = Math.floor((ms % 3600000) / 60000), se = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:${String(se).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};

async function captions() {
  const { t0, marks } = readJson<{ t0: string; marks: Marks }>(path.join(WORK, "marks.json"));
  const asm = readJson<{ start: number; out_duration: number; waits: Wait[] }>(path.join(WORK, "assemble.json"));
  // film time -> assembled time (drop pre-roll, compress the sped-up waits)
  const out = (t: number) => {
    let o = t - asm.start;
    for (const [x, y, sp] of asm.waits) if (t > x) o -= (Math.min(t, y) - x) * (1 - 1 / sp);
    return Math.max(0, Math.min(asm.out_duration, o));
  };
  const lines = voiceover(marks).map(([a, b, text]) => ({ from: out(a), to: out(b), text }));
  if (lines.some((l) => /simulat/i.test(l.text))) throw new Error("caption text must not say simulated");

  // Render each caption as a transparent full-frame PNG in the stage's subtitle style.
  const dir = path.join(WORK, "captions");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  for (const [i, l] of lines.entries()) {
    await page.setContent(
      `<!doctype html><html><head><style>${fontFaceCss([])}</style></head><body style="margin:0;background:transparent;width:${W}px;height:${H}px;font-family:Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased">` +
        `<div style="position:absolute;left:50%;bottom:46px;transform:translateX(-50%);max-width:1300px;width:max-content;background:rgba(18,18,18,.84);color:#fff;font-size:30px;line-height:1.35;font-weight:500;text-align:center;padding:14px 28px;border-radius:14px">${l.text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</div></body></html>`,
    );
    await page.screenshot({ path: path.join(dir, `c${i}.png`), omitBackground: true });
  }
  await browser.close();

  // Overlay with soft fades (0.3 s), like the stage subtitles.
  const inputs = ["-i", path.join(WORK, "assembled.mp4")];
  let graph = "";
  let last = "0:v";
  lines.forEach((l, i) => {
    const d = Math.max(0.6, l.to - l.from);
    inputs.push("-loop", "1", "-t", d.toFixed(2), "-i", path.join(dir, `c${i}.png`));
    graph += `[${i + 1}:v]format=rgba,fade=in:st=0:d=0.3:alpha=1,fade=out:st=${(d - 0.3).toFixed(2)}:d=0.3:alpha=1,setpts=PTS-STARTPTS+${l.from.toFixed(3)}/TB[c${i}];`;
    graph += `[${last}][c${i}]overlay=0:0:eof_action=pass[v${i}];`;
    last = `v${i}`;
  });
  // Captioned main (high quality); compose cuts it and crossfades in the diagrams and the outro.
  const captioned = path.join(WORK, "captioned.mp4");
  graph = graph.replace(/;$/, "");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", graph, "-map", `[${last}]`, "-c:v", "libx264", "-preset", "medium", "-crf", "14", "-pix_fmt", "yuv420p", "-an", captioned]);

  // ---- compose: main parts and the diagrams, crossfaded, then the outro ----
  // Main part n runs from the previous slot's resume to slot n's cut; the take after the last slot is dropped.
  const XF = 0.5;
  const slots = slotsFor(marks).map((s) => ({ at: out(s.at), resume: out(s.resume), id: s.id }));
  const dur = (f: string) => Number(probe(f));
  const diag = slots.map((s) => {
    const d = DIAGRAMS.find((x) => x.id === s.id)!;
    const file = path.join(WORK, `diag-${d.id}.mp4`);
    return { d, file, len: dur(file) };
  });
  const outroFile = path.join(WORK, "outro.mp4");
  type Seg = { kind: "main" | "diag" | "outro"; a?: number; b?: number; len: number; diagIdx?: number };
  const segs: Seg[] = [];
  slots.forEach((s, n) => {
    const a = n === 0 ? 0 : slots[n - 1].resume;
    segs.push({ kind: "main", a, b: s.at, len: s.at - a }, { kind: "diag", diagIdx: n, len: diag[n].len });
  });
  segs.push({ kind: "outro", len: dur(outroFile) });
  const starts: number[] = [];
  segs.forEach((g, i) => starts.push(i === 0 ? 0 : starts[i - 1] + segs[i - 1].len - XF));
  const cin = ["-i", captioned, ...diag.flatMap((x) => ["-i", x.file]), "-i", outroFile];
  let cg = `[0:v]split=${slots.length}${slots.map((_, n) => `[m${n}]`).join("")};`;
  let mi = 0;
  segs.forEach((g, i) => {
    const norm = "fps=30,format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS";
    if (g.kind === "main") cg += `[m${mi++}]trim=${g.a!.toFixed(3)}:${g.b!.toFixed(3)},${norm}[g${i}];`;
    else if (g.kind === "diag") cg += `[${g.diagIdx! + 1}:v]${norm}[g${i}];`;
    else cg += `[${diag.length + 1}:v]${norm}[g${i}];`;
  });
  let acc = "g0";
  let accLen = segs[0].len;
  for (let i = 1; i < segs.length; i++) {
    const outLabel = i === segs.length - 1 ? "final" : `x${i}`;
    cg += `[${acc}][g${i}]xfade=transition=fade:duration=${XF}:offset=${(accLen - XF).toFixed(3)}[${outLabel}];`;
    acc = outLabel;
    accLen += segs[i].len - XF;
  }
  cg = cg.replace(/;$/, "");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...cin, "-filter_complex", cg, "-map", "[final]", "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", OUT]);

  // assembled time -> final time (main part n is segment 2n); null inside a cut or after the last slot
  const partOf = (t: number) => slots.findIndex((s, n) => t >= (n === 0 ? 0 : slots[n - 1].resume) && t < s.at);
  const fin = (t: number, n: number) => starts[2 * n] + (t - segs[2 * n].a!);
  // Voice-over script (.srt): the captions plus the narration lines said during recording (times from the recording).
  const rec = readJson<{ steps: { ts: string; kind: string; detail: { text?: string } }[] }>(path.join(WORK, "film-recording.json"));
  const said = rec.steps
    .filter((s) => s.kind === "narration")
    .map((s) => {
      const ft = (Date.parse(s.ts) - Date.parse(t0)) / 1000;
      return { from: out(ft), to: out(ft) + 2.8, text: s.detail.text ?? "" };
    });
  const diagLines = diag.flatMap((x, i) => x.d.captions.map((c) => ({ from: starts[2 * i + 1] + c.t0, to: starts[2 * i + 1] + c.t1, text: c.text })));
  // A cue never runs past the cut that ends its part of the take.
  const mainLines = [...lines, ...said].flatMap((l) => {
    const n = partOf(l.from);
    if (n < 0) return [];
    return [{ from: fin(l.from, n), to: fin(Math.min(l.to, slots[n].at - 0.05), n), text: l.text }];
  });
  const all = [...mainLines, ...diagLines].sort((x, y) => x.from - y.from);
  all.forEach((l, i) => {
    if (all[i + 1]) l.to = Math.min(l.to, all[i + 1].from - 0.1);
  });
  for (let i = all.length - 1; i >= 0; i--) if (all[i].to - all[i].from < 0.4) all.splice(i, 1);
  const srt = all.map((l, i) => `${i + 1}\n${srtTime(l.from)} --> ${srtTime(l.to)}\n${l.text}\n`).join("\n");
  if (/simulat/i.test(srt)) throw new Error("the voice-over script must not say simulated");
  fs.writeFileSync(OUT.replace(/\.mp4$/, ".voiceover.srt"), srt);
  const slotLog = slots.map((s, n) => `${s.id} at ${starts[2 * n + 1].toFixed(1)} s (${diag[n].len.toFixed(1)} s)`).join(", ");
  console.log(`wrote ${path.relative(ROOT, OUT)}: ${(fs.statSync(OUT).size / 1e6).toFixed(2)} MB, ${Number(probe(OUT)).toFixed(1)} s, ${lines.length} voice-over captions; diagrams ${slotLog}; script ${path.relative(ROOT, OUT.replace(/\.mp4$/, ".voiceover.srt"))}`);
}

/* =============================== archive =============================== */

const jsonlSince = (file: string, t0: string, key = "ts") =>
  fs.existsSync(file)
    ? fs
        .readFileSync(file, "utf8")
        .split("\n")
        .filter((l) => l && String(JSON.parse(l)[key] ?? "") >= t0)
    : [];

/**
 * Copies the take's outputs to RUN_OUT: receipts, traces, decisions, the learned skill version (package and
 * stages), the eval run, the route decisions, spans, evidence checks and field crops, the usage ledger (with
 * request ids), the recording Send to Ramp uploaded (with its word-timed transcript) and the marks.
 */
function archive() {
  const { t0 } = readJson<{ t0: string }>(path.join(WORK, "marks.json"));
  fs.mkdirSync(RUN_OUT, { recursive: true });
  const put = (src: string, dst: string) => {
    const abs = path.join(ROOT, src);
    const to = path.join(RUN_OUT, dst);
    fs.rmSync(to, { recursive: true, force: true });
    if (fs.existsSync(abs)) fs.cpSync(abs, to, { recursive: true });
  };
  const putLines = (dst: string, lines: string[]) => fs.writeFileSync(path.join(RUN_OUT, dst), lines.length ? lines.join("\n") + "\n" : "");
  for (const id of ["HSG-1011", "HSG-1012"]) {
    put(`receipts/${id}.json`, `receipt-${id}.json`);
    put(`runs/${id}/route.json`, `route-${id}.json`);
    put(`runs/${id}/spans.jsonl`, `spans-${id}.jsonl`);
    put(`runs/${id}/evidence-check.json`, `evidence-check-${id}.json`);
  }
  put("runs/HSG-1011/evidence", "evidence-HSG-1011");
  putLines("trace.jsonl", jsonlSince(path.join(ROOT, "agent", "trace.jsonl"), t0));
  putLines("learn-trace.jsonl", jsonlSince(path.join(ROOT, "learn", "trace.jsonl"), t0));
  putLines("decisions.jsonl", jsonlSince(path.join(ROOT, "receipts", "decisions.jsonl"), t0, "decided_at"));
  putLines("usage.jsonl", jsonlSince(path.join(ROOT, "runtime", "usage.jsonl"), t0));
  // rules/ as synced from the learned version when it passed the gate
  put("rules/workflow_spec.json", "learned-workflow_spec.json");
  put("rules/learn_meta.json", "learned-learn_meta.json");
  // The learned skill version and its eval run.
  const job = fs.existsSync(path.join(ROOT, "runtime", "learn-job.json"))
    ? readJson<{ recording_path?: string; version?: number | null; started_at?: string }>(path.join(ROOT, "runtime", "learn-job.json"))
    : null;
  fs.rmSync(path.join(RUN_OUT, "skill"), { recursive: true, force: true });
  if (job?.version && (job.started_at ?? "") >= t0) put(`skills/${SKILL_ID}/v${job.version}`, "skill");
  fs.rmSync(path.join(RUN_OUT, "eval-run.json"), { force: true });
  const evalDir = path.join(ROOT, "evals", "runs");
  if (job?.version && fs.existsSync(evalDir)) {
    const runs = fs
      .readdirSync(evalDir)
      .filter((f) => f.startsWith(`eval_${SKILL_ID}_v${job.version}_`) && f.endsWith(".json"))
      .filter((f) => readJson<{ created_at: string }>(path.join(evalDir, f)).created_at >= t0)
      .sort();
    if (runs.length) put(`evals/runs/${runs.at(-1)}`, "eval-run.json");
  }
  if (job?.recording_path) put(job.recording_path, "sent-recording.json");
  for (const f of ["film-recording.json", "marks.json"]) {
    if (fs.existsSync(path.join(WORK, f))) fs.copyFileSync(path.join(WORK, f), path.join(RUN_OUT, f));
  }
  console.log(`archived the take to ${path.relative(ROOT, RUN_OUT)}`);
}

(async () => {
  if (PHASE === "all" || PHASE === "shoot") await shoot(); // archives and restores at its end
  if (PHASE === "archive") archive();
  if (PHASE === "all" || PHASE === "assemble") assemble();
  if (["all", "assemble", "captions", "outro", "diagrams"].includes(PHASE)) {
    if (PHASE !== "captions" || !fs.existsSync(path.join(WORK, "outro.mp4"))) await outro();
    if (PHASE === "diagrams" || PHASE === "all" || DIAGRAMS.some((d) => !fs.existsSync(path.join(WORK, `diag-${d.id}.mp4`)))) await diagrams();
    await captions();
  }
  if (PHASE === "restore") {
    restoreFiles();
    console.log("restored the run artifacts");
  }
})().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
