/**
 * Walkthrough video of the Ramp Teach demo, captured from REAL browser pixels.
 *
 *   npx tsx demo/video/record-video.ts [--phase all|agent|present|assemble|restore] [--base-url URL]
 *
 * Phases (run in order; each can be re-run on its own):
 *   agent     Back up the committed real-run artifacts, reset runtime/bills.json, then run ONE live real-mode
 *             engine run on HSG-1011 (claude-opus-5-5 drives the browser; receipt synthesis is a live call
 *             because the model-output cache is bypassed with RAMP_TEACH_NO_CACHE=1). The agent's OWN Chromium
 *             is recorded (RAMP_TEACH_RECORD_VIDEO_DIR) at 1280x720 (RAMP_TEACH_VIEWPORT).
 *   present   A separate "presenter" Chromium records the app UI with caption overlays: title, home, /learn
 *             (recording + learned spec, saved output), receipt, the decision (a SCRIPTED stand-in for a
 *             human clicks Dispute), the bill. Two clips: before and after the agent footage.
 *   assemble  Captions for the agent footage are built from that run's trace (one per model turn), the
 *             agent clip is trimmed (no blank frames) and speed-fitted, then all clips are joined and
 *             encoded to H.264 MP4 with ffmpeg.
 *   restore   Copy the video run's outputs to demo/video/run/ and put the committed real-run artifacts back.
 *
 * Honest labels on screen: live real-AI steps say LIVE; learn shows SAVED output from an earlier real call;
 * the recorded session's operator and the decision click are SCRIPTED; the checks are hand-written code;
 * data and portal are synthetic; no real Ramp account. Never shows terminal output, code, logs or keys.
 *
 * Needs the app running at --base-url (default http://localhost:3000): `npm run build && npm run start`.
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const opt = (name: string, dflt: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const PHASE = opt("phase", "all");
const BASE = opt("base-url", "http://localhost:3000");
const INVOICE = "HSG-1011";
const VIDEO_DIR = path.join(ROOT, "demo", "video");
const WORK = path.join(VIDEO_DIR, "work"); // gitignored scratch (raw webm, backups, overlays)
const OUT = path.join(VIDEO_DIR, "ramp-teach-walkthrough.mp4");
const W = 1280;
const H = 720;

const TRACKED = [
  `receipts/${INVOICE}.json`,
  "receipts/decisions.jsonl",
  `runs/${INVOICE}/calc.json`,
  `runs/${INVOICE}/evidence.json`,
  "agent/trace.jsonl",
];

const rel = (p: string) => path.relative(ROOT, p);
const readJson = <T>(p: string): T => JSON.parse(fs.readFileSync(p, "utf8")) as T;
const writeJson = (p: string, v: unknown) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2) + "\n");
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ================================ captions ================================ */

type Mode = "live" | "saved" | "scripted" | "code" | "synthetic";
const MODE_CHIP: Record<Mode, { label: string; bg: string; fg: string }> = {
  live: { label: "LIVE · REAL CLAUDE RUN", bg: "#1D7A46", fg: "#FFFFFF" },
  saved: { label: "SAVED OUTPUT · EARLIER REAL CLAUDE RUN", bg: "#5C5C5C", fg: "#FFFFFF" },
  scripted: { label: "SCRIPTED · NOT AI, NOT A HUMAN", bg: "#A15C07", fg: "#FFFFFF" },
  code: { label: "HAND-WRITTEN CODE · NO AI", bg: "#5C5C5C", fg: "#FFFFFF" },
  synthetic: { label: "SYNTHETIC DATA · NO REAL RAMP ACCOUNT", bg: "#5C5C5C", fg: "#FFFFFF" },
};

