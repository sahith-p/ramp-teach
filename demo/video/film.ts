/**
 * Product film: one continuous take of the stage (public/stage/index.html) at 1920x1080, then post.
 *
 *   npx tsx demo/video/film.ts [--phase all|shoot|archive|assemble|post|restore]
 *                              [--offline] [--evals fast|real|sample:N|skip] [--no-build] [--port 3000] [--target 180]
 *
 * shoot     Backs up the run artifacts a take touches, builds Next, starts `next start` with film env (1280x800
 *           agent viewport, live model calls without the output cache, plain-code routing), then records:
 *           the record flow on the vendor portal with the real Recorder side panel (word-timed transcript at
 *           Stop), Send to Ramp straight into Bill Pay > Workflows where the workflow is learned stage by stage,
 *           its rules and recording, the evals that promote it, then invoice HSG-1011 arriving: routing picks
 *           the workflow, its agent runs (the agent's real browser is the live view inside the bill's Review tab),
 *           the run page waterfall, the Evidence tab, Dispute; then the clean HSG-1012, Approve.
 * archive   Copies the take's outputs to demo/video/film-run/ (real take) or work-film/rehearsal-run/ (--offline),
 *           including the correction replay (`npm run eval`) as eval-replay.txt/json.
 * restore   Puts the repo's run artifacts back as they were before the take (runs right after the shoot). A real
 *           take keeps the learned skill version and rules/ synced from it.
 * assemble  Trims pre-roll, cuts the eval wait and fits the other waits so the finished film lands on --target
 *           seconds; writes the MASTER TAKE (footage only, no captions, no screens): demo/video/master/take.mp4 +
 *           take.json for a real take, work-film/master/ for a rehearsal. Then runs post.
 * post      From the master take + the take's archive ONLY (no browser take, no API calls, no raw footage):
 *           renders the intro, the technical sections, the close card and the outro (diagrams.ts), burns the
 *           footage captions, composes the final MP4 and writes the voice-over .srt. Use it to apply any change to
 *           a screen or a caption without refilming.
 *
 * Staged parts (see demo/video/README.md): the cursor, typing and narration are scripted (Playwright); the voice
 * is the scripted narration path (no microphone); the decisions are scripted stand-ins through the real decision
 * API; the browser frame and desktop are a stage page; display URLs are fake demo domains; the skill evals in the
 * take use the plain-code graders. Learning, the agent's browsing and the receipt are live Claude calls; routing
 * uses its plain-code path.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import crypto from "node:crypto";
import { BANNED, SECTIONS, disputeFacts, parseReplay, renderSection, sectionById, setRunDir } from "./diagrams";
import { fontFaceCss } from "./fonts";
import { resolveAnthropicKey } from "../../config/engine";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const opt = (n: string, d: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const PHASE = opt("phase", "all");
if (!["all", "shoot", "archive", "assemble", "post", "diagrams", "captions", "restore"].includes(PHASE)) {
  console.error(`unknown --phase ${PHASE}`);
  process.exit(2);
}
const PORT = opt("port", "3000");
/** Rehearsal: everything in its labeled offline mode (no API cost); output never replaces the committed film. */
const OFFLINE = args.includes("--offline");
/** Skip `next build` (rehearsal iterations on an unchanged app only). */
const NO_BUILD = args.includes("--no-build");
/**
 * How the take promotes the learned version (the router only picks active workflows):
 *   fast       the plain-code skill evals (offline learner, keyword grader; the paraphrase case left out, which
 *              that grader cannot match), gate applied. Default for rehearsals AND real takes (owner decision:
 *              a take does not wait for the live evals). Its eval run is archived, never kept in evals/runs.
 *   real       the full skill evals with Claude (learner + judge), gate applied; the real eval run is kept.
 *   sample:N   the same on N sampled cases (cheaper; still real).
 *   skip       no evals: the version stays a draft and routing falls back to the built-in workflow.
 * ("offline" is accepted as another name for fast.)
 */
const EVALS = opt("evals", "fast").replace(/^offline$/, "fast");
if (!/^(real|fast|skip|sample:\d+)$/.test(EVALS)) {
  console.error(`--evals must be fast, real, sample:N or skip (got ${EVALS})`);
  process.exit(2);
}
/** Target length of the finished film in seconds (assemble fits the waits to it). */
const TARGET = Number(opt("target", "180"));
// A real take without a key would silently fall back to offline mode and film a fake run.
if (!OFFLINE && ["all", "shoot"].includes(PHASE) && !resolveAnthropicKey()) {
  console.error("No Anthropic key (RAMP_ANTHROPIC_API_KEY, ANTHROPIC_API_KEY or $HOME/ramp-teach.env): refusing a real take. Use --offline to rehearse.");
  process.exit(2);
}
const BASE = `http://localhost:${PORT}`;
const WORK = path.join(ROOT, "demo", "video", "work-film");
// Rehearsals (--offline) never overwrite the committed film, its archived run or the committed master take.
const OUT = path.join(OFFLINE ? WORK : path.join(ROOT, "demo", "video"), OFFLINE ? "rehearsal.mp4" : "ramp-teach-demo.mp4");
const RUN_OUT = OFFLINE ? path.join(WORK, "rehearsal-run") : path.join(ROOT, "demo", "video", "film-run");
const MASTER_DIR = OFFLINE ? path.join(WORK, "master") : path.join(ROOT, "demo", "video", "master");
const MASTER_MP4 = path.join(MASTER_DIR, "take.mp4");
const MASTER_JSON = path.join(MASTER_DIR, "take.json");
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

