/**
 * Product film: one continuous take of the stage (public/stage/index.html) at 1920x1080.
 *
 *   npx tsx demo/video/film.ts [--phase all|shoot|assemble|restore] [--port 3000]
 *
 * shoot     Starts `next start` with film env (agent browser recording, 1280x800 agent viewport, live model
 *           calls without the output cache), backs up the committed real-run artifacts, resets the inbox,
 *           then records: the record flow on the vendor portal (the stage's Recorder captures the real
 *           events; narrator subtitles), learning, the bill-pay dashboard, invoice HSG-1011 arriving, the
 *           agent reviewing it live (its own browser recorded), Dispute, then the clean HSG-1012 arriving,
 *           "Looks good", Approve.
 * assemble  Overlays the agent's recorded browser into the stage's agent window (aligned by wall clock),
 *           speeds up the second review wait, encodes H.264 MP4.
 * restore   Archives this run's outputs to demo/video/film-run/ and restores the committed artifacts.
 *
 * Staged parts (see demo/video/README.md): the cursor and narration are scripted (Playwright), the browser
 * frame and desktop are a stage page, display URLs are fake demo domains. The app, the agent's browsing,
 * its checks and its recommendation are the real system running.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const opt = (n: string, d: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const PHASE = opt("phase", "all");
const PORT = opt("port", "3000");
const BASE = `http://localhost:${PORT}`;
const WORK = path.join(ROOT, "demo", "video", "work-film");
const OUT = path.join(ROOT, "demo", "video", "ramp-teach-film.mp4");
const RUN_OUT = path.join(ROOT, "demo", "video", "film-run");
const W = 1920;
const H = 1080;
const AGENT_VP = { width: 1280, height: 800 };

const TRACKED = [
  "receipts/HSG-1011.json",
  "receipts/decisions.jsonl",
  "runs/HSG-1011/calc.json",
  "runs/HSG-1011/evidence.json",
  "agent/trace.jsonl",
];
const NEW_OUTPUTS = ["receipts/HSG-1012.json", "runs/HSG-1012"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const readJson = <T>(p: string): T => JSON.parse(fs.readFileSync(p, "utf8")) as T;
const writeJson = (p: string, v: unknown) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2) + "\n");
};

/* =============================== shoot =============================== */

async function up(): Promise<boolean> {
  return fetch(`${BASE}/login`).then((r) => r.ok).catch(() => false);
}