interface Caption {
  step: string; // e.g. "STEP 3 OF 5 · VERIFY"
  modes: Mode[];
  title: string;
  sub?: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The caption panel (bottom of frame). Same markup in the presenter overlay and the agent-clip PNGs. */
function captionPanel(c: Caption, at: "top" | "bottom" = "bottom"): string {
  const chips = [
    `<span style="background:#E4F222;color:#1F1F1F;border-radius:999px;padding:3px 10px;font-weight:700;letter-spacing:.04em">${esc(c.step)}</span>`,
    ...c.modes.map((m) => {
      const k = MODE_CHIP[m];
      return `<span style="background:${k.bg};color:${k.fg};border-radius:999px;padding:3px 10px;font-weight:700;letter-spacing:.04em">${esc(k.label)}</span>`;
    }),
  ].join("");
  return `<div style="position:fixed;left:50%;${at === "top" ? "top:12px" : "bottom:18px"};transform:translateX(-50%);width:1180px;box-sizing:border-box;
      background:rgba(31,31,31,.94);color:#fff;border-radius:16px;padding:14px 22px 16px;font-family:Inter,system-ui,sans-serif;
      box-shadow:0 8px 30px rgba(0,0,0,.25);z-index:2147483647;pointer-events:none">
    <div style="display:flex;gap:8px;font-size:12px;margin-bottom:8px">${chips}</div>
    <div style="font-size:22px;font-weight:650;line-height:1.3">${esc(c.title)}</div>
    ${c.sub ? `<div style="font-size:15.5px;line-height:1.4;color:#D9D9D3;margin-top:5px">${esc(c.sub)}</div>` : ""}
  </div>`;
}

async function setCaption(page: Page, c: Caption | null) {
  await page.evaluate((html) => {
    document.body.style.paddingBottom = "360px"; // lets the last card scroll clear of the caption panel
    let el = document.getElementById("__rt_caption");
    if (!el) {
      el = document.createElement("div");
      el.id = "__rt_caption";
      document.body.appendChild(el);
    }
    el.innerHTML = html;
  }, c ? captionPanel(c) : "");
}

function cardHtml(o: { eyebrow: string; title: string; body: string[]; chips?: Mode[]; foot?: string }): string {
  const chips = (o.chips ?? [])
    .map((m) => {
      const k = MODE_CHIP[m];
      return `<span style="background:${k.bg};color:${k.fg};border-radius:999px;padding:5px 12px;font-weight:700;font-size:13px;letter-spacing:.04em">${esc(k.label)}</span>`;
    })
    .join(" ");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:#fff;color:#1F1F1F;font-family:Inter,system-ui,sans-serif}
    .wrap{height:100%;display:flex;flex-direction:column;justify-content:center;padding:0 110px;box-sizing:border-box}
    .banner{position:fixed;top:0;left:0;right:0;text-align:center;font-size:13px;color:#5C5C5C;background:#F7F7F5;padding:7px;border-bottom:1px solid #E6E6E3}
    .eyebrow{font-size:15px;letter-spacing:.12em;text-transform:uppercase;color:#8A8A8A;margin-bottom:14px}
    h1{font-family:Newsreader,'DejaVu Serif',Georgia,serif;font-weight:500;font-size:52px;line-height:1.1;margin:0 0 22px;letter-spacing:-.01em}
    p{font-size:21px;line-height:1.5;margin:0 0 10px;color:#3a3a3a;max-width:1000px}
    .accent{display:inline-block;width:64px;height:8px;background:#E4F222;border-radius:4px;margin-bottom:22px}
    .foot{position:fixed;bottom:26px;left:110px;right:110px;font-size:14px;color:#8A8A8A}
  </style></head><body>
    <div class="banner">Unofficial demo inspired by Ramp's design. Not affiliated with Ramp. All data is synthetic.</div>
    <div class="wrap"><div class="accent"></div><div class="eyebrow">${esc(o.eyebrow)}</div><h1>${esc(o.title)}</h1>
    ${o.body.map((b) => `<p>${esc(b)}</p>`).join("")}
    ${chips ? `<div style="margin-top:18px;display:flex;gap:8px;flex-wrap:wrap">${chips}</div>` : ""}</div>
    ${o.foot ? `<div class="foot">${esc(o.foot)}</div>` : ""}
  </body></html>`;
}

async function showCard(page: Page, html: string, ms: number) {
  await page.setContent(html, { waitUntil: "load" });
  await sleep(ms);
}

async function smoothScrollTo(page: Page, target: string | number, offset = 90) {
  // target: a Y offset, or a Playwright selector (css=..., text=..., #id).
  const y =
    typeof target === "number"
      ? target
      : await page
          .locator(target)
          .first()
          .evaluate((el, off) => el.getBoundingClientRect().top + window.scrollY - off, offset);
  await page.evaluate((top) => window.scrollTo({ top, behavior: "smooth" }), y);
  await sleep(1100);
}

/** Visible "click" cue: the presenter has no cursor in headless video, so ring the element first. */
async function ring(page: Page, locator: ReturnType<Page["locator"]>, ms = 900) {
  await locator.evaluate((el, ms) => {
    const h = el as HTMLElement;
    const prev = h.style.boxShadow;
    h.style.transition = "box-shadow .2s";
    h.style.boxShadow = "0 0 0 4px #E4F222, 0 0 0 8px rgba(31,31,31,.85)";
    setTimeout(() => (h.style.boxShadow = prev), ms);
  }, ms);
  await sleep(ms);
}

/* ================================ phase: agent ================================ */

interface AgentRunInfo {
  run_id: string;
  video: string;
  video_started_at: string;
  agent_started_at: string;
  agent_finished_at: string;
  receipt_mode: string;
  recommendation: string;
  synthesis_cache_hit: boolean | null;
  synthesis_seconds: number | null;
  turns: number;
  usage_lines_before: number;
}

function usageLines(): number {
  const f = path.join(ROOT, "runtime", "usage.jsonl");
  return fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).length : 0;
}

function traceEvents(runId: string): { ts: string; step: string; mode: string; stage: string; detail: Record<string, any> }[] {
  return fs
    .readFileSync(path.join(ROOT, "agent", "trace.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((e) => e.run_id === runId);
}

async function phaseAgent() {
  // 1. Back up the committed real-run artifacts (restored in phase restore).
  const backup = path.join(WORK, "backup");
  if (!fs.existsSync(backup)) {
    for (const t of TRACKED) {
      const src = path.join(ROOT, t);
      if (fs.existsSync(src)) {
        fs.mkdirSync(path.dirname(path.join(backup, t)), { recursive: true });
        fs.copyFileSync(src, path.join(backup, t));
      }
    }
    console.log(`backed up ${TRACKED.length} tracked artifacts → ${rel(backup)}`);
  } else console.log(`backup already exists at ${rel(backup)} (kept; it holds the committed artifacts)`);

  // 2. Reset the bill inbox (reseeded from data/bills.json on next read).
  fs.rmSync(path.join(ROOT, "runtime", "bills.json"), { force: true });

  // 3. One live real-mode engine run with the agent's own browser recorded.
  const agentVideoDir = path.join(WORK, "agent-raw");
  fs.rmSync(agentVideoDir, { recursive: true, force: true });
  const before = usageLines();
  const startedAt = new Date().toISOString();
  const code: number = await new Promise((resolve) => {
    const child = spawn("npx", ["tsx", "agent/cli.ts", INVOICE, "--base-url", BASE, "--quiet"], {
      cwd: ROOT,
      stdio: ["ignore", "inherit", "inherit"],
      env: {
        ...process.env,
        BASE_URL: BASE,
        RAMP_TEACH_RECORD_VIDEO_DIR: agentVideoDir,
        RAMP_TEACH_VIEWPORT: `${W}x${H}`,
        RAMP_TEACH_NO_CACHE: "1", // synthesis must be a live call, not a cache replay
      },
    });
    child.on("exit", (c) => resolve(c ?? 1));
  });
  if (code !== 0) throw new Error(`agent run failed (exit ${code})`);
  const finishedAt = new Date().toISOString();

  const webm = fs.readdirSync(agentVideoDir).find((f) => f.endsWith(".webm"));
  if (!webm) throw new Error("agent video not found");
  fs.copyFileSync(path.join(agentVideoDir, webm), path.join(WORK, "agent.webm"));
  const vstart = readJson<{ started_at: string }>(path.join(agentVideoDir, "video-start.json")).started_at;

  // Identify the run from the trace (the newest invoice-review run that started after this phase began).
  const runIds = fs
    .readFileSync(path.join(ROOT, "agent", "trace.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((e) => typeof e.run_id === "string" && e.run_id.startsWith(`invoice-review:${INVOICE}:`) && e.ts >= startedAt)
    .map((e) => e.run_id as string);
  const runId = runIds[runIds.length - 1];
  if (!runId) throw new Error("run id not found in trace");
  const ev = traceEvents(runId);
  const synthStart = ev.find((e) => e.step === "synthesis.start");
  const synthDone = ev.find((e) => e.step === "synthesis.done");
  const receipt = readJson<{ mode: string; recommendation: string; human_decision: unknown }>(path.join(ROOT, "receipts", `${INVOICE}.json`));
  const turns = Math.max(0, ...ev.filter((e) => e.step === "browser.action").map((e) => Number(e.detail.turn) || 0));
  const info: AgentRunInfo = {
    run_id: runId,
    video: "agent.webm",
    video_started_at: vstart,
    agent_started_at: startedAt,
    agent_finished_at: finishedAt,
    receipt_mode: receipt.mode,
    recommendation: receipt.recommendation,
    synthesis_cache_hit: synthDone ? !!synthDone.detail.cache_hit : null,
    synthesis_seconds:
      synthStart && synthDone ? Math.round((Date.parse(synthDone.ts) - Date.parse(synthStart.ts)) / 100) / 10 : null,
    turns,
    usage_lines_before: before,
  };
  writeJson(path.join(WORK, "agent-run.json"), info);
  // Keep the fresh (undecided) receipt so the presenter phase can be retaken without another API run.
  fs.copyFileSync(path.join(ROOT, "receipts", `${INVOICE}.json`), path.join(WORK, "fresh-receipt.json"));
  console.log(`agent run ${runId}: receipt mode=${info.receipt_mode} rec=${info.recommendation} synthesis cache_hit=${info.synthesis_cache_hit} turns=${turns}`);
}

/* ================================ phase: present ================================ */

async function phasePresent() {
  const info = readJson<AgentRunInfo>(path.join(WORK, "agent-run.json"));
  if (info.synthesis_cache_hit !== false || info.receipt_mode !== "real") {
    throw new Error("the agent run's receipt is not a live real synthesis; refusing to caption it as LIVE");
  }
  // Retake support: put back the fresh, undecided receipt from the agent phase and reset the bill.
  fs.copyFileSync(path.join(WORK, "fresh-receipt.json"), path.join(ROOT, "receipts", `${INVOICE}.json`));
  fs.rmSync(path.join(ROOT, "runtime", "bills.json"), { force: true });

  const runHHMM = info.agent_started_at.slice(11, 16);
  const learnMeta = readJson<{ generated_at: string; model: string; mode: string }>(path.join(ROOT, "rules", "learn_meta.json"));
  // The FIRST (fresh) real distillation of this recording, from the learn trace.
  const learnTs = (() => {
    const lines = fs.readFileSync(path.join(ROOT, "learn", "trace.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    let session: string | null = null;
    for (const e of lines) {
      if (e.step === "load_recording") session = e.detail?.session_id ?? null;
      if (e.step === "distill.real" && !e.detail?.cache_hit && session === "rec_20261109T085307Z_iwtx") return e.ts as string;
    }
    return learnMeta.generated_at;
  })();
  const learnHHMM = learnTs.slice(11, 16);

  const browser = await chromium.launch();
  const record = async (name: string, body: (page: Page) => Promise<void>) => {
    const dir = path.join(WORK, `${name}-raw`);
    fs.rmSync(dir, { recursive: true, force: true });
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir, size: { width: W, height: H } } });
    const page = await ctx.newPage();
    await body(page);
    await ctx.close();
    const f = fs.readdirSync(dir).find((x) => x.endsWith(".webm"))!;
    fs.copyFileSync(path.join(dir, f), path.join(WORK, `${name}.webm`));
    console.log(`recorded ${name}.webm`);
  };

  /* ---------- part 1: title, home, record + learn, verify intro ---------- */
  await record("part1", async (page) => {
    await showCard(
      page,
      cardHtml({
        eyebrow: "Ramp Teach · walkthrough",
        title: "Teaching an agent to verify a service invoice",
        body: [
          "An AP reviewer checks a staffing vendor's invoice once. The agent learns the job, checks a new invoice, and hands a person an auditable receipt to decide on.",
        ],
        chips: ["synthetic"],
        foot: "Unofficial demo inspired by Ramp's design. Synthetic vendor, invoices and portal. No real Ramp account is connected.",
      }),
      4200,
    );

    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await setCaption(page, {
      step: "STEP 1 OF 5 · OVERVIEW",
      modes: ["synthetic"],
      title: "One reusable engine: record, learn, verify, receipt, decide.",
      sub: "Invoice review for one staffing vendor is the first workflow on it.",
    });
    await sleep(3000);
    await smoothScrollTo(page, 430);
    await sleep(2800);

    await page.goto(`${BASE}/learn`, { waitUntil: "networkidle" });
    await setCaption(page, {
      step: "STEP 2 OF 5 · RECORD",
      modes: ["scripted"],
      title: "Our Chrome extension captured a reviewer checking a past invoice in the vendor portal.",
      sub: "Honest label: this session was performed by a scripted Playwright operator, not a human. A real reviewer recording is still to come.",
    });
    await sleep(4400);
    await smoothScrollTo(page, "#recording", 24);
    await sleep(2600);
    await page.evaluate(() => window.scrollBy({ top: 330, behavior: "smooth" }));
    await sleep(2400);

    await smoothScrollTo(page, "#rules", 24);
    await setCaption(page, {
      step: "STEP 2 OF 5 · LEARN",
      modes: ["saved"],
      title: "One Claude call turned that capture into rules the agent will apply.",
      sub: `Real claude-opus-5-5 call earlier tonight (${learnHHMM} UTC). This is that saved output; it was not re-run for this video.`,
    });
    await sleep(5200);

    await showCard(
      page,
      cardHtml({
        eyebrow: "Step 3 of 5 · Verify",
        title: "Claude drives a browser through the vendor portal",
        body: [
          `Recorded live for this video (${runHHMM} UTC) on invoice ${INVOICE}. Claude picks every action from the page; our code only carries it out, and only on the local demo portal.`,
        ],
        chips: ["live", "synthetic"],
      }),
      4200,
    );
  });

  /* ---------- part 2: synthesis note, receipt, evidence, decision, bill ---------- */
  await record("part2", async (page) => {
    await showCard(
      page,
      cardHtml({
        eyebrow: "Step 4 of 5 · Receipt",
        title: "Claude writes the receipt",
        body: [
          `A live Claude call (${info.synthesis_seconds ?? "a few"} s) turned the check results and the portal evidence into a receipt.`,
          "The six checks themselves are hand-written code, and the code's results always win.",
        ],
        chips: ["live", "code"],
      }),
      4200,
    );

    await page.goto(`${BASE}/receipts/${INVOICE}`, { waitUntil: "networkidle" });
    await setCaption(page, {
      step: "STEP 4 OF 5 · RECEIPT",
      modes: ["live"],
      title: "Recommendation: Dispute. Three billing errors, $3,448 to credit.",
      sub: `Receipt from this video's live run (${runHHMM} UTC). It is a recommendation; a person decides.`,
    });
    await smoothScrollTo(page, 330);
    await sleep(4400);

    await setCaption(page, {
      step: "STEP 4 OF 5 · CHECKS",
      modes: ["code"],
      title: "3 of 6 checks failed. Every row links the evidence it used.",
      sub: "Rate above contract, Priya billed twice, Sam's 44 h vs 38 h approved. The checks are hand-written code, not AI.",
    });
    await smoothScrollTo(page, 'text="Verification"', 30);
    await sleep(4400);

    const evLink = page.locator('a:has-text("data/vendor.json#contract")').first();
    await ring(page, evLink);
    await evLink.click();
    await page.waitForLoadState("networkidle");
    await setCaption(page, {
      step: "STEP 4 OF 5 · EVIDENCE",
      modes: ["synthetic"],
      title: "Evidence link: the contract rate card entry behind the rate check.",
      sub: "Senior Recruiter is $95.00/h in the contract; the invoice billed $105.00/h.",
    });
    await sleep(4000);
    // Fresh load (not history back: the back-forward cache would bring the old caption with it).
    await page.goto(`${BASE}/receipts/${INVOICE}`, { waitUntil: "networkidle" });
    await setCaption(page, {
      step: "STEP 4 OF 5 · LINE ITEMS",
      modes: ["code"],
      title: "Flags say what is wrong on each line.",
      sub: "Rate mismatch, Hours not approved, Duplicate line.",
    });
    await smoothScrollTo(page, 'text="Line items"', 60);
    await sleep(3800);

    await setCaption(page, {
      step: "STEP 5 OF 5 · DECIDE",
      modes: ["scripted"],
      title: "A person decides. Here a scripted stand-in types a name and clicks Dispute.",
      sub: "The agent never approves, pays or submits anything.",
    });
    await smoothScrollTo(page, '[data-testid="decision-panel"]', 30);
    await sleep(1800);
    const nameInput = page.locator('input[name="decided_by"]');
    await nameInput.click();
    await nameInput.pressSequentially("Demo reviewer (scripted stand-in for a human)", { delay: 22 });
    await sleep(300);
    const dispute = page.getByRole("button", { name: /^Dispute$/ });
    await ring(page, dispute, 1000);
    await dispute.click();
    await page.getByText("Open bill in inbox").waitFor({ timeout: 10000 });
    await sleep(600);
    await setCaption(page, {
      step: "STEP 5 OF 5 · DECIDE",
      modes: ["scripted"],
      title: "Decision recorded. The receipt is attached to the bill.",
      sub: "Disputed by the scripted stand-in, through the same decision API a person would use.",
    });
    await sleep(3400);

    const billLink = page.getByText("Open bill in inbox");
    await ring(page, billLink);
    await billLink.click();
    await page.waitForLoadState("networkidle");
    await setCaption(page, {
      step: "STEP 5 OF 5 · BILL INBOX",
      modes: ["synthetic"],
      title: `Bill ${INVOICE}: Disputed, with the receipt attached.`,
      sub: "A Ramp-style bill inbox built for this demo. No real Ramp account is connected.",
    });
    await sleep(4600);

    await showCard(
      page,
      cardHtml({
        eyebrow: "What was real in this video",
        title: "Live AI where it says LIVE",
        body: [
          `Live real Claude runs (claude-opus-5-5, ${runHHMM} UTC): the browser agent's actions and the receipt.`,
          `Saved output from an earlier real Claude run (${learnHHMM} UTC): the learned rules.`,
          "Scripted, not human: the recorded review session and the decision click. Hand-written code: the six checks.",
          "Synthetic: the vendor, invoices, timecards, portal and bill inbox. No real Ramp account.",
        ],
      }),
      7000,
    );
  });

  await browser.close();
}

/* ================================ phase: assemble ================================ */

function employeeNames(): Record<string, string> {
  const v = readJson<{ employees: { employee_id: string; name: string }[] }>(path.join(ROOT, "data", "vendor.json"));
  return Object.fromEntries(v.employees.map((e) => [e.employee_id, e.name]));
}

/** Plain-English summary of one model turn's actions (no values from forms; those are redacted in the trace). */
function summarizeTurn(actions: { tool: string; input: Record<string, any> }[], names: Record<string, string>): string {
  const tools = actions.map((a) => a.tool.replace(/^browser\./, ""));
  const phrases: string[] = [];
  const add = (p: string) => {
    if (!phrases.includes(p)) phrases.push(p);
  };
  const recorded: string[] = [];
  let read = false;
  for (const [i, a] of actions.entries()) {
    const t = tools[i];
    if (t === "navigate") {
      const u = String(a.input.url ?? "");
      const m = /\/portal\/employees\/(E-\d+)\?week=/.exec(u);
      if (m) add(`opens ${names[m[1]] ?? m[1]}'s timecard`);
      else if (u.includes("/portal/invoices/")) add(`opens invoice ${u.split("/").pop()}`);
      else if (u.includes("/portal/login")) add("opens the portal's sign-in page");
      else add(`opens ${u.replace(/^https?:\/\/[^/]+/, "")}`);
    } else if (t === "get_page_text" || t === "read_page") read = true;
    else if (t === "find") add(/timecard/i.test(String(a.input.query)) ? "finds the timecard links" : `searches the page for "${a.input.query}"`);
    else if (t === "form_input" || t === "left_click") add("signs in");
    else if (t === "record_evidence") {
      const who = names[a.input.subject_ref?.employee_id] ?? a.input.subject_ref?.employee_id ?? "";
      if (a.input.key === "approved_hours") recorded.push(`${who}: ${a.input.value} approved hours`);
    } else if (t !== "wait") add(t.replace(/_/g, " "));
  }
  // "opens X" + reading the page reads as one step.
  if (read && phrases.length && phrases[phrases.length - 1].startsWith("opens ")) phrases[phrases.length - 1] += " and reads it";
  else if (read && !phrases.length) phrases.push("reads the page");
  const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
  const rec = recorded.length ? `records ${recorded.join("; ")}` : "";
  const out = [rec, list(phrases)].filter(Boolean).join(", then ");
  return out ? `${out}.` : "thinks about the next step.";
}

async function renderOverlayPngs(items: { file: string; caption: Caption }[], at: "top" | "bottom" = "bottom") {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  for (const it of items) {
    await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${captionPanel(it.caption, at)}</body></html>`);
    await page.screenshot({ path: it.file, omitBackground: true });
  }
  await browser.close();
}

function ffprobeDuration(f: string): number {
  return Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString().trim());
}

async function phaseAssemble() {
  const info = readJson<AgentRunInfo>(path.join(WORK, "agent-run.json"));
  const ev = traceEvents(info.run_id);
  const names = employeeNames();
  const v0 = Date.parse(info.video_started_at);
  const actions = ev.filter((e) => e.step === "browser.action");
  const results = ev.filter((e) => e.step === "browser.result" && e.detail.tool);
  const firstNavResult = results.find((e) => e.detail.tool === "navigate");
  const lastAction = actions[actions.length - 1];
  const rawDur = ffprobeDuration(path.join(WORK, "agent.webm"));
  // Trim: start once the first page has loaded (no blank about:blank frames); end shortly after the last action.
  const tStart = Math.max(0, (Date.parse(firstNavResult!.ts) - v0) / 1000 + 0.15);
  const tEnd = Math.min(rawDur - 0.05, (Date.parse(lastAction.ts) - v0) / 1000 + 2.2);
  const span = tEnd - tStart;
  const speed = Math.max(1, Math.round((span / 30) * 100) / 100); // fit to about 30 s, never slow down
  const turnNums = [...new Set(actions.map((a) => Number(a.detail.turn)))].sort((a, b) => a - b);
  // Total MODEL turns (the last one may only summarise, with no browser actions).
  const totalTurns = Math.max(turnNums.length, ...ev.filter((e) => e.step === "browser.result" && e.detail.stop_reason).map((e) => Number(e.detail.turn) || 0));

  const overlays: { file: string; caption: Caption; from: number; to: number }[] = [];
  turnNums.forEach((n, i) => {
    const acts = actions.filter((a) => Number(a.detail.turn) === n);
    const from = Math.max(0, ((Date.parse(acts[0].ts) - v0) / 1000 - tStart) / speed);
    const nextTurn = turnNums[i + 1];
    const nextTs = nextTurn !== undefined ? Date.parse(actions.find((a) => Number(a.detail.turn) === nextTurn)!.ts) : null;
    const to = nextTs !== null ? ((nextTs - v0) / 1000 - tStart) / speed : span / speed;
    overlays.push({
      file: path.join(WORK, `turn-${n}.png`),
      from: i === 0 ? 0 : from,
      to,
      caption: {
        step: `STEP 3 OF 5 · VERIFY · TURN ${n} OF ${totalTurns}`,
        modes: ["live"],
        title: `Claude ${summarizeTurn(acts.map((a) => ({ tool: String(a.detail.tool), input: a.detail.input ?? {} })), names)}`,
        sub: `Claude's own browser, recorded live (${info.agent_started_at.slice(11, 16)} UTC)${speed > 1 ? `, sped up ${speed}x` : ", real time"}. Local demo portal only; synthetic data.`,
      },
    });
  });
  await renderOverlayPngs(overlays, "top"); // top: keeps the timecard's approved-hours row visible
  writeJson(path.join(WORK, "agent-captions.json"), { tStart, tEnd, speed, overlays: overlays.map((o) => ({ ...o, file: path.basename(o.file) })) });

  // Agent segment: trim, speed-fit, normalise, overlay captions per turn.
  const agentSeg = path.join(WORK, "seg-agent.mp4");
  const inputs = ["-ss", tStart.toFixed(3), "-to", tEnd.toFixed(3), "-i", path.join(WORK, "agent.webm")];
  overlays.forEach((o) => inputs.push("-i", o.file));
  let chain = `[0:v]setpts=(PTS-STARTPTS)/${speed},fps=30,scale=${W}:${H},format=yuv420p[v0]`;
  overlays.forEach((o, i) => {
    chain += `;[v${i}][${i + 1}:v]overlay=0:0:enable='between(t,${o.from.toFixed(2)},${o.to.toFixed(2)})'[v${i + 1}]`;
  });
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", chain, "-map", `[v${overlays.length}]`, "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "18", agentSeg]);

  // Presenter clips: normalise.
  const norm = (name: string) => {
    const out = path.join(WORK, `seg-${name}.mp4`);
    // Drop the first ~0.25 s (blank frame before the first paint).
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", "0.25", "-i", path.join(WORK, `${name}.webm`), "-vf", `fps=30,scale=${W}:${H},format=yuv420p`, "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "18", out]);
    return out;
  };
  const segs = [norm("part1"), agentSeg, norm("part2")];

  // Join and encode the final H.264 MP4 (web-friendly: yuv420p, faststart).
  const list = path.join(WORK, "concat.txt");
  fs.writeFileSync(list, segs.map((s) => `file '${s}'`).join("\n") + "\n");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", OUT]);
  const dur = ffprobeDuration(OUT);
  const size = fs.statSync(OUT).size;
  console.log(`wrote ${rel(OUT)}: ${(size / 1e6).toFixed(2)} MB, ${dur.toFixed(1)} s (agent clip ${span.toFixed(1)} s raw at ${speed}x)`);
}