/**
 * What a real take leaves in the repo (owner decision): the learned skill version and rules/ as synced from it
 * (the active version); with --evals real|sample also the real eval run (the artifact guard allows only real
 * runs in evals/runs). Everything else is put back. Rehearsals keep nothing.
 */
const KEEP_AFTER_REAL_TAKE = [`skills/${SKILL_ID}`, "rules/workflow_spec.json", "rules/learn_meta.json"];
function realEvalRuns(): { rel: string; body: Buffer }[] {
  const dir = path.join(ROOT, "evals", "runs");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(`eval_${SKILL_ID}_`) && f.endsWith(".json"))
    .filter((f) => readJson<{ mode?: string }>(path.join(dir, f)).mode === "real")
    .map((f) => ({ rel: `evals/runs/${f}`, body: fs.readFileSync(path.join(dir, f)) }));
}

/** Puts the touched paths back exactly as they were before the take (minus `keep`, which stays as the take left it). */
function restoreFiles(keep: string[] = []) {
  if (!fs.existsSync(MANIFEST)) {
    console.log("no backup manifest; nothing to restore");
    return;
  }
  const { existed } = readJson<{ existed: string[] }>(MANIFEST);
  const keptRuns = keep.includes("evals/runs:real") ? realEvalRuns() : [];
  for (const t of TOUCHED) {
    if (keep.includes(t)) continue;
    rm(t);
    if (existed.includes(t)) fs.cpSync(path.join(BACKUP, t), path.join(ROOT, t), { recursive: true });
  }
  for (const r of keptRuns) {
    fs.mkdirSync(path.dirname(path.join(ROOT, r.rel)), { recursive: true });
    fs.writeFileSync(path.join(ROOT, r.rel), r.body);
  }
  if (keep.length) console.log(`kept from the take: ${[...keep.filter((k) => !k.includes(":")), ...keptRuns.map((r) => r.rel)].join(", ")}`);
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
  if (EVALS === "fast") {
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
      await S("fadeIn", 800);
      await sleep(400);

      /* ---------- Scene 1: record the review with the real Recorder extension ---------- */
      await toStage("recbtn");
      await S("openPanel");
      await sleep(350);
      await toPanel("#btn-start");
      await sleep(450);
      await toPanel("#btn-mic");
      mark("record_start");
      await sleep(500);
      await S("say", "I'm checking this month's invoice from Halcyon Staffing.");
      await to('input[name="username"]');
      await type("ap.reviewer");
      await to('input[name="password"]');
      await type("demo-only", 60);
      await sleep(200);
      await toAndWait('button:has-text("Sign in")');
      await S("say", "Every rate on it has to match our contract.");
      await sleep(1100);
      await toAndWait('a[href="/portal/invoices/HSG-1010"]');
      await S("say", "And nobody should be billed twice for the same week.");
      await to("table tbody tr:nth-child(1)", { click: false, ms: 600 });
      await to("table tbody tr:nth-child(4)", { click: false, ms: 800 });
      await sleep(700);
      await S("say", "Then I check each person's hours against their timecard.");
      await toAndWait('a[href^="/portal/employees/E-101"]');
      await to('[data-field="approved_hours"]');
      await S("say", "Maya is approved for 40 hours. Billed hours can't go over that.");
      await sleep(2400);
      await toStage("back");
      await S("back");
      await toAndWait('a[href^="/portal/employees/E-104"]');
      await to('[data-field="approved_hours"]');
      await S("say", "Sam is approved for 36.");
      await sleep(1700);
      await toStage("back");
      await S("back");
      await S("say", "If anything is off, I dispute it and ask for a credit.");
      await sleep(2600);
      await S("unsay");
      await toPanel("#btn-stop");
      mark("record_stop");
      // Stop: the panel shows the word-timed transcript, each sentence linked to the steps it is about.
      await panel().locator("#transcript .utt").first().waitFor({ timeout: 20000 });
      await sleep(700);
      await toPanel("#transcript .utt:nth-child(5)", false);
      await sleep(1300);
      await toPanel("#transcript .utt:nth-child(5) .refs", false);
      await sleep(1200);
      writeJson(path.join(WORK, "film-recording.json"), await page.evaluate(() => (window as any).__ext.recording()));
      mark("record_end");

      /* ---------- Scene 2: Send to Ramp -> Bill Pay > Workflows learns the workflow (live) ---------- */
      await toPanel("#btn-send");
      await frame().locator('[data-testid="learn-card"]').waitFor({ timeout: 20000 });
      await sleep(900); // Send to Ramp has landed in Bill Pay > Workflows (the overview cuts in at learn_start)
      await page.evaluate(() => (window as any).stage.closePanel());
      await sleep(600);
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
      await sleep(1000);
      await to('[data-testid="learn-card"] li[data-stage="package"]', { click: false, ms: 700 });
      await sleep(700);
      await toAndWait('[data-testid="learn-version-link"]');
      await sleep(800);
      await toAndWait('[data-testid="workflow-tabs"] [data-tab="rules"]');
      mark("rules");
      await sleep(1000);
      await to('[data-rule="r1"] button');
      await frame().locator('[data-testid="rule-lineage"]').waitFor();
      await sleep(900);
      await to('[data-testid="rule-lineage"] code', { click: false, ms: 700 });
      await sleep(1100);
      // The recording the rules cite: waveform and the transcript lined up with the clicks.
      await toAndWait('[data-testid="rule-lineage"] a[href*="/recordings/"]');
      mark("recording");
      await sleep(1000);
      const utts = await count("[data-utterance]");
      await to(`[data-utterance]:nth-child(${Math.min(5, Math.max(1, utts))}) button`);
      await sleep(1800);

      /* ---------- Evals: the learned version must pass the gate before routing can pick it (cut in post) ---------- */
      mark("eval_start");
      runEvals(version);
      await S("go", `/bills/workflows/${SKILL_ID}?tab=evals`);
      await sleep(1200);
      mark("eval_end");
      await to('[data-testid="eval-gate"]', { click: false, ms: 800 });
      await sleep(2000);
      await toAndWait('[data-testid="workflow-page"] a[href="/bills/workflows"]');
      await to(`tr[data-workflow="${SKILL_ID}"]`, { click: false, ms: 700 });
      await sleep(1600);
      await toAndWait('[data-testid="billpay-tabs"] a[href="/bills?tab=approval"]');
      await S("move", 1100, 560, 700);
      await sleep(600);

      /* ---------- Scene 3: HSG-1011 arrives; routing picks the workflow; its agent runs in the bill ---------- */
      await post("/api/dash/deliver", { invoice_id: "HSG-1011" });
      mark("deliver_1011");
      await frame().locator('tr[data-bill="bill_HSG-1011"]').waitFor({ timeout: 10000 });
      await sleep(1100);
      await toAndWait('tr[data-bill="bill_HSG-1011"] a');
      await frame().getByTestId("bill-page").waitFor();
      if (!(await count('[data-testid="review-tab"]'))) await toAndWait('[data-testid="bill-tabs"] [data-tab="review"]');
      await frame().locator('[data-testid="route-card"] [data-testid="run-link"]').waitFor({ timeout: 30000 });
      mark("review");
      await sleep(500);
      await to('[data-testid="route-card"]', { click: false, ms: 700, dx: 200 });
      await sleep(1500);
      await to('[data-testid="run-link"]', { click: false, ms: 600 });
      await sleep(900);
      await frame().locator('[data-testid="live-frame"]').waitFor({ timeout: 60000 });
      mark("agent_on");
      await to('[data-testid="live-frame"]', { click: false, ms: 900 });
      // Watch the agent's browser for a while (real time, then sped up in post).
      const onAt = Date.now();
      for (let i = 0; i < 600; i++) {
        const steps = await count('[data-testid="agent-steps"] li[data-step]');
        const done = (await billStatus("bill_HSG-1011")) !== "reviewing";
        if (done || (Date.now() - onAt > 8000 && steps >= 12) || Date.now() - onAt > 120000) break;
        await sleep(400);
      }
      mark("agent_leave");
      await to('[data-testid="agent-steps"] li[data-step]:last-child', { click: false, ms: 600 });
      await sleep(700);
      // The trigger: the workflow agent's run, under Workflows > Runs.
      await toAndWait('[data-testid="run-link"]');
      await frame().getByTestId("run-page").waitFor();
      mark("run_open");
      await sleep(1200);
      for (let i = 0; i < 1200; i++) {
        if ((await billStatus("bill_HSG-1011")) !== "reviewing") break;
        await sleep(500);
      }
      await sleep(1200); // the page's last poll
      mark("result_1011");
      await sleep(500);
      const spanSel = (await count('[data-testid="waterfall"] [data-kind="model"]'))
        ? '[data-testid="waterfall"] [data-kind="model"]'
        : '[data-testid="waterfall"] [data-kind="synthesis"]';
      await to(spanSel, { dx: 120 });
      await sleep(900);
      await to('[data-testid="span-details"]', { click: false, ms: 700 });
      await sleep(2000);
      await toAndWait('[data-testid="open-bill"]');
      await sleep(600);
      await toAndWait('[data-testid="bill-tabs"] [data-tab="evidence"]');
      mark("evidence");
      await sleep(900);
      await to('[data-testid="fact"]', { click: false, ms: 700, dx: 260 });
      await sleep(1100);
      await to('[data-testid="fact"]:nth-of-type(3)', { click: false, ms: 600, dx: 260 }).catch(() => {});
      await sleep(1200);
      await to('[data-testid="dispute"]');
      await frame().locator('[data-testid="decision"]').waitFor({ timeout: 10000 });
      mark("dispute");
      await sleep(3200);

      /* ---------- Scene 4: a clean invoice ---------- */
      await toAndWait('[data-testid="bill-page"] a[href="/bills"]');
      await S("move", 1100, 560, 700);
      await sleep(400);
      await post("/api/dash/deliver", { invoice_id: "HSG-1012" });
      mark("deliver_1012");
      await frame().locator('tr[data-bill="bill_HSG-1012"]').waitFor({ timeout: 10000 });
      await sleep(900);
      await to('tr[data-bill="bill_HSG-1012"]', { click: false, ms: 700, dx: 240 });
      for (let i = 0; i < 1200; i++) {
        if ((await billStatus("bill_HSG-1012")) !== "reviewing") break;
        await sleep(500);
      }
      await sleep(1200);
      mark("ready_1012");
      await sleep(500);
      await toAndWait('tr[data-bill="bill_HSG-1012"] a');
      await frame().getByTestId("bill-page").waitFor();
      await sleep(1200);
      await to('[data-testid="agent-review"]', { click: false, ms: 700, dx: 220 }).catch(() => {});
      await sleep(1000);
      await to('[data-testid="approve"]');
      await frame().locator('[data-testid="decision"]').waitFor({ timeout: 10000 });
      mark("approve");
      await sleep(1200);
      await toAndWait('[data-testid="bill-page"] a[href="/bills"]');
      await to('[data-testid="billpay-tabs"] button:has-text("Payment required")');
      await sleep(2400);
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
      // A finished real take keeps its learned version and rules/ (see KEEP_AFTER_REAL_TAKE).
      const keep = !OFFLINE && archived ? [...KEEP_AFTER_REAL_TAKE, ...(EVALS === "real" || EVALS.startsWith("sample:") ? ["evals/runs:real"] : [])] : [];
      restoreFiles(keep);
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
interface Asm {
  start: number;
  out_duration: number;
  waits: Wait[];
}
interface Slot {
  at: number;
  resume: number;
  id: string;
}
/** Crossfade between every two segments of the finished film (s). */
const XF = 0.5;

/** Screen cut points, in film time: `at` cuts away, `resume` comes back (later than `at` when the take is cut). */
function slotsFor(m: Marks): Slot[] {
  return [
    { at: m.record_end, resume: m.record_end, id: "record" }, // after the transcript, before Send to Ramp
    { at: m.learn_start, resume: m.learn_start, id: "overview" }, // Send to Ramp has landed in Workflows
    { at: m.eval_start, resume: m.eval_end, id: "learning" }, // covers the eval run (cut out of the take)
    { at: m.dispute + 2.8, resume: m.dispute + 2.8, id: "execution" }, // after the dispute
    { at: m.end - 2.9, resume: m.end - 2.9, id: "evaluation" }, // after the approval, then the close and the outro
  ];
}
/** Order of the finished film: intro, then main part n + slot n for every slot, then close and outro. */
const sectionLength = () => {
  const ids = ["intro", ...slotsFor({}).map((s) => s.id), "close", "outro"];
  return { total: ids.reduce((a, id) => a + sectionById(id).duration, 0), segments: 1 + 2 * slotsFor({}).length + 2 };
};

/**
 * The waits and holds assemble may speed up, each [from, to, target, min] in film time. At k = 1 each is fitted to its
 * target; when the film would still be longer than --target, k goes down and the targets move toward their
 * minimums. A wait shorter than its target (+0.5 s) plays at normal speed. The eval run is always cut short
 * (the learning section covers it).
 */
function elastic(m: Marks): [number, number, number, number][] {
  /** A hold of footage (cursor moves, pages settling): normal speed unless the film is too long, then up to 1.35x. */
  const hold = (a: number, b: number): [number, number, number, number] => [a, b, b - a, (b - a) / 1.35];
  return [
    hold(m.start + 1.0, m.record_start - 0.3), // opening the Recorder side panel
    [m.learn_start + 1.4, m.learn_done - 0.3, 4, 2.5], // the six learning stages
    hold(m.learn_done + 0.2, m.rules - 0.2), // View v1, Rules tab
    hold(m.rules + 0.2, m.eval_start - 0.2), // rule lineage, recording page
    [m.eval_start + 0.05, m.eval_end - 0.05, 0.3, 0.3], // the eval run (cut behind the learning section)
    hold(m.eval_end + 0.2, m.deliver_1011 - 0.2), // Evals tab, Workflows table, For approval
    hold(m.deliver_1011 + 0.2, m.agent_on - 0.2), // HSG-1011 arrives, routing card
    [m.agent_on + 4.5, m.agent_leave - 0.2, 5, 3], // the agent working in the live view, after 4.5 s at real speed
    [m.run_open + 3, m.result_1011 - 0.4, 3, 1.5], // the rest of the run on the run page
    hold(m.result_1011 + 0.2, m.evidence - 0.2), // a model span's tokens, cost, request id
    hold(m.evidence + 0.2, m.dispute - 0.2), // Evidence tab
    [m.deliver_1012 + 2.5, m.ready_1012 - 0.3, 3, 1.5], // the second review
    hold(m.ready_1012 + 0.2, m.end - 3.0), // HSG-1012 bill, Approve, Payment required
  ];
}
function waitsAt(m: Marks, k: number): Wait[] {
  return elastic(m)
    .map(([a, b, target, min]): Wait | null => {
      const len = b - a;
      const t = min + k * (target - min);
      return Number.isFinite(len) && len > t + 0.5 ? [a, b, len / t] : null;
    })
    .filter((w): w is Wait => w !== null)
    .sort((x, y) => x[0] - y[0]);
}
/** film time -> assembled (master) time: drop pre-roll, compress the sped-up waits. */
const mapper = (asm: Asm) => (t: number) => {
  let o = t - asm.start;
  for (const [x, y, sp] of asm.waits) if (t > x) o -= (Math.min(t, y) - x) * (1 - 1 / sp);
  return Math.max(0, Math.min(asm.out_duration, o));
};
/** Length of the finished film for a given assembly (footage parts + every section, minus the crossfades). */
function estimate(m: Marks, asm: Asm): number {
  const out = mapper(asm);
  const slots = slotsFor(m);
  let used = 0;
  slots.forEach((s, n) => (used += out(s.at) - (n === 0 ? 0 : out(slots[n - 1].resume))));
  const sec = sectionLength();
  return used + sec.total - XF * (sec.segments - 1);
}

function assemble() {
  const { t0, marks, offline, evals } = readJson<{ t0: string; marks: Marks; offline?: boolean; evals?: string }>(path.join(WORK, "marks.json"));
  const film = path.join(WORK, "film.webm");
  const dur = Number(probe(film));
  const start = Math.max(0, marks.start - 0.1); // drop pre-roll before the first painted frame
  const asmFor = (k: number): Asm => {
    const waits = waitsAt(marks, k);
    const cut = waits.reduce((a, [x, y, sp]) => a + (y - x) * (1 - 1 / sp), 0);
    return { start, out_duration: dur - start - cut, waits };
  };
  // Fit the film to TARGET: k = 1 unless that is too long, then the largest k that fits (bisection).
  let k = 1;
  if (estimate(marks, asmFor(1)) > TARGET + 2.5) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (estimate(marks, asmFor(mid)) > TARGET) hi = mid;
      else lo = mid;
    }
    k = lo;
  }
  const waits = asmFor(k).waits;
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
  // The master take: the assembled footage only (no captions, no screens), kept small enough to commit.
  fs.mkdirSync(MASTER_DIR, { recursive: true });
  const CRF = 21;
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", film, "-filter_complex", graph, "-map", "[out]", "-c:v", "libx264", "-preset", "slow", "-crf", String(CRF), "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", MASTER_MP4]);
  const d = Number(probe(MASTER_MP4));
  const asm: Asm = { start, out_duration: d, waits };
  const out = mapper(asm);
  const est = estimate(marks, asm);
  const sha = (f: string) => (fs.existsSync(f) ? crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex").slice(0, 16) : null);
  const runRel = path.relative(ROOT, RUN_OUT);
  writeJson(MASTER_JSON, {
    note: "Master take: the assembled footage without captions or screens. `npx tsx demo/video/film.ts --phase post` rebuilds the film from this file, take.mp4 and the take's archive.",
    created_at: new Date().toISOString(),
    offline: !!offline,
    evals: evals ?? null,
    t0,
    marks,
    assemble: asm,
    fit: { target_s: TARGET, k: Number(k.toFixed(3)), estimate_s: Number(est.toFixed(1)) },
    slots: slotsFor(marks).map((s) => ({ ...s, at_master: Number(out(s.at).toFixed(3)), resume_master: Number(out(s.resume).toFixed(3)) })),
    film_run: { dir: runRel, sha256_16: Object.fromEntries(["marks.json", "usage.jsonl", "trace.jsonl", "sent-recording.json", "film-recording.json"].map((f) => [f, sha(path.join(RUN_OUT, f))])) },
    video: { file: "take.mp4", bytes: fs.statSync(MASTER_MP4).size, duration_s: d, crf: CRF, size: `${W}x${H}`, fps: 30 },
  });
  if (fs.existsSync(RUN_OUT)) writeJson(path.join(RUN_OUT, "assemble.json"), asm);
  console.log(
    `master take ${path.relative(ROOT, MASTER_MP4)}: ${(fs.statSync(MASTER_MP4).size / 1e6).toFixed(2)} MB, ${d.toFixed(1)} s; waits ${waits.map(([a, b, s]) => `${a.toFixed(1)}-${b.toFixed(1)} s at ${s.toFixed(1)}x`).join(", ") || "none"}; fit k=${k.toFixed(2)}, film about ${est.toFixed(1)} s (target ${TARGET} s)`,
  );
}

/* ============================== post: captions, screens, compose ============================== */

/**
 * Voice-over captions for the footage (the narrator's lines while recording are already in the take, said by
 * the stage). Times are film times from the take's marks; the speed-ups are mapped out. Plain words, short.
 */
function voiceover(m: Marks, asm: Asm): [number, number, string][] {
  // "Sped up" is said only when that wait really was sped up.
  const spedAgent = asm.waits.some(([x, , sp]) => Math.abs(x - (m.agent_on + 4.5)) < 0.01 && sp > 1.5);
  const dispute = disputeFacts();
  const problems = dispute && dispute.fails > 0 ? `${["No", "One", "Two", "Three", "Four", "Five", "Six"][dispute.fails] ?? dispute.fails} ${dispute.fails === 1 ? "problem" : "problems"}${dispute.credit ? `, ${dispute.credit.replace(/\.00$/, "")} to credit` : ""}. ` : "";
  const lines: [number, number, string][] = [
    [m.start + 0.3, m.record_start + 0.2, "I record myself checking one invoice from our staffing vendor."],
    [m.record_stop + 0.5, m.record_end, "When I stop, each sentence shows up linked to the steps it describes."],
    [m.record_end + 0.2, m.learn_start, "I send it to Ramp."],
    [m.learn_start + 0.4, m.learn_done + 1.6, "Bill Pay learns the workflow, one stage at a time."],
    [m.learn_done + 1.8, m.rules + 0.9, "Here is what it learned."],
    [m.rules + 1.1, m.recording - 0.2, "Each rule points back to what I said and where I clicked."],
    [m.recording + 0.3, m.eval_start, "The recording keeps my words in time with my clicks."],
    [m.eval_end + 0.3, m.deliver_1011 - 0.2, "It passed its evals, so v1 is now the active workflow."],
    [m.deliver_1011 + 0.2, m.review - 0.2, "A new invoice from the same vendor arrives."],
    [m.review, m.agent_on + 0.4, "Ramp picks the workflow and starts its agent."],
    [m.agent_on + 0.4, Math.min(m.agent_on + 4.4, m.agent_leave + 1.2), "The agent's own browser runs right here in the bill."],
    [m.agent_on + 4.6, m.agent_leave + 1.2, spedAgent ? "Sped up, it reads each timecard the way I did." : "It reads each timecard the way I did."],
    [m.agent_leave + 1.4, m.result_1011 + 0.6, "The run is under Workflows, every model turn and tool call."],
    [m.result_1011 + 0.9, m.evidence - 0.3, "Each step has its tokens, cost and request ID."],
    [m.evidence, m.evidence + 3.2, "Every fact was read again from its page by plain code."],
    [m.evidence + 3.4, m.dispute + 2.6, `${problems}I dispute it. The agent never approves or pays.`],
    [m.deliver_1012 + 0.2, m.ready_1012 - 0.2, "Next, a clean invoice from the same vendor."],
    [m.ready_1012, m.end - 3.0, "Everything checks out. One click from me, and it moves on to payment."],
  ];
  // A line that would be too short to read (a wait that did not happen) is left out.
  return lines.filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b - a >= 1);
}