async function startServer(): Promise<ChildProcess> {
  if (await up()) throw new Error(`something is already serving ${BASE}; stop it so the film server can start with film env`);
  const child = spawn("npx", ["next", "start", "-p", PORT], {
    cwd: ROOT,
    stdio: ["ignore", fs.openSync(path.join(WORK, "next.log"), "w"), fs.openSync(path.join(WORK, "next.log"), "a")],
    env: {
      ...process.env,
      RAMP_TEACH_FILM_DIR: path.join(WORK, "agent"),
      RAMP_TEACH_VIEWPORT: `${AGENT_VP.width}x${AGENT_VP.height}`,
      RAMP_TEACH_NO_CACHE: "1", // live model calls, not cache replays
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
const getBill = (id: string) => fetch(`${BASE}/api/dash/bills/${id}`).then((r) => r.json()) as Promise<any>;

async function shoot() {
  fs.mkdirSync(WORK, { recursive: true });
  // Back up committed artifacts once.
  const backup = path.join(WORK, "backup");
  if (!fs.existsSync(backup)) {
    for (const t of TRACKED) {
      const src = path.join(ROOT, t);
      if (fs.existsSync(src)) {
        fs.mkdirSync(path.dirname(path.join(backup, t)), { recursive: true });
        fs.copyFileSync(src, path.join(backup, t));
      }
    }
  }
  fs.rmSync(path.join(WORK, "agent"), { recursive: true, force: true });
  for (const n of NEW_OUTPUTS) fs.rmSync(path.join(ROOT, n), { recursive: true, force: true });

  const server = await startServer();
  const marks: Record<string, number> = {};
  try {
    await post("/api/dash/reset", { hidden: ["HSG-1011", "HSG-1012"] });

    const browser = await chromium.launch();
    const rawDir = path.join(WORK, "raw");
    fs.rmSync(rawDir, { recursive: true, force: true });
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: rawDir, size: { width: W, height: H } } });
    const t0 = Date.now();
    const page = await ctx.newPage();
    const mark = (k: string) => (marks[k] = (Date.now() - t0) / 1000);
    const S = <T>(fn: string, ...a: unknown[]) => page.evaluate(([f, xs]) => (window as any).stage[f as string](...(xs as unknown[])), [fn, a]) as Promise<T>;

    // helpers: move the cursor to an element in the app frame, then really click it
    const frame = () => page.frameLocator("#app");
    async function to(sel: string, opts: { click?: boolean; ms?: number; dx?: number } = {}) {
      const box = await frame().locator(sel).first().boundingBox();
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
    async function waitLoad() {
      await page.waitForTimeout(150);
      await frame().locator("body").waitFor();
      await page.waitForTimeout(450);
    }

    await page.goto(`${BASE}/stage/index.html`);
    await S("go", "/portal/login");
    mark("start");
    await S("fadeIn", 900);
    await sleep(700);

    /* ---------- Scene 1: record the review ---------- */
    await toStage("recbtn");
    await S("panel", true);
    await sleep(800);
    await toStage("startbtn");
    await S("startRecording");
    mark("record_start");
    await sleep(500);
    await S("say", "I'm checking this month's invoice from Halcyon Staffing.");
    await to('input[name="username"]');
    await type("ap.reviewer");
    await to('input[name="password"]');
    await type("demo-only", 60);
    await sleep(200);
    await to('button:has-text("Sign in")');
    await waitLoad();
    await S("say", "Every rate on it has to match our contract.");
    await sleep(1200);
    await to('a[href="/portal/invoices/HSG-1010"]');
    await waitLoad();
    await S("say", "And nobody should be billed twice for the same week.");
    await to("table tbody tr:nth-child(1)", { click: false, ms: 700 });
    await to("table tbody tr:nth-child(4)", { click: false, ms: 900 });
    await sleep(900);
    await S("say", "Then I check each person's hours against their timecard.");
    await to('a[href^="/portal/employees/E-101"]');
    await waitLoad();
    await to('[data-field="approved_hours"]');
    await S("say", "Maya is approved for 40 hours. Billed hours can't go over that.");
    await sleep(2400);
    await toStage("back");
    await S("back");
    await to('a[href^="/portal/employees/E-104"]');
    await waitLoad();
    await to('[data-field="approved_hours"]');
    await S("say", "Sam is approved for 36.");
    await sleep(1800);
    await toStage("back");
    await S("back");
    await S("say", "If anything is off, I dispute it and ask for a credit.");
    await sleep(2600);
    await S("unsay");
    await toStage("stopbtn");
    const recording = await S<unknown>("stopRecording");
    writeJson(path.join(WORK, "film-recording.json"), recording);
    mark("record_end");

    /* ---------- Scene 2: learn ---------- */
    const spec = readJson<{ rules: string[] }>(path.join(ROOT, "rules", "workflow_spec.json"));
    await S("learning", `<div style="font-size:14px;display:flex;align-items:center;gap:10px"><span class="spin"></span>Learning from your recording</div>`);
    await sleep(2400);
    await S(
      "learning",
      `<div style="font-weight:650;font-size:15px;margin-bottom:10px">${spec.rules.length} rules learned</div>` +
        spec.rules
          .slice(0, 4)
          .map((r) => `<div class="step" style="font-style:normal"><span style="color:#17633a">✓</span><span>${r.replace(/</g, "&lt;")}</span></div>`)
          .join("") +
        `<div style="margin-top:12px"><button class="btn dark" id="openrules">Open workflow</button></div>`,
    );
    await sleep(2200);
    await toStage("openrules");
    await S("go", "/learn");
    await S("panel", false);
    await sleep(1600);
    await page.frameLocator("#app").locator("body").evaluate(() => window.scrollTo({ top: 380, behavior: "smooth" }));
    await sleep(2600);
    mark("learn_end");

    /* ---------- Scene 3: the dashboard, an invoice arrives ---------- */
    await S("fadeOut", 700);
    await S("go", "/login");
    await S("fadeIn", 700);
    await to('input[name="email"]');
    await type("alex@northwind.test", 55);
    await to('input[name="password"]');
    await type("northwind", 50);
    await to('button:has-text("Sign in")');
    await waitLoad();
    await S("move", 1100, 520, 800);
    await sleep(1600);

    await post("/api/dash/deliver", { invoice_id: "HSG-1011" });
    mark("deliver_1011");
    await frame().locator('tr[data-bill="bill_HSG-1011"]').waitFor({ timeout: 8000 });
    await sleep(1400);
    await to('tr[data-bill="bill_HSG-1011"] a');
    await frame().getByTestId("bill-drawer").waitFor();
    await sleep(900);

    // The agent's own browser, in its window (its pixels are composited in assemble).
    const win = { left: 150, top: 230, width: 1000, height: 86 + Math.round((1000 * AGENT_VP.height) / AGENT_VP.width) };
    await S("agentWindow", true, win);
    mark("agent_on");
    await sleep(800);
    writeJson(path.join(WORK, "agent-rect.json"), await S("agentContentRect"));
    for (let i = 0; i < 240; i++) {
      const v = await getBill("bill_HSG-1011");
      if (v.activity?.url) await S("agentUrl", v.activity.url);
      const done = v.activity?.steps?.some((s: any) => s.text === "Compared billed hours to timecards");
      if (done || v.bill?.status !== "reviewing") break;
      await sleep(400);
    }
    mark("agent_off");
    await S("agentWindow", false);
    for (let i = 0; i < 120; i++) {
      const v = await getBill("bill_HSG-1011");
      if (v.bill?.status !== "reviewing") break;
      await sleep(500);
    }
    mark("result_1011");
    await sleep(1800);
    await to('[data-testid="agent-review"] li:nth-child(1)', { click: false, ms: 700 });
    await sleep(900);
    await to('[data-testid="agent-review"] li:nth-child(3)', { click: false, ms: 700 });
    await sleep(1200);
    await to('button:has-text("Dispute")');
    await sleep(2200);
    await to('[aria-label="Close"] svg');
    await sleep(1200);

    /* ---------- Scene 4: a clean invoice ---------- */
    await post("/api/dash/deliver", { invoice_id: "HSG-1012" });
    mark("deliver_1012");
    await frame().locator('tr[data-bill="bill_HSG-1012"]').waitFor({ timeout: 8000 });
    await sleep(1400);
    await to('tr[data-bill="bill_HSG-1012"] a');
    await frame().getByTestId("bill-drawer").waitFor();
    await sleep(2500);
    mark("fast_start");
    for (let i = 0; i < 240; i++) {
      const v = await getBill("bill_HSG-1012");
      if (v.bill?.status !== "reviewing") break;
      await sleep(500);
    }
    mark("fast_end");
    await sleep(2000);
    await to('button:has-text("Approve")');
    await sleep(2200);
    await to('[aria-label="Close"] svg');
    await sleep(900);
    await to('button:has-text("Approved")');
    await sleep(2600);
    await S("fadeOut", 1000, "Ramp Teach");
    await sleep(1800);
    mark("end");

    await ctx.close();
    await browser.close();
    const f = fs.readdirSync(rawDir).find((x) => x.endsWith(".webm"))!;
    fs.copyFileSync(path.join(rawDir, f), path.join(WORK, "film.webm"));
    writeJson(path.join(WORK, "marks.json"), { t0: new Date(t0).toISOString(), marks });
    console.log("shot film.webm", marks);
  } finally {
    server.kill();
    await sleep(800);
  }
}

/* ============================== assemble ============================== */

function probe(f: string, entry = "format=duration") {
  return execFileSync("ffprobe", ["-v", "error", "-show_entries", entry, "-of", "csv=p=0", f]).toString().trim();
}

function assemble() {
  const { t0, marks } = readJson<{ t0: string; marks: Record<string, number> }>(path.join(WORK, "marks.json"));
  const rect = readJson<{ x: number; y: number; w: number; h: number }>(path.join(WORK, "agent-rect.json"));
  const agentDir = path.join(WORK, "agent", "agent-HSG-1011");
  const agentWebm = fs.readdirSync(agentDir).find((x) => x.endsWith(".webm"))!;
  const agentStart = readJson<{ started_at: string }>(path.join(agentDir, "video-start.json")).started_at;
  const offset = (Date.parse(agentStart) - Date.parse(t0)) / 1000; // agent video t=0 at this film time
  const film = path.join(WORK, "film.webm");
  const dur = Number(probe(film));
  const on = marks.agent_on + 0.6;
  const off = marks.agent_off;
  const a = marks.fast_start + 0.5;
  const b = marks.fast_end - 0.3;
  const SPEED = 5;
  const start = Math.max(0, marks.start - 0.1); // drop pre-roll before the first painted frame

  const graph = [
    `[1:v]setpts=PTS-STARTPTS+${offset.toFixed(3)}/TB,scale=${rect.w}:${rect.h}[ag]`,
    `[0:v][ag]overlay=${rect.x}:${rect.y}:eof_action=pass:enable='between(t,${on.toFixed(2)},${off.toFixed(2)})',fps=30,format=yuv420p,split=3[s1][s2][s3]`,
    `[s1]trim=${start.toFixed(2)}:${a.toFixed(2)},setpts=PTS-STARTPTS[p1]`,
    `[s2]trim=${a.toFixed(2)}:${b.toFixed(2)},setpts=(PTS-STARTPTS)/${SPEED}[p2]`,
    `[s3]trim=${b.toFixed(2)}:${dur.toFixed(2)},setpts=PTS-STARTPTS[p3]`,
    `[p1][p2][p3]concat=n=3:v=1:a=0,fps=30[out]`,
  ].join(";");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", film, "-i", path.join(agentDir, agentWebm), "-filter_complex", graph, "-map", "[out]", "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", OUT]);
  const d = Number(probe(OUT));
  console.log(`wrote ${path.relative(ROOT, OUT)}: ${(fs.statSync(OUT).size / 1e6).toFixed(2)} MB, ${d.toFixed(1)} s (agent overlay ${on.toFixed(1)}-${off.toFixed(1)} s, offset ${offset.toFixed(2)} s; wait ${a.toFixed(1)}-${b.toFixed(1)} s at ${SPEED}x)`);
  writeJson(path.join(WORK, "assemble.json"), { offset, on, off, a, b, SPEED, start, rect, out_duration: d });
}

/* =============================== restore =============================== */

function restore() {
  fs.mkdirSync(RUN_OUT, { recursive: true });
  for (const [src, dst] of [
    ["receipts/HSG-1011.json", "receipt-HSG-1011.json"],
    ["receipts/HSG-1012.json", "receipt-HSG-1012.json"],
  ]) {
    if (fs.existsSync(path.join(ROOT, src))) fs.copyFileSync(path.join(ROOT, src), path.join(RUN_OUT, dst));
  }
  const { t0 } = readJson<{ t0: string }>(path.join(WORK, "marks.json"));
  const trace = fs
    .readFileSync(path.join(ROOT, "agent", "trace.jsonl"), "utf8")
    .split("\n")
    .filter((l) => l && JSON.parse(l).ts >= t0);
  fs.writeFileSync(path.join(RUN_OUT, "trace.jsonl"), trace.join("\n") + "\n");
  const decisions = fs.readFileSync(path.join(ROOT, "receipts", "decisions.jsonl"), "utf8").split("\n").filter(Boolean);
  fs.writeFileSync(path.join(RUN_OUT, "decisions.jsonl"), decisions.filter((l) => JSON.parse(l).decided_at >= t0).join("\n") + "\n");
  for (const f of ["film-recording.json", "marks.json", "assemble.json"]) {
    if (fs.existsSync(path.join(WORK, f))) fs.copyFileSync(path.join(WORK, f), path.join(RUN_OUT, f));
  }
  const backup = path.join(WORK, "backup");
  for (const t of TRACKED) if (fs.existsSync(path.join(backup, t))) fs.copyFileSync(path.join(backup, t), path.join(ROOT, t));
  for (const n of NEW_OUTPUTS) fs.rmSync(path.join(ROOT, n), { recursive: true, force: true });
  console.log(`archived to ${path.relative(ROOT, RUN_OUT)}; restored committed artifacts`);
}

(async () => {
  if (PHASE === "all" || PHASE === "shoot") await shoot();
  if (PHASE === "all" || PHASE === "assemble") assemble();
  if (PHASE === "all" || PHASE === "restore") restore();
})().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