/* ================================ phase: restore ================================ */

function phaseRestore() {
  const info = readJson<AgentRunInfo>(path.join(WORK, "agent-run.json"));
  const runOut = path.join(VIDEO_DIR, "run");
  fs.mkdirSync(runOut, { recursive: true });
  // Archive what the video run produced (receipt as decided on camera, its calc/evidence, its trace lines).
  fs.copyFileSync(path.join(ROOT, "receipts", `${INVOICE}.json`), path.join(runOut, `receipt-${INVOICE}.json`));
  fs.copyFileSync(path.join(ROOT, "runs", INVOICE, "calc.json"), path.join(runOut, "calc.json"));
  fs.copyFileSync(path.join(ROOT, "runs", INVOICE, "evidence.json"), path.join(runOut, "evidence.json"));
  const traceLines = fs
    .readFileSync(path.join(ROOT, "agent", "trace.jsonl"), "utf8")
    .split("\n")
    .filter((l) => l && JSON.parse(l).run_id === info.run_id);
  fs.writeFileSync(path.join(runOut, "trace.jsonl"), traceLines.join("\n") + "\n");
  const decisions = fs.readFileSync(path.join(ROOT, "receipts", "decisions.jsonl"), "utf8").split("\n").filter(Boolean);
  fs.writeFileSync(path.join(runOut, "decision.jsonl"), decisions[decisions.length - 1] + "\n");
  writeJson(path.join(runOut, "agent-run.json"), info);
  fs.copyFileSync(path.join(WORK, "agent-captions.json"), path.join(runOut, "agent-captions.json"));

  // Put the committed real-run artifacts back.
  const backup = path.join(WORK, "backup");
  for (const t of TRACKED) {
    const src = path.join(backup, t);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(ROOT, t));
  }
  console.log(`archived the video run to ${rel(runOut)}; restored ${TRACKED.join(", ")}`);
}

/* ================================== main ================================== */

async function main() {
  fs.mkdirSync(WORK, { recursive: true });
  const up = await fetch(`${BASE}/`).then((r) => r.ok).catch(() => false);
  if (!up && PHASE !== "assemble" && PHASE !== "restore") throw new Error(`app not running at ${BASE} (npm run build && npm run start)`);
  if (PHASE === "agent" || PHASE === "all") await phaseAgent();
  if (PHASE === "present" || PHASE === "all") await phasePresent();
  if (PHASE === "assemble" || PHASE === "all") await phaseAssemble();
  if (PHASE === "restore" || PHASE === "all") phaseRestore();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