const srtTime = (t: number) => {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3600000), mi = Math.floor((ms % 3600000) / 60000), se = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:${String(se).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};

/**
 * Post: needs only the master take (take.mp4 + take.json) and the take's archive (RUN_OUT). Renders every
 * screen from diagrams.ts, burns the footage captions, composes the film and writes the voice-over script.
 */
async function postProduce() {
  if (!fs.existsSync(MASTER_JSON) || !fs.existsSync(MASTER_MP4)) throw new Error(`no master take at ${path.relative(ROOT, MASTER_DIR)} (shoot a take, or run --phase assemble in the container that shot it)`);
  const take = readJson<{ t0: string; marks: Marks; assemble: Asm }>(MASTER_JSON);
  const { marks, assemble: asm } = take;
  const dir = path.join(WORK, "post");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  // 1. Screens (intro, the five technical sections, close, outro), read from the archive.
  const src = fs.readFileSync(path.join(ROOT, "components", "dash", "RampLogo.tsx"), "utf8");
  const logos = { word: /const WORD = "([^"]+)"/.exec(src)![1], mark: /const MARK = "([^"]+)"/.exec(src)![1] };
  for (const s of SECTIONS) {
    await renderSection(s, path.join(dir, `sec-${s.id}.mp4`), dir, logos);
    console.log(`screen ${s.id}: ${s.duration} s`);
  }

  // 2. Footage captions as PNG overlays on the master.
  const out = mapper(asm);
  const lines = voiceover(marks, asm).map(([a, b, text]) => ({ from: out(a), to: out(b), text }));
  for (const l of lines) if (BANNED.test(l.text)) throw new Error(`caption has banned wording: ${l.text}`);
  const capDir = path.join(dir, "captions");
  fs.mkdirSync(capDir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  for (const [i, l] of lines.entries()) {
    await page.setContent(
      `<!doctype html><html><head><style>${fontFaceCss([])}</style></head><body style="margin:0;background:transparent;width:${W}px;height:${H}px;font-family:Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased">` +
        `<div style="position:absolute;left:50%;bottom:46px;transform:translateX(-50%);max-width:1300px;width:max-content;background:rgba(18,18,18,.84);color:#fff;font-size:30px;line-height:1.35;font-weight:500;text-align:center;padding:14px 28px;border-radius:14px">${l.text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</div></body></html>`,
    );
    await page.screenshot({ path: path.join(capDir, `c${i}.png`), omitBackground: true });
  }
  await browser.close();
  const inputs = ["-i", MASTER_MP4];
  let graph = "";
  let last = "0:v";
  lines.forEach((l, i) => {
    const d = Math.max(0.6, l.to - l.from);
    inputs.push("-loop", "1", "-t", d.toFixed(2), "-i", path.join(capDir, `c${i}.png`));
    graph += `[${i + 1}:v]format=rgba,fade=in:st=0:d=0.3:alpha=1,fade=out:st=${(d - 0.3).toFixed(2)}:d=0.3:alpha=1,setpts=PTS-STARTPTS+${l.from.toFixed(3)}/TB[c${i}];`;
    graph += `[${last}][c${i}]overlay=0:0:eof_action=pass[v${i}];`;
    last = `v${i}`;
  });
  const captioned = path.join(dir, "captioned.mp4");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", graph.replace(/;$/, ""), "-map", `[${last}]`, "-c:v", "libx264", "-preset", "medium", "-crf", "14", "-pix_fmt", "yuv420p", "-an", captioned]);

  // 3. Compose: intro, main part n + screen n for every slot, close, outro; 0.5 s crossfades.
  const slots = slotsFor(marks).map((s) => ({ at: out(s.at), resume: out(s.resume), id: s.id }));
  const file = (id: string) => path.join(dir, `sec-${id}.mp4`);
  const dur = (f: string) => Number(probe(f));
  type Seg = { kind: "main" | "sec"; id?: string; a?: number; b?: number; len: number };
  const segs: Seg[] = [{ kind: "sec", id: "intro", len: dur(file("intro")) }];
  slots.forEach((s, n) => {
    const a = n === 0 ? 0 : slots[n - 1].resume;
    segs.push({ kind: "main", a, b: s.at, len: s.at - a }, { kind: "sec", id: s.id, len: dur(file(s.id)) });
  });
  segs.push({ kind: "sec", id: "close", len: dur(file("close")) }, { kind: "sec", id: "outro", len: dur(file("outro")) });
  const starts: number[] = [];
  segs.forEach((g, i) => starts.push(i === 0 ? 0 : starts[i - 1] + segs[i - 1].len - XF));
  const secSegs = segs.filter((g) => g.kind === "sec");
  const cin = ["-i", captioned, ...secSegs.flatMap((g) => ["-i", file(g.id!)])];
  const mains = segs.filter((g) => g.kind === "main").length;
  let cg = `[0:v]split=${mains}${Array.from({ length: mains }, (_, n) => `[m${n}]`).join("")};`;
  let mi = 0, si = 0;
  const norm = "fps=30,format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS";
  segs.forEach((g, i) => {
    if (g.kind === "main") cg += `[m${mi++}]trim=${g.a!.toFixed(3)}:${g.b!.toFixed(3)},${norm}[g${i}];`;
    else cg += `[${++si}:v]${norm}[g${i}];`;
  });
  let acc = "g0";
  let accLen = segs[0].len;
  for (let i = 1; i < segs.length; i++) {
    const lab = i === segs.length - 1 ? "final" : `x${i}`;
    cg += `[${acc}][g${i}]xfade=transition=fade:duration=${XF}:offset=${(accLen - XF).toFixed(3)}[${lab}];`;
    acc = lab;
    accLen += segs[i].len - XF;
  }
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...cin, "-filter_complex", cg.replace(/;$/, ""), "-map", "[final]", "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", OUT]);

  // 4. Voice-over script (.srt): footage captions, the narration said during recording, every screen's captions.
  const mainIdx = segs.map((g, i) => (g.kind === "main" ? i : -1)).filter((i) => i >= 0);
  const partOf = (t: number) => mainIdx.findIndex((i) => t >= segs[i].a! && t < segs[i].b!);
  const fin = (t: number, n: number) => starts[mainIdx[n]] + (t - segs[mainIdx[n]].a!);
  const rec = readMaybeJson<{ steps: { ts: string; kind: string; detail: { text?: string } }[] }>(path.join(RUN_OUT, "film-recording.json"));
  const said = (rec?.steps ?? [])
    .filter((s) => s.kind === "narration")
    .map((s) => {
      const ft = (Date.parse(s.ts) - Date.parse(take.t0)) / 1000;
      return { from: out(ft), to: out(ft) + 2.8, text: s.detail.text ?? "" };
    });
  const secLines = segs.flatMap((g, i) => (g.kind === "sec" ? sectionById(g.id!).captions.map((c) => ({ from: starts[i] + c.t0, to: starts[i] + c.t1, text: c.text })) : []));
  const mainLines = [...lines, ...said].flatMap((l) => {
    const n = partOf(l.from);
    if (n < 0) return [];
    return [{ from: fin(l.from, n), to: fin(Math.min(l.to, segs[mainIdx[n]].b! - 0.05), n), text: l.text }];
  });
  const all = [...mainLines, ...secLines].sort((x, y) => x.from - y.from);
  all.forEach((l, i) => {
    if (all[i + 1]) l.to = Math.min(l.to, all[i + 1].from - 0.1);
  });
  for (let i = all.length - 1; i >= 0; i--) if (all[i].to - all[i].from < 0.4) all.splice(i, 1);
  const srt = all.map((l, i) => `${i + 1}\n${srtTime(l.from)} --> ${srtTime(l.to)}\n${l.text}\n`).join("\n");
  if (BANNED.test(srt)) throw new Error("the voice-over script has banned wording");
  fs.writeFileSync(OUT.replace(/\.mp4$/, ".voiceover.srt"), srt);
  const total = Number(probe(OUT));
  const log = segs.map((g, i) => `${g.kind === "sec" ? g.id : "footage"} ${starts[i].toFixed(1)}`).join(", ");
  console.log(`wrote ${path.relative(ROOT, OUT)}: ${(fs.statSync(OUT).size / 1e6).toFixed(2)} MB, ${total.toFixed(1)} s (target ${TARGET} s), ${lines.length} footage captions; ${log}`);
}
const readMaybeJson = <T>(p: string): T | null => (fs.existsSync(p) ? readJson<T>(p) : null);

