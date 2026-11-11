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
/** Rehearsal: the agent runs in its labeled offline mode (scripted evidence, mock receipt). No API cost. */
const OFFLINE = args.includes("--offline");
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
  "rules/workflow_spec.json",
  "rules/learn_meta.json",
  "rules/evals.json",
  "learn/trace.jsonl",
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
    detached: true, // own process group, so the real next-server child stops with it
    stdio: ["ignore", fs.openSync(path.join(WORK, "next.log"), "w"), fs.openSync(path.join(WORK, "next.log"), "a")],
    env: {
      ...process.env,
      RAMP_TEACH_FILM_DIR: path.join(WORK, "agent"),
      RAMP_TEACH_VIEWPORT: `${AGENT_VP.width}x${AGENT_VP.height}`,
      RAMP_TEACH_NO_CACHE: "1", // live model calls, not cache replays
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
const getBill = (id: string) => fetch(`${BASE}/api/dash/bills/${id}`).then((r) => r.json()) as Promise<any>;

async function shoot() {
  fs.mkdirSync(WORK, { recursive: true });
  // Back up committed artifacts once.
  // Back up each committed artifact once (per file, so files added to TRACKED later are covered too).
  const backup = path.join(WORK, "backup");
  for (const t of TRACKED) {
    const src = path.join(ROOT, t);
    const dst = path.join(backup, t);
    if (!fs.existsSync(dst) && fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    }
  }
  fs.rmSync(path.join(WORK, "agent"), { recursive: true, force: true });
  for (const n of NEW_OUTPUTS) fs.rmSync(path.join(ROOT, n), { recursive: true, force: true });

  // Always film the current code.
  execFileSync("npx", ["next", "build"], { cwd: ROOT, stdio: "ignore" });
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
    const panel = () => page.frameLocator("#panelframe");
    async function toPanel(sel: string) {
      await panel().locator(sel).first().scrollIntoViewIfNeeded();
      await sleep(250);
      const box = await panel().locator(sel).first().boundingBox();
      if (!box) throw new Error(`no panel element ${sel}`);
      await S("move", box.x + box.width / 2, box.y + box.height / 2);
      await S("press");
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }
    /** Click something in the app that navigates, then wait for the URL to change and the page to settle. */
    async function toAndWait(sel: string) {
      const from = await S<string>("href");
      await to(sel);
      await S("urlChange", from);
    }

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
    await toPanel("#btn-mic");
    await sleep(300);
    await toPanel("#btn-stop");
    await sleep(900);
    writeJson(path.join(WORK, "film-recording.json"), await page.evaluate(() => (window as any).__ext.recording()));
    mark("record_end");

    /* ---------- Scene 2: Send to Ramp -> sign in -> Ramp Teach learns (live) ---------- */
    await toPanel("#btn-send");
    await sleep(1400);
    await page.evaluate(() => (window as any).stage.closePanel());
    await frame().locator('input[name="email"]').waitFor({ timeout: 10000 });
    await sleep(600);
    await to('input[name="email"]');
    await type("alex@northwind.test", 50);
    await to('input[name="password"]');
    await type("northwind", 45);
    await toAndWait('button:has-text("Continue")');
    mark("learn_start");
    for (let i = 0; i < 240; i++) {
      const j = await fetch(`${BASE}/api/learn`).then((r) => r.json());
      if (j.job?.status !== "running") break;
      await sleep(500);
    }
    mark("learn_done");
    await sleep(3200);
    await to("ol li:nth-child(3)", { click: false, ms: 900 });
    await sleep(1800);
    await toAndWait('a[href="/bills"]');
    await S("move", 1100, 520, 800);
    await sleep(1400);

    await post("/api/dash/deliver", { invoice_id: "HSG-1011" });
    mark("deliver_1011");
    await frame().locator('tr[data-bill="bill_HSG-1011"]').waitFor({ timeout: 8000 });
    await sleep(1400);
    await toAndWait('tr[data-bill="bill_HSG-1011"] a');
    await frame().getByTestId("bill-drawer").waitFor();
    await sleep(900);

    // The agent's own browser, in its window (its pixels are composited in assemble).
    const win = { left: 130, top: 300, width: 1000, height: 86 + Math.round((1000 * AGENT_VP.height) / AGENT_VP.width) };
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
    await to('[data-testid="bill-drawer"] footer button:has-text("Dispute")');
    await sleep(2200);
    await to('[data-testid="bill-drawer"] header a[aria-label="Close"]');
    await sleep(1200);

    /* ---------- Scene 4: a clean invoice ---------- */
    await post("/api/dash/deliver", { invoice_id: "HSG-1012" });
    mark("deliver_1012");
    await frame().locator('tr[data-bill="bill_HSG-1012"]').waitFor({ timeout: 8000 });
    await sleep(1400);
    await toAndWait('tr[data-bill="bill_HSG-1012"] a');
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
    await to('[data-testid="bill-drawer"] footer button:has-text("Approve")');
    await sleep(2200);
    await to('[data-testid="bill-drawer"] header a[aria-label="Close"]');
    await sleep(900);
    await to('button:has-text("Payment required")');
    await sleep(2600);
    await S("fadeOut", 1000, "Ramp Teach");
    await sleep(1800);
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
    writeJson(path.join(WORK, "marks.json"), { t0: new Date(t0).toISOString(), marks });
    console.log("shot film.webm", marks);
  } finally {
    try {
      process.kill(-server.pid!, "SIGTERM"); // whole group: npx + next-server
    } catch {
      server.kill();
    }
    await sleep(1200);
    if (OFFLINE) {
      // A rehearsal must never leave mock output where the committed real-run artifacts live.
      for (const t of TRACKED) if (fs.existsSync(path.join(backup, t))) fs.copyFileSync(path.join(backup, t), path.join(ROOT, t));
      for (const n of NEW_OUTPUTS) fs.rmSync(path.join(ROOT, n), { recursive: true, force: true });
      console.log("rehearsal: restored committed artifacts");
    }
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
  const SPEED = 5;
  const start = Math.max(0, marks.start - 0.1); // drop pre-roll before the first painted frame
  // Waits to compress (only when there is a real wait).
  const waits = [
    [marks.learn_start + 1.2, marks.learn_done - 0.4],
    [marks.fast_start + 0.5, marks.fast_end - 0.3],
  ].filter(([x, y]) => y - x > 2);
  const parts: string[] = [];
  let cursor = start;
  waits.forEach(([x, y]) => {
    parts.push(`${cursor.toFixed(2)}:${x.toFixed(2)}:1`, `${x.toFixed(2)}:${y.toFixed(2)}:${SPEED}`);
    cursor = y;
  });
  parts.push(`${cursor.toFixed(2)}:${dur.toFixed(2)}:1`);
  const graph = [
    `[1:v]setpts=PTS-STARTPTS+${offset.toFixed(3)}/TB,scale=${rect.w}:${rect.h}[ag]`,
    `[0:v][ag]overlay=${rect.x}:${rect.y}:eof_action=pass:enable='between(t,${on.toFixed(2)},${off.toFixed(2)})',fps=30,format=yuv420p,split=${parts.length}${parts.map((_, i) => `[s${i}]`).join("")}`,
    ...parts.map((p, i) => {
      const [x, y, sp] = p.split(":");
      return `[s${i}]trim=${x}:${y},setpts=(PTS-STARTPTS)/${sp}[p${i}]`;
    }),
    `${parts.map((_, i) => `[p${i}]`).join("")}concat=n=${parts.length}:v=1:a=0,fps=30[out]`,
  ].join(";");
  const a = waits[0]?.[0] ?? 0;
  const b = waits[0]?.[1] ?? 0;
  const mid = path.join(WORK, "assembled.mp4"); // high quality; the captions phase makes the final file
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", film, "-i", path.join(agentDir, agentWebm), "-filter_complex", graph, "-map", "[out]", "-c:v", "libx264", "-preset", "medium", "-crf", "14", "-pix_fmt", "yuv420p", "-an", mid]);
  const d = Number(probe(mid));
  console.log(`wrote ${path.relative(ROOT, OUT)}: ${(fs.statSync(OUT).size / 1e6).toFixed(2)} MB, ${d.toFixed(1)} s (agent overlay ${on.toFixed(1)}-${off.toFixed(1)} s, offset ${offset.toFixed(2)} s; wait ${a.toFixed(1)}-${b.toFixed(1)} s at ${SPEED}x)`);
  writeJson(path.join(WORK, "assemble.json"), { offset, on, off, a, b, SPEED, start, rect, out_duration: d, waits });
}

/* ============================== captions ============================== */

/**
 * Voice-over captions for the whole film (the narration lines during recording are already in the take, said by
 * the stage). Times are relative to the take's marks; the speed-up is mapped out. Same look as the stage subtitles.
 */
function voiceover(m: Record<string, number>): [number, number, string][] {
  return [
    [m.start + 0.3, m.record_start + 0.2, "I'm about to record myself checking an invoice from our staffing vendor, so Ramp can learn how I review it."],
    [m.record_end + 0.2, m.record_end + 3.6, "When I'm done, I send the recording straight to Ramp."],
    [m.record_end + 3.8, m.learn_start + 0.2, "I sign in, and Ramp Teach starts learning from what I just did."],
    [m.learn_start + 0.6, m.learn_done + 5.6, "A few seconds later it has the rules, written from my clicks and what I said."],
    [m.learn_done + 6.0, m.deliver_1011 + 1.6, "Now a new invoice from the same vendor lands in Bill Pay."],
    [m.deliver_1011 + 2.0, m.agent_on + 0.2, "The agent picks it up on its own."],
    [m.agent_on + 0.6, m.agent_on + 12, "It opens the vendor portal and checks each timecard, the same way I did."],
    [m.agent_on + 12.2, m.agent_on + 24, "Every step it takes shows up on the bill as it happens."],
    [m.agent_on + 24.2, m.agent_off, "It checks billed hours, rates and duplicate lines against the contract."],
    [m.agent_off + 0.3, m.result_1011 + 0.2, "Then it writes up what it found."],
    [m.result_1011 + 0.5, m.result_1011 + 5.9, "Three problems: a rate above contract, a line billed twice, and hours over the timecard. $3,448 to credit back."],
    [m.result_1011 + 6.1, m.deliver_1012 - 0.2, "So I dispute it. The agent never approves or pays anything on its own."],
    [m.deliver_1012 + 0.2, m.fast_start + 0.3, "Next, a clean invoice from the same vendor."],
    [m.fast_start + 0.5, m.fast_end - 0.4, "Same review, sped up."],
    [m.fast_end - 0.2, m.fast_end + 2.6, "Everything checks out, so it's ready to approve."],
    [m.fast_end + 2.8, m.end - 4.0, "One click from me, and it moves on to payment."],
    [m.end - 3.6, m.end, "Show it once. Ramp Teach handles the rest."],
  ];
}

const srtTime = (t: number) => {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3600000), mi = Math.floor((ms % 3600000) / 60000), se = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:${String(se).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};

async function captions() {
  const { t0, marks } = readJson<{ t0: string; marks: Record<string, number> }>(path.join(WORK, "marks.json"));
  const asm = readJson<{ start: number; out_duration: number; waits: [number, number][]; SPEED: number }>(path.join(WORK, "assemble.json"));
  // film time -> output time (drop pre-roll, compress the sped-up waits)
  const out = (t: number) => {
    let o = t - asm.start;
    for (const [x, y] of asm.waits) if (t > x) o -= (Math.min(t, y) - x) * (1 - 1 / asm.SPEED);
    return Math.max(0, Math.min(asm.out_duration, o));
  };
  const lines = voiceover(marks).map(([a, b, text]) => ({ from: out(a), to: out(b), text }));

  // Render each caption as a transparent full-frame PNG in the stage's subtitle style.
  const dir = path.join(WORK, "captions");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  for (const [i, l] of lines.entries()) {
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:transparent;width:${W}px;height:${H}px;font-family:Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased">` +
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
  graph = graph.replace(/;$/, "");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", graph, "-map", `[${last}]`, "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", OUT]);

  // Voice-over script (.srt): the captions plus the narration lines said during recording (times from the recording).
  const rec = readJson<{ steps: { ts: string; kind: string; detail: { text?: string } }[] }>(path.join(WORK, "film-recording.json"));
  const said = rec.steps
    .filter((s) => s.kind === "narration")
    .map((s) => {
      const ft = (Date.parse(s.ts) - Date.parse(t0)) / 1000;
      return { from: out(ft), to: out(ft) + 2.8, text: s.detail.text ?? "" };
    });
  const all = [...lines, ...said].sort((x, y) => x.from - y.from);
  all.forEach((l, i) => {
    if (all[i + 1]) l.to = Math.min(l.to, all[i + 1].from - 0.1);
  });
  const srt = all.map((l, i) => `${i + 1}\n${srtTime(l.from)} --> ${srtTime(l.to)}\n${l.text}\n`).join("\n");
  fs.writeFileSync(OUT.replace(/\.mp4$/, ".voiceover.srt"), srt);
  console.log(`wrote ${path.relative(ROOT, OUT)}: ${(fs.statSync(OUT).size / 1e6).toFixed(2)} MB, ${Number(probe(OUT)).toFixed(1)} s, ${lines.length} voice-over captions; script ${path.relative(ROOT, OUT.replace(/\.mp4$/, ".voiceover.srt"))}`);
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
  // The take's learned workflow and learn trace (before restoring the committed rules/).
  for (const [src, dst] of [
    ["rules/workflow_spec.json", "learned-workflow_spec.json"],
    ["rules/learn_meta.json", "learned-learn_meta.json"],
  ]) {
    if (fs.existsSync(path.join(ROOT, src))) fs.copyFileSync(path.join(ROOT, src), path.join(RUN_OUT, dst));
  }
  const learnTrace = fs.readFileSync(path.join(ROOT, "learn", "trace.jsonl"), "utf8").split("\n").filter((l) => l && JSON.parse(l).ts >= t0);
  fs.writeFileSync(path.join(RUN_OUT, "learn-trace.jsonl"), learnTrace.join("\n") + "\n");
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
  if (PHASE === "all" || PHASE === "assemble" || PHASE === "captions") await captions();
  if (PHASE === "all" || PHASE === "restore") restore();
})().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