/* =============================== archive =============================== */

const jsonlSince = (file: string, t0: string, key = "ts") =>
  fs.existsSync(file)
    ? fs
        .readFileSync(file, "utf8")
        .split("\n")
        .filter((l) => l && String(JSON.parse(l)[key] ?? "") >= t0)
    : [];

/**
 * Copies the take's outputs to RUN_OUT: receipts, traces, decisions, calc reports (with credit amounts), the
 * learned skill version (package and stages), the eval run, the route decisions, spans, evidence checks and field
 * crops, the usage ledger (with request ids), the recording Send to Ramp uploaded (with its word-timed
 * transcript), the correction replay and the marks.
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
    put(`runs/${id}/calc.json`, `calc-${id}.json`); // calc's findings with the credit amounts it computed
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
  // The correction replay (`npm run eval`: calc on past corrections and invoices, plain code), as of this take.
  const replayLog = path.join(RUN_OUT, "eval-replay.txt");
  spawnSyncLogged("npx", ["tsx", "learn/run-evals.ts"], replayLog);
  const replay = parseReplay(fs.readFileSync(replayLog, "utf8"));
  if (replay) writeJson(path.join(RUN_OUT, "eval-replay.json"), replay);
  else fs.rmSync(path.join(RUN_OUT, "eval-replay.json"), { force: true });
  for (const f of ["film-recording.json", "marks.json"]) {
    if (fs.existsSync(path.join(WORK, f))) fs.copyFileSync(path.join(WORK, f), path.join(RUN_OUT, f));
  }
  console.log(`archived the take to ${path.relative(ROOT, RUN_OUT)}`);
}

(async () => {
  if (PHASE === "all" || PHASE === "shoot") await shoot(); // archives and restores at its end
  if (PHASE === "archive") archive();
  if (PHASE === "all" || PHASE === "assemble") assemble();
  // post needs only the master take + the archive; "diagrams" and "captions" are kept as names for it.
  if (["all", "assemble", "post", "diagrams", "captions"].includes(PHASE)) await postProduce();
  if (PHASE === "restore") {
    restoreFiles();
    console.log("restored the run artifacts");
  }
})().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
