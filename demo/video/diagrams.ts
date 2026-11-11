/**
 * The film's non-recording screens (dark, Ramp-themed), data-driven from the take's archive:
 *
 *   intro       beat 0   Ramp Teach lockup, the problem, three steps
 *   record      beat 2   Recording and Transcription: portal clicks, recorded rows, the payload sent to Ramp
 *   overview    beat 4   Architecture: the four groups, the two paths meeting at the learned workflow
 *   learning    beat 6   Agent Learning: the stages, one rule traced to its words and click, provenance
 *   execution   beat 9   Agent execution and evaluation (1): the run loop, checks, receipt, decision
 *   evaluation  beat 11  Agent execution and evaluation (2): the three test layers, the trace, cost
 *   close       beat 12  What this proves, and the next step (Teams, Slack)
 *   outro                Ramp | Teach
 *
 * Every number, ID and row is read at render time from the take's archive (setRunDir: demo/video/film-run for a
 * real take, work-film/rehearsal-run for a rehearsal), so a new take updates every screen. Rows are picked by
 * content, not by index. Fields older archives lack (speech, skill, spans, route, eval run) are left out of the
 * screen rather than invented. The correction replay is read from eval-replay.json (captured during the take),
 * else computed with the same code as `npm run eval`.
 *
 * Rendered frame by frame (CSS animations paused and seeked through the Web Animations API) and encoded to MP4.
 * On-screen text rules (demo/video/STORYBOARD.md): the title is the only header, no kicker labels, short labels
 * with real names and units, no em dashes, middle dots or "approximately" signs (renderSection refuses them).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { fontFaceCss } from "./fonts";

const W = 1920;
const H = 1080;
const FPS = 30;
const EASE = "cubic-bezier(.2,.8,.2,1)";
const ROOT = process.cwd(); // run from the repo root
const LOGOS_DIR = path.join(ROOT, "demo", "video", "assets", "logos");
const LEMON = "rgb(228,242,34)";
const RED = "rgb(255,122,107)";
const LINE = "rgb(96,93,89)";

let RUN_DIR = path.join(ROOT, "demo", "video", "film-run");
/** Where the take's archive is (film.ts sets it: film-run for a real take, the rehearsal archive otherwise). */
export const setRunDir = (d: string) => {
  RUN_DIR = d;
  takeCache = null;
};
const runFile = (f: string) => path.join(RUN_DIR, f);

export interface DCaption {
  t0: number;
  t1: number;
  text: string;
}
export interface Logos {
  word: string;
  mark: string;
}
type Group = "chrome" | "app" | "sandbox" | "anthropic";
export interface Section {
  id: string;
  /** The only header on the frame (null for the cards). */
  title: string | null;
  duration: number;
  /** Mini-map groups lit in the top-right corner (none: no mini-map). */
  minimap?: Group[];
  captions: DCaption[];
  body: (logos: Logos) => string;
}

/* ------------------------------------------------------------------ text helpers */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = any;
/** Data text can carry dashes or middle dots (page titles, model prose); the screen never does. */
export const cleanText = (s: unknown) =>
  String(s ?? "")
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\s*·\s*/g, ", ")
    .replace(/≈\s*/g, "about ");
const esc = (s: unknown) => cleanText(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const at = (t: number, dur = 0.5) => `animation: in ${dur}s ${EASE} ${t}s forwards;`;
const box = (x: number, y: number, w: number, h?: number) => `left:${x}px;top:${y}px;width:${w}px;${h != null ? `height:${h}px;` : ""}`;
const readMaybe = <T = J>(f: string): T | null => {
  try {
    return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, "utf8")) as T) : null;
  } catch {
    return null;
  }
};
const jsonl = (f: string): J[] =>
  fs.existsSync(f)
    ? fs
        .readFileSync(f, "utf8")
        .split("\n")
        .filter(Boolean)
        .flatMap((l) => {
          try {
            return [JSON.parse(l)];
          } catch {
            return [];
          }
        })
    : [];
const urlPath = (u: string) => {
  try {
    const x = new URL(u);
    return decodeURIComponent(x.pathname + x.search);
  } catch {
    return u;
  }
};
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const hms = (ts: string) => ts.slice(11, 19);
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const money = (x: number) => `$${x.toFixed(2)}`;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const tool = (t: string) => String(t ?? "").replace(/^browser\./, "");

// Same prices as scripts/usage.ts (claude-opus-5-5, USD per million tokens): $4 in, $20 out, cache read $0.20,
// cache write $5.
export const usd = (r: J) =>
  ((r?.input_tokens ?? 0) * 4 + (r?.output_tokens ?? 0) * 20 + (r?.cache_read_input_tokens ?? 0) * 0.2 + (r?.cache_creation_input_tokens ?? 0) * 5) / 1e6;

/* ------------------------------------------------------------------ logos */
// Simple Icons "claude" (CC0), drawn in Claude's terracotta.
const CLAUDE_PATH =
  "m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z";
const claudeMark = (size = 22) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" style="flex:none"><path fill="#D97757" d="${CLAUDE_PATH}"/></svg>`;
const extIcon = (size = 22) =>
  `<img src="data:image/png;base64,${fs.readFileSync(path.join(ROOT, "extension", "icons", "icon128.png")).toString("base64")}" width="${size}" height="${size}" style="border-radius:5px;display:block;flex:none">`;
const rampLockup = (logos: Logos, h: number, t: number, k = 1) => `
  <div class="lock" style="height:${h}px;gap:${Math.round(h * 0.36)}px">
    <svg class="o" viewBox="0 0 227 61" fill="#fff" style="height:${h}px;width:auto;transform:translateY(${h * 0.25}px);${at(t, 0.7 * k)}"><path d="${logos.word}"/><path d="${logos.mark}"/></svg>
    <span class="o grow-y" style="width:2px;height:${h * 1.05}px;background:rgb(80,77,74);animation: growy ${0.5 * k}s ${EASE} ${t + 0.35 * k}s forwards"></span>
    <span class="o" style="font-size:${h * 1.04}px;line-height:1;letter-spacing:-.02em;transform:translateX(-16px);${at(t + 0.5 * k, 0.6 * k)}">Teach</span>
  </div>`;

/** A rule as it fits a small box: no parenthetical selectors, cut at a word boundary. */
function shortRule(text: string, max: number): string {
  const t = text.replace(/\s*\([^)]*[\[`=][^)]*\)/g, "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const clause = cut.lastIndexOf(", ");
  const end = clause > max * 0.6 ? clause : Math.max(cut.lastIndexOf(" "), max - 12);
  return cut.slice(0, end).replace(/[,;:]$/, "") + "…";
}

/* ------------------------------------------------------------------ drawing helpers */
function panel(x: number, y: number, w: number, h: number, head: string, t: number, cls = "") {
  return `<div class="panel ${cls}" style="${box(x, y, w, h)}${at(t, 0.5)}">${head ? `<div class="ph">${head}</div>` : ""}</div>`;
}
/** One text row that fades and rises in at t. */
const row = (x: number, y: number, w: number, h: number, html: string, t: number, cls = "", style = "") =>
  `<div class="r ${cls}" style="${box(x, y, w)}height:${h}px;line-height:${h}px;${style}${at(t, 0.4)}">${html}</div>`;
/** A wrapping text block that fades and rises in at t. */
const text = (x: number, y: number, w: number, html: string, t: number, style = "", cls = "") =>
  `<div class="r wrap ${cls}" style="${box(x, y, w)}${style}${at(t, 0.45)}">${html}</div>`;
const colHead = (x: number, y: number, w: number, label: string, t: number) => row(x, y, w, 24, esc(label), t, "muted", "font-size:16px;");

/** Straight arrow that draws in (with a head), optional label above its middle. */
function arrow(a: [number, number], b: [number, number], t: number, opts: { color?: string; label?: string; both?: boolean; labelDy?: number } = {}) {
  const c = opts.color ?? LINE;
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const head = (p: [number, number], an: number) => {
    const s = 8;
    const p1 = [p[0] - s * Math.cos(an - 0.45), p[1] - s * Math.sin(an - 0.45)];
    const p2 = [p[0] - s * Math.cos(an + 0.45), p[1] - s * Math.sin(an + 0.45)];
    return `<path d="M${p1[0]},${p1[1]} L${p[0]},${p[1]} L${p2[0]},${p2[1]}" fill="none" stroke="${c}" stroke-width="1.6" class="o" style="${at(t + 0.45, 0.2)}"/>`;
  };
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const label = opts.label
    ? `<text x="${mid[0]}" y="${mid[1] + (opts.labelDy ?? -10)}" text-anchor="middle" class="o lbl" style="${at(t + 0.2, 0.3)}">${esc(opts.label)}</text>`
    : "";
  return `<path d="M${a[0]},${a[1]} L${b[0]},${b[1]}" pathLength="1" class="wire" stroke="${c}" style="animation: draw .5s ${EASE} ${t}s forwards"/>${head(b, ang)}${opts.both ? head(a, ang + Math.PI) : ""}${label}`;
}
const svg = (inner: string) => `<svg class="wires" width="${W}" height="${H}">${inner}</svg>`;

/** The four groups, small in the top-right corner; the active ones in lemon. */
const MINI: [Group, string, number, number, number, number][] = [
  ["chrome", "Reviewer's Chrome", 0, 0, 128, 30],
  ["app", "Ramp Teach app", 136, 0, 132, 68],
  ["anthropic", "Anthropic", 276, 0, 112, 30],
  ["sandbox", "Agent sandbox", 276, 38, 112, 30],
];
const MINI_X = 1824 - 388;
const MINI_Y = 84;
function minimap(active: Group[], t: number, extra = "") {
  const cells = MINI.map(([g, label, x, y, w, h]) => {
    const on = active.includes(g);
    return `<div class="mini${on ? " on" : ""}" style="${box(x, y, w, h)}">${esc(label)}</div>`;
  }).join("");
  return `<div class="o minimap" style="${box(MINI_X, MINI_Y, 388, 68)}${extra || at(t, 0.5)}">${cells}</div>`;
}

/* ------------------------------------------------------------------ page */
export function sectionHtml(d: Section, logos: Logos): string {
  const caps = d.captions
    .map((c) => `<div class="cap" style="animation: capin .3s ease ${c.t0}s forwards, capout .3s ease ${Math.max(c.t0 + 0.3, c.t1 - 0.3)}s forwards">${esc(c.text)}</div>`)
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    ${fontFaceCss([300, 400, 700])}
    html,body { margin:0; width:${W}px; height:${H}px; overflow:hidden; background:#121211; font-family: Lausanne, Inter, sans-serif; color:#fff; -webkit-font-smoothing: antialiased; }
    body > *, .layer > * { position:absolute; }
    .o, .panel, .r, .title, .cap, .card { opacity:0; }
    .title { left:96px; top:78px; font-size:46px; font-weight:400; letter-spacing:-.015em; transform: translateY(8px); ${at(0.05, 0.6)} }
    .panel { background:#1a1918; border:1px solid rgb(46,44,42); border-radius:14px; overflow:hidden; transform: translateY(10px); box-sizing:border-box; }
    .panel.group { background: transparent; border:1px dashed rgb(70,67,64); }
    .panel.key { border-color:${LEMON}; }
    .ph { height:50px; display:flex; align-items:center; gap:12px; padding:0 20px; font-size:18px; color: rgb(222,218,213); border-bottom:1px solid rgb(40,38,36); }
    .panel.group .ph { border-bottom:none; font-size:16px; color: rgb(150,145,140); height:40px; }
    .ph .n { margin-left:auto; font: 400 13.5px "JetBrains Mono", monospace; color: rgb(140,135,130); }
    .card { background:#fff; color:#1a1919; border-radius:12px; transform: translateY(10px); box-sizing:border-box; font-family: Lausanne, Inter, sans-serif; }
    .r { transform: translateY(6px); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .r.wrap { white-space:normal; overflow:visible; }
    .mono { font-family: "JetBrains Mono", monospace; color: rgb(205,200,194); }
    .t { color:#fff; }
    .m { color: rgb(128,123,118); }
    .q { color: rgb(214,209,203); font-style: italic; }
    .hl { color:${LEMON}; }
    .muted { color: rgb(140,135,130); }
    .soft { color: rgb(205,200,194); }
    .bad { color: ${RED}; }
    .node { display:flex; align-items:center; gap:12px; padding:0 18px; background:#1a1918; border:1px solid rgb(56,54,51); border-radius:12px; box-sizing:border-box; transform: translateY(8px); }
    .node .s { display:block; font: 400 13px "JetBrains Mono", monospace; color: rgb(140,135,130); margin-top:5px; }
    .node.key { border-color:${LEMON}; }
    .hlbox { border:2px solid ${LEMON}; border-radius:6px; box-sizing:border-box; }
    svg.wires { left:0; top:0; overflow:visible; }
    .wire { fill:none; stroke-width:1.6; stroke-dasharray:1; stroke-dashoffset:1; }
    .lbl { font: 400 13px "JetBrains Mono", monospace; fill: rgb(150,145,140); }
    .grow { transform-origin:left center; transform: scaleX(0); }
    .grow-y { transform-origin: top; transform: scaleY(0); }
    .lock { display:flex; align-items:center; }
    .minimap { transform-origin: right top; }
    .mini { position:absolute; display:flex; align-items:center; justify-content:center; text-align:center; box-sizing:border-box; border:1px solid rgb(62,60,57); border-radius:6px; font-size:12px; line-height:1.15; color: rgb(125,121,116); }
    .mini.on { border-color:${LEMON}; color:${LEMON}; }
    .cap { left:50%; bottom:46px; transform:translateX(-50%); max-width:1400px; width:max-content; background:rgba(18,18,18,.84);
      border:1px solid rgba(255,255,255,.06); color:#fff; font: 500 30px/1.35 Inter, system-ui, sans-serif; text-align:center; padding:14px 28px; border-radius:14px; }
    @keyframes in { to { opacity:1; transform:none; } }
    @keyframes out { from { opacity:1; } to { opacity:0; } }
    @keyframes dim { from { opacity:1; } to { opacity:.5; } }
    @keyframes capin { to { opacity:1; } }
    @keyframes capout { from { opacity:1; } to { opacity:0; } }
    @keyframes draw { to { stroke-dashoffset:0; } }
    @keyframes growx { to { opacity:1; transform: scaleX(1); } }
    @keyframes growy { to { opacity:1; transform: scaleY(1); } }
    @keyframes lit { to { border-color:#fff; color:#fff; } }
    @keyframes litkey { to { border-color:${LEMON}; } }
    @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(228,242,34,.45); } 100% { box-shadow: 0 0 0 18px rgba(228,242,34,0); } }
    @keyframes flash { 0% { opacity:0; } 15% { opacity:1; } 85% { opacity:1; } 100% { opacity:0; } }
    @keyframes lap { from { offset-distance: 0%; opacity:1; } to { offset-distance: 100%; opacity:1; } }
    @keyframes failred { to { color:${RED}; } }
    @keyframes float { 0% { transform: translateY(0); } 50% { transform: translateY(-6px); } 100% { transform: translateY(0); } }
    @keyframes wipe { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0 0 0 0); } }
  </style></head><body>
    ${d.title ? `<div class="title">${esc(d.title)}</div>` : ""}
    ${d.body(logos)}
    ${d.minimap ? minimap(d.minimap, 0.3) : ""}
    ${caps}
  </body></html>`;
}

/* ================================================================== the take, read from the archive */

interface Step {
  ts: string;
  kind: string;
  detail: { event?: string; url?: string; selector?: string; text?: string; value?: string };
}
interface Rec {
  session_id: string;
  started_at: string;
  steps: Step[];
  transcript?: unknown[];
  speech?: { provider?: string; utterances: { id: string; text: string; start: number; end: number; words: { text: string; start: number }[]; step_refs: number[] }[] };
}

/** `npm run eval` output, parsed: correction cases and the precision pass over past invoices. */
export interface Replay {
  cases: { passed: number; total: number };
  rows: { id: string; check: string; verdict: string }[];
  precision: { invoice: string; expected: string; got: string; verdict: string }[];
}
export function parseReplay(txt: string): Replay | null {
  const m = /(\d+)\/(\d+) passed/.exec(txt);
  if (!m) return null;
  const rows = [...txt.matchAll(/^(EV-\S+)\s+(\S+)\s+\S+\s+\S+\s+\S+\s+(PASS|FAIL)\s*$/gm)].map((x) => ({ id: x[1], check: x[2], verdict: x[3] }));
  const precision = [...txt.matchAll(/^(HSG-\d+)\s+(\S+)\s+(.+?)\s+(PASS|FAIL)\s*$/gm)].map((x) => ({ invoice: x[1], expected: x[2], got: x[3].trim(), verdict: x[4] }));
  return { cases: { passed: Number(m[1]), total: Number(m[2]) }, rows, precision };
}
/** The correction replay: captured with the take (eval-replay.json / .txt), else `learn/run-evals.ts` run now (plain code, no API). */
function replayResult(): Replay | null {
  const j = readMaybe<Replay>(runFile("eval-replay.json"));
  if (j?.cases) return j;
  let txt = fs.existsSync(runFile("eval-replay.txt")) ? fs.readFileSync(runFile("eval-replay.txt"), "utf8") : "";
  if (!txt) {
    try {
      txt = execFileSync("npx", ["tsx", "learn/run-evals.ts"], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] }).toString();
    } catch (e) {
      txt = String((e as { stdout?: Buffer }).stdout ?? "");
    }
  }
  return parseReplay(txt);
}

interface Review {
  id: string;
  runId: string;
  ev: J[];
  actions: J[];
  route: J | null;
  check: J | null;
  receipt: J | null;
  spans: J[];
  calls: J[];
  cost: number;
  turns: number | null;
  facts: number;
  tasks: number | null;
  maxTurns: number | null;
  results: Record<string, string> | null;
  decision: string | null;
  t: { total: number | null; browser: number | null; receipt: number | null };
  turnRequest: (n: number) => string | null;
  turnTools: (n: number) => string[];
  startTs: string;
}

function reviewOf(trace: J[], usage: J[], decisions: J[], id: string): Review | null {
  const runId = [...new Set(trace.filter((e) => String(e.run_id).includes(id)).map((e) => e.run_id as string))].at(-1);
  if (!runId) return null;
  const ev = trace.filter((e) => e.run_id === runId);
  const find = (s: string) => ev.find((e) => e.step === s);
  const ms = (a?: J, b?: J) => (a && b ? Date.parse(b.ts) - Date.parse(a.ts) : null);
  const start = find("run.start") ?? ev[0];
  const end = find("receipt.written") ?? ev.at(-1);
  const t0 = Date.parse(start.ts);
  const t1 = Date.parse(end.ts);
  const calls = usage.filter((u) => Date.parse(u.ts) >= t0 - 100 && Date.parse(u.ts) <= t1 + 1500);
  const spans = jsonl(runFile(`spans-${id}.jsonl`));
  const actions = ev.filter((e) => e.step === "browser.action");
  const done = find("browser.done");
  const turnCalls = calls.filter((u) => u.purpose === "browser-turn");
  const turnRequest = (n: number): string | null => {
    const sp = spans.find((s) => s.kind === "model" && s.name === `turn ${n}`)?.attrs?.request_id;
    if (sp) return sp;
    const res = ev.find((e) => e.step === "browser.result" && e.detail?.turn === n && e.detail?.stop_reason);
    const byTs = res ? usage.find((u) => Math.abs(Date.parse(u.ts) - Date.parse(res.ts)) < 60)?.request_id : null;
    return byTs ?? turnCalls[n - 1]?.request_id ?? null;
  };
  const turnTools = (n: number) => actions.filter((a) => a.detail?.turn === n).map((a) => tool(a.detail.tool)).filter((x) => x !== "wait");
  const dec = decisions.filter((d) => d.invoice_id === id).at(-1);
  return {
    id,
    runId,
    ev,
    actions,
    route: readMaybe(runFile(`route-${id}.json`)),
    check: readMaybe(runFile(`evidence-check-${id}.json`)),
    receipt: readMaybe(runFile(`receipt-${id}.json`)),
    spans,
    calls,
    cost: calls.reduce((a, r) => a + usd(r), 0),
    turns: done?.detail?.turns ?? null,
    facts: done?.detail?.facts ?? ev.filter((e) => e.step === "browser.evidence").length,
    tasks: find("evidence.plan")?.detail?.tasks?.length ?? find("browser.start")?.detail?.tasks ?? null,
    maxTurns: find("browser.start")?.detail?.max_turns ?? null,
    results: find("calc.with_evidence")?.detail?.results ?? null,
    decision: dec?.decision ?? null,
    t: { total: ms(start, end), browser: ms(find("browser.start"), done), receipt: ms(find("synthesis.start"), find("synthesis.done")) },
    turnRequest,
    turnTools,
    startTs: start.ts,
  };
}

let takeCache: ReturnType<typeof readTake> | null = null;
function readTake() {
  const rec = readMaybe<Rec>(runFile("sent-recording.json")) ?? readMaybe<Rec>(runFile("film-recording.json"));
  const speech = rec?.speech?.utterances?.length ? rec.speech : null;
  const skill = readMaybe(runFile("skill/skill.json"));
  const evalRun = readMaybe(runFile("eval-run.json"));
  const spec = readMaybe(runFile("learned-workflow_spec.json"));
  const meta = readMaybe(runFile("learned-learn_meta.json"));
  const learnTrace = jsonl(runFile("learn-trace.jsonl"));
  const trace = jsonl(runFile("trace.jsonl"));
  const usage = jsonl(runFile("usage.jsonl"));
  const decisions = jsonl(runFile("decisions.jsonl"));
  const r1 = reviewOf(trace, usage, decisions, "HSG-1011");
  const r2 = reviewOf(trace, usage, decisions, "HSG-1012");
  const firstRun = [r1, r2].filter(Boolean).map((r) => Date.parse(r!.startTs));
  const learnCalls = firstRun.length ? usage.filter((u) => Date.parse(u.ts) < Math.min(...firstRun)) : usage;
  const evalOk = evalRun && skill && evalRun.version === skill.version ? evalRun : null;
  return { rec, speech, skill, evalRun: evalOk, spec, meta, learnTrace, trace, usage, decisions, r1, r2, learnCalls };
}
const take = () => (takeCache ??= readTake());

/** The employee whose hours check failed in HSG-1011 (from the receipt's evidence pointer), with the fact the agent recorded. */
function focusFact() {
  const { r1 } = take();
  if (!r1) return null;
  const hours = r1.receipt?.checks?.find((c: J) => c.name === "hours_match_timecards");
  const fromReceipt = /employees\/(E-\d+)/.exec(String(hours?.evidence ?? ""))?.[1];
  const recs = r1.actions.filter((a) => tool(a.detail.tool) === "record_evidence" && a.detail.input?.key === "approved_hours");
  const act = recs.find((a) => a.detail.input?.subject_ref?.employee_id === fromReceipt) ?? recs.at(-1);
  if (!act) return null;
  const emp = act.detail.input.subject_ref?.employee_id as string;
  const week = act.detail.input.subject_ref?.week_ending as string;
  const ev = r1.ev.find((e) => e.step === "browser.evidence" && e.detail?.key === "approved_hours" && e.detail?.subject_ref?.employee_id === emp);
  const source = String(ev?.detail?.source ?? `fixture:/portal/employees/${emp}?week=${week}`).replace(/^fixture:/, "");
  const nav = r1.actions.find((a) => (tool(a.detail.tool) === "navigate" && String(a.detail.input?.url ?? "").includes(`/employees/${emp}`)));
  // Billed hours for that employee from the invoice itself (data/invoices/new), with the line number.
  const inv = readMaybe(path.join(ROOT, "data", "invoices", "new", "HSG-1011.json"));
  const vendor = readMaybe(path.join(ROOT, "data", "vendor.json"));
  const name = vendor?.employees?.find((e: J) => e.employee_id === emp)?.name ?? emp;
  const lineIdx = (inv?.line_items ?? []).findIndex((l: J) => String(l.description).includes(name) && String(l.description).includes(week));
  const billed = lineIdx >= 0 ? inv.line_items[lineIdx].quantity : null;
  return { emp, week, name, value: String(act.detail.input.value), source, turn: act.detail.turn as number, navTurn: (nav?.detail?.turn as number) ?? null, line: lineIdx >= 0 ? lineIdx + 1 : null, billed };
}

/** Receipt numbers for HSG-1011: the failing checks, the reason line for the focus employee, and the credit total. */
function receiptFacts() {
  const { r1 } = take();
  const rc = r1?.receipt;
  if (!rc) return null;
  const fails = (rc.checks ?? []).filter((c: J) => c.result === "fail").length;
  const f = focusFact();
  const reasons: string[] = rc.reasons ?? [];
  const line = (f && reasons.find((r) => r.includes(f.name) && /approved/i.test(r))) ?? reasons.find((r) => /hours/i.test(r)) ?? null;
  const creditReason = reasons.find((r) => /credit/i.test(r));
  const credit = creditReason ? (creditReason.match(/\$[\d,]+(?:\.\d\d)?/g) ?? []).at(-1) ?? null : null;
  return { fails, line, credit, recommendation: rc.recommendation as string };
}

/** For the footage captions (film.ts): how many checks failed on HSG-1011 and the credit (calc first, else the receipt). */
export function disputeFacts(): { fails: number; credit: string | null } | null {
  const calc = readMaybe(runFile("calc-HSG-1011.json"));
  const rf = receiptFacts();
  if (calc?.checks) {
    const fails = calc.checks.filter((c: J) => c.result === "fail").length;
    return { fails, credit: typeof calc.credit_total === "number" ? money(calc.credit_total) : rf?.credit ?? null };
  }
  return rf ? { fails: rf.fails, credit: rf.credit } : null;
}
/* ================================================================== beat 0: intro */

function introBody(logos: Logos): string {
  return `
    <div style="left:0;top:380px;width:${W}px;display:flex;justify-content:center">${rampLockup(logos, 64, 0.02, 0.5)}</div>
    <div class="o" style="left:${(W - 1080) / 2}px;top:540px;width:1080px;text-align:center;font-size:30px;line-height:1.5;color:rgb(222,218,213);animation: in .3s ${EASE} .45s forwards;transform:translateY(6px)">Show Ramp how you check a bill once. It learns your steps, checks the next bill the same way, and brings you the proof so you can approve or dispute it.</div>`;
}

/* ================================================================== beat 2: Recording and Transcription */

function stepLabel(s: Step): { kind: string; target: string; value: string } {
  const d = s.detail;
  const ev = d.event ?? s.kind;
  if (ev === "input") return { kind: "type", target: d.selector ?? "", value: d.value === "[redacted]" ? "[redacted]" : `"${d.value ?? ""}"` };
  return { kind: ev, target: d.selector ?? "", value: d.text ? `"${clip(d.text, 18)}"` : "" };
}

function recordBody(): string {
  const { rec, speech } = take();
  if (!rec) return row(96, 300, 1000, 40, "No recording in this archive.", 0.5, "muted");
  const t0 = Date.parse(rec.started_at);
  const at_ = (s: Step) => (Date.parse(s.ts) - t0) / 1000;
  const steps = rec.steps;
  const viewIdx = steps.findIndex((s) => s.detail.event === "click" && /\/portal\/employees\//.test(s.detail.selector ?? ""));
  const hoursIdx = steps.findIndex((s) => s.detail.event === "click" && /approved_hours/.test(s.detail.selector ?? ""));
  const pwIdx = steps.findIndex((s) => s.detail.event === "input" && s.detail.value === "[redacted]");
  // The sentence linked to the approved-hours click that starts closest to it (the one said on that page).
  const clickAt = hoursIdx >= 0 ? at_(steps[hoursIdx]) : 0;
  const linkedUtts = speech ? speech.utterances.filter((u) => u.step_refs.includes(hoursIdx)) : [];
  const utt = speech ? [...linkedUtts].sort((a, b) => Math.abs(a.start - clickAt) - Math.abs(b.start - clickAt))[0] ?? speech.utterances.find((u) => /approved/i.test(u.text)) ?? null : null;
  const narr = steps.find((s, i) => s.kind === "narration" && i > hoursIdx) ?? steps.find((s) => s.kind === "narration" && /approved/i.test(s.detail.text ?? ""));
  const sayText = utt?.text ?? narr?.detail.text ?? "";
  const sayAt = utt ? utt.start : narr ? at_(narr) : 0;

  // Portal column: the invoice line and the timecard field the clicks hit (from the seed data the portal serves).
  const view = steps[viewIdx];
  const invId = /invoices\/(HSG-\d+)/.exec(view?.detail.url ?? "")?.[1] ?? "HSG-1010";
  const emp = /employees\/(E-\d+)/.exec(view?.detail.selector ?? "")?.[1] ?? "E-101";
  const week = /week=([\d-]+)/.exec(view?.detail.selector ?? "")?.[1] ?? "";
  const inv = readMaybe(path.join(ROOT, "data", "invoices", "past", `${invId}.json`));
  const vendor = readMaybe(path.join(ROOT, "data", "vendor.json"));
  const person = vendor?.employees?.find((e: J) => e.employee_id === emp);
  const line = inv?.line_items?.find((l: J) => person && String(l.description).includes(person.name));
  const tc = (readMaybe<J[]>(path.join(ROOT, "data", "timecards.json")) ?? []).find((t) => t.employee_id === emp && t.week_ending === week);
  const hoursVal = steps[hoursIdx]?.detail.text ?? String(tc?.approved_hours ?? "");

  const PX = 96, PW = 470;
  const portal = `
    ${colHead(PX, 212, PW, "Portal", 0.3)}
    <div class="card" style="${box(PX, 248, PW, 172)}padding:22px 24px;${at(0.5, 0.5)}">
      <div style="font-size:21px">Invoice ${esc(invId)}</div>
      <div style="display:flex;gap:18px;align-items:baseline;margin-top:30px;font-size:17px">
        <span>${esc(person?.name ?? emp)}</span><span style="color:#7a7570">${esc(person?.role ?? "")}</span><span style="margin-left:auto">${esc(line?.quantity ?? "")} h</span>
      </div>
      <div style="margin-top:14px;font-size:16px;color:#2c5bd8;text-decoration:underline">View timecard</div>
    </div>
    <div class="o hlbox" style="${box(PX + 14, 248 + 101, 128, 31)}${at(1.0, 0.3)}"></div>
    <div class="card" style="${box(PX, 448, PW, 150)}padding:22px 24px;${at(2.0, 0.5)}">
      <div style="font-size:19px">${esc(person?.name ?? emp)}, week ending ${esc(week)}</div>
      <div style="display:flex;justify-content:space-between;margin-top:34px;font-size:17px"><span style="color:#7a7570">Approved hours</span><span>${esc(hoursVal)}</span></div>
    </div>
    <div class="o hlbox" style="${box(PX + 12, 448 + 68, PW - 24, 36)}${at(2.5, 0.3)}"></div>`;

  // Capture path, as two small flows with drawn arrows.
  const flowY = 650;
  const node = (x: number, y: number, w: number, label: string, t: number) =>
    `<div class="o node mono" style="${box(x, y, w, 40)}justify-content:center;font-size:14px;${at(t, 0.4)}">${esc(label)}</div>`;
  const flow = `
    ${node(PX, flowY, 128, "content.js", 7.4)}${node(PX + 172, flowY, 170, "service worker", 7.6)}
    ${row(PX + 352, flowY, 130, 40, "chrome.storage", 7.8, "mono m", "font-size:13px;")}
    ${speech ? `${node(PX, flowY + 64, 128, "mic", 8.0)}${node(PX + 172, flowY + 64, 170, "/api/stt", 8.2)}
    ${row(PX + 352, flowY + 64, 130, 40, "words + times", 8.4, "mono m", "font-size:13px;")}` : ""}`;
  const flowArrows = [arrow([PX + 132, flowY + 20], [PX + 168, flowY + 20], 7.6), ...(speech ? [arrow([PX + 132, flowY + 84], [PX + 168, flowY + 84], 8.2)] : [])].join("");

  // Recorded column: the rows, picked by content.
  const RX = 606, RW = 720, RY = 212;
  type RowSpec = { idx: number; t: number; time: number; kind: string; html: string; h: number };
  const rows: RowSpec[] = [];
  const domRow = (idx: number, t: number) => {
    if (idx < 0) return;
    const s = steps[idx];
    const l = stepLabel(s);
    const val = l.value === "[redacted]" ? `<span class="m">[redacted]</span>` : `<span class="t">${esc(l.value)}</span>`;
    rows.push({ idx, t, time: at_(s), kind: l.kind, html: `<div class="soft" style="font-size:14.5px;line-height:22px;word-break:break-all">${esc(l.target)}</div><div style="font-size:14.5px;line-height:22px">${val}</div>`, h: 66 });
  };
  domRow(viewIdx, 1.3);
  domRow(hoursIdx, 2.9);
  if (sayText) rows.push({ idx: -2, t: 3.5, time: sayAt, kind: "say", html: "", h: 88 });
  domRow(pwIdx, 6.7);
  let ry = RY + 36 + 18;
  const rowHtml: string[] = [];
  let hoursRowY = 0, sayRowY = 0;
  for (const r of rows) {
    const label = `<span class="mono m" style="position:absolute;left:0;top:0;font-size:13px;line-height:22px">${mmss(r.time)}</span><span class="mono" style="position:absolute;left:58px;top:0;font-size:13px;line-height:22px;color:${r.kind === "say" ? LEMON : "rgb(150,145,140)"}">${esc(r.kind)}</span><span class="mono m" style="position:absolute;right:0;top:0;font-size:13px;line-height:22px">${r.idx >= 0 ? `#${r.idx}` : utt ? esc(utt.id) : ""}</span>`;
    if (r.kind === "say") {
      sayRowY = ry;
      const words = sayText.split(/\s+/);
      const wt = utt?.words?.length === words.length ? utt.words.map((w) => w.start - utt.start) : words.map((_, i) => i * 0.3);
      const span = Math.max(0.1, wt.at(-1) ?? 1);
      const ws = words.map((w, i) => `<span class="o" style="${at(r.t + 0.2 + (wt[i] / span) * 1.9, 0.18)}">${esc(w)}</span>`).join(" ");
      rowHtml.push(`<div class="r wrap" style="${box(RX + 20, ry, RW - 40)}height:${r.h}px;${at(r.t, 0.3)}">${label}<div class="q" style="position:absolute;left:134px;right:40px;top:0;font-size:17px;line-height:25px;font-style:italic;color:#fff">“${ws}”</div></div>`);
    } else {
      if (r.idx === hoursIdx) hoursRowY = ry;
      rowHtml.push(`<div class="r wrap" style="${box(RX + 20, ry, RW - 40)}height:${r.h}px;${at(r.t, 0.4)}">${label}<div class="mono" style="position:absolute;left:134px;right:40px;top:0">${r.html}</div></div>`);
    }
    ry += r.h + 14;
  }
  const RH = ry - RY - 36 + 4;
  const linked = utt && hoursIdx >= 0 && utt.step_refs.includes(hoursIdx);
  const link = linked
    ? svg(`<path d="M${RX + 12},${sayRowY + 12} C${RX - 26},${sayRowY + 12} ${RX - 26},${hoursRowY + 12} ${RX + 12},${hoursRowY + 12}" pathLength="1" class="wire" stroke="${LEMON}" style="animation: draw .6s ${EASE} 6.0s forwards"/>`) +
      row(RX + 154, sayRowY + 58, 300, 24, `linked to #${hoursIdx}`, 6.2, "mono hl", "font-size:13px;")
    : "";
  const recorded = `${colHead(RX, RY, RW, "Recorded", 1.1)}${panel(RX, RY + 36, RW, RH, "", 1.1)}${rowHtml.join("")}${link}`;

  // Sent to Ramp column: the payload.
  const SX = 1366, SW = 458, SY = 248;
  const narrLines = steps.filter((s) => s.kind === "narration").length;
  const words = speech ? speech.utterances.reduce((n, u) => n + u.words.length, 0) : 0;
  const payload = [
    `<span class="t">{</span>`,
    `&nbsp;&nbsp;session_id: <span class="t">"${esc(rec.session_id)}"</span>,`,
    `&nbsp;&nbsp;steps: <span class="t">${steps.length}</span>,`,
    speech ? `&nbsp;&nbsp;speech: <span class="t">${speech.utterances.length} sentences, ${words} words</span>` : `&nbsp;&nbsp;narration: <span class="t">${narrLines} lines</span>`,
    `<span class="t">}</span>`,
  ];
  const sent = `
    ${colHead(SX, 212, SW, "Sent to Ramp", 8.5)}
    ${panel(SX, SY, SW, 300, "", 8.6)}
    <div class="r" style="${box(SX + 22, SY + 18, SW - 44)}height:30px;line-height:30px;font: 500 17px 'JetBrains Mono', monospace;color:rgb(150,145,140);${at(8.8, 0.4)}animation: in .4s ${EASE} 8.8s forwards, lit .4s ease 9.4s forwards">POST /api/learn</div>
    ${payload.map((l, i) => row(SX + 22, SY + 70 + i * 34, SW - 44, 34, l, 9.0 + i * 0.12, "mono soft", "font-size:14.5px;")).join("")}
    ${text(SX, SY + 330, SW, `<span class="muted">Not sent:</span> video, the screen, cookies`, 10.4, "font-size:19px;")}`;

  return `${portal}${flow}${svg(flowArrows)}${recorded}${sent}`;
}

/* ================================================================== beat 4: architecture overview */

function overviewBody(): string {
  const { skill, spec, r1, usage } = take();
  const model = usage.find((u) => u.model)?.model ?? skill?.stages?.find((s: J) => s.model)?.model ?? null;
  const ver = skill?.version ? `v${skill.version}` : "";
  const rules = skill?.rules?.length ?? spec?.rules?.length ?? null;
  const pages = skill?.portal_map?.length ?? spec?.proof_sources?.length ?? null;
  const route = r1?.route;
  const routerLabel = route?.mode === "real" && /jev/i.test(String(route?.model ?? "")) ? "Router (Jev)" : "Router";
  const vault = (r1?.actions ?? []).some((a) => /sign_in/.test(String(a.detail?.tool))) || (r1?.ev ?? []).some((e) => /vault/.test(String(e.step)));

  const n = (x: number, y: number, w: number, h: number, inner: string, t: number, cls = "") =>
    `<div class="o node ${cls}" style="${box(x, y, w, h)}font-size:19px;${at(t, 0.45)}">${inner}</div>`;
  const grp = (x: number, y: number, w: number, h: number, label: string, t: number) => panel(x, y, w, h, `<span>${esc(label)}</span>`, t, "group");
  // Teaching row (0 to 3 s), then the review row (3.3 to 6.2 s), then the groups go to the corner mini-map.
  const G = { cx: 96, cw: 400, ax: 576, aw: 720, nx: 1376, nw: 448 };
  const html = `
    ${grp(G.cx, 232, G.cw, 196, "Reviewer's Chrome", 0.15)}
    ${n(128, 296, 336, 84, `${extIcon(26)}<span>Recorder extension</span>`, 0.3)}
    ${grp(G.ax, 232, G.aw, 704, "Ramp Teach app", 0.45)}
    ${n(616, 296, 300, 84, `<span>Learning job</span>`, 0.75)}
    ${grp(G.nx, 232, G.nw, 196, "Anthropic", 0.98)}
    ${n(1408, 296, 384, 84, `${claudeMark(26)}<span>Claude${model ? `<span class="s">${esc(model)}</span>` : ""}</span>`, 1.12)}
    <div class="o node key" style="${box(616, 460, 640, 92)}font-size:22px;${at(1.88, 0.38)}animation: in .5s ${EASE} 1.88s forwards, pulse 1s ease-out 2.25s 1"><span>Learned workflow ${esc(ver)}${rules != null ? `<span class="s">${rules} rules, ${pages ?? 0} portal pages</span>` : ""}</span></div>
    ${n(616, 640, 260, 84, `<span>Bill Pay inbox</span>`, 2.47)}
    ${n(996, 640, 260, 84, `<span>${esc(routerLabel)}</span>`, 2.78)}
    ${grp(G.nx, 532, G.nw, 404, "Agent sandbox", 3.07)}
    ${n(1408, 600, 384, 84, `<span>Agent harness<span class="s">one browser per run</span></span>`, 3.22)}
    ${n(1408, 716, 384, 84, `<span>Headless Chromium<span class="s">fresh profile, localhost only</span></span>`, 3.38)}
    ${vault ? row(1408, 818, 384, 30, "signs in from the vault", 3.53, "mono muted", "font-size:13.5px;") : ""}
    ${n(616, 812, 260, 84, `<span>You<span class="s">Approve or Dispute</span></span>`, 4.2)}`;
  const arrows = [
    arrow([464, 338], [616, 338], 0.6, { label: "recording JSON" }),
    arrow([916, 338], [1408, 338], 1.35, { label: "transcript + steps", both: true }),
    arrow([766, 380], [766, 460], 1.65),
    arrow([876, 682], [996, 682], 2.7, { label: "new invoice" }),
    arrow([1126, 552], [1126, 640], 2.92),
    arrow([1256, 662], [1408, 642], 3.3, { label: "run" }),
    arrow([1600, 600], [1600, 380], 3.68, { label: "page state, tool call", both: true, labelDy: 0 }),
    `<path d="M1408,758 L1336,758 L1336,854 L876,854" pathLength="1" class="wire" stroke="${LINE}" style="animation: draw .7s ${EASE} 3.97s forwards"/>
     <path d="M884,848 L876,854 L884,860" fill="none" stroke="${LINE}" stroke-width="1.6" class="o" style="${at(4.43, 0.15)}"/>
     <text x="1106" y="844" text-anchor="middle" class="o lbl" style="${at(4.2, 0.22)}">receipt + evidence</text>`,
  ].join("");
  // The vertical label sits beside its arrow.
  const fixed = arrows.replace(`x="1600" y="490"`, `x="1700" y="494"`);
  return `<div class="o layer" style="left:0;top:0;width:${W}px;height:${H}px;animation: in .01s linear 0s forwards, dim .6s ease 5.5s forwards">${html}${svg(fixed)}</div>${minimap(["chrome", "app", "sandbox", "anthropic"], 0, `transform:scale(1.5);animation: in .6s ${EASE} 5.5s forwards`)}`;
}

/* ================================================================== beat 6: Agent Learning */

const STAGE_LABEL: Record<string, string> = { segment: "segment", claims: "claims", synthesize: "synthesize", critique: "critique", checks: "checks", package: "package" };

function learningData() {
  const { skill, spec, meta, learnTrace, rec, speech, evalRun, learnCalls } = take();
  // Stage strip: the skill's stages (with who did each), the evals and the version; else the single-call learner.
  type Chip = { name: string; sub: string; claude: boolean; key?: boolean };
  let chips: Chip[];
  if (skill?.stages?.length) {
    chips = skill.stages.map((s: J) => {
      const real = s.mode === "real";
      const ms = Date.parse(s.finished_at) - Date.parse(s.started_at);
      let sub = real ? "Claude" : "code";
      if (s.name === "checks" && real) sub = "Claude, sandbox";
      if (s.name === "package") sub = skill.anthropic_skill ? "Skills API" : "code";
      if (real && ms >= 100) sub += `, ${secs(ms)}`;
      return { name: STAGE_LABEL[s.name] ?? s.name, sub, claude: real && s.name !== "package" };
    });
    if (evalRun) chips.push({ name: "evals", sub: evalRun.gate?.passed ? "gate passed" : "gate failed", claude: false });
    const active = skill.status === "active" || evalRun?.gate?.passed;
    chips.push({ name: `v${skill.version}`, sub: active ? "active" : "draft", claude: false, key: true });
  } else {
    const distill = learnTrace.find((e) => /^distill/.test(e.step));
    chips = [
      { name: "load recording", sub: "code", claude: false },
      { name: "distill", sub: distill?.mode === "real" ? `Claude, 1 call` : "code", claude: distill?.mode === "real" },
      { name: "workflow spec", sub: `${spec?.rules?.length ?? 0} rules`, claude: false, key: true },
    ];
  }

  // One rule, traced to its words and click.
  const rules: J[] = skill?.rules ?? [];
  const focus =
    rules.find((r) => r.citations?.some((c: J) => /approved_hours/.test(c.selector ?? ""))) ??
    rules.find((r) => /hour/i.test(r.text) && r.citations?.length) ??
    rules.find((r) => r.citations?.length) ??
    null;
  const cite = focus?.citations?.find((c: J) => c.quote) ?? null;
  const stepIdx: number | null = focus?.citations?.find((c: J) => c.step_index != null)?.step_index ?? null;
  const portal = skill?.portal_map?.find((p: J) => p.fields?.some((f: J) => f.name === "approved_hours" || (cite?.selector && f.selector === cite.selector))) ?? null;
  const specRule: string | null = focus ? null : (spec?.rules ?? []).find((r: string) => /hours/i.test(r)) ?? null;
  const specProof = (spec?.proof_sources ?? []).find((p: J) => (p.fields ?? []).includes("approved_hours")) ?? null;
  const ruleText: string | null = focus?.text ?? specRule;
  const proof = portal ? { page: portal.page, field: portal.fields.find((f: J) => f.name === "approved_hours")?.name ?? portal.fields[0]?.name } : specProof ? { page: specProof.location, field: "approved_hours" } : null;

  // The recording rows behind it: the click the citation names (else the approved-hours click) and the sentence.
  const steps = rec?.steps ?? [];
  const hoursIdx = stepIdx ?? steps.findIndex((s) => s.detail.event === "click" && /approved_hours/.test(s.detail.selector ?? ""));
  const step = hoursIdx >= 0 ? steps[hoursIdx] : null;
  const utt = cite?.utterance_id && speech ? speech.utterances.find((u) => u.id === cite.utterance_id) ?? null : null;
  const narr = utt ? null : steps.find((s, i) => s.kind === "narration" && i > hoursIdx);
  const sentence = utt?.text ?? narr?.detail.text ?? null;

  // Provenance: recording id, version, model, request id of the call that wrote the rules.
  const session = learnTrace.find((e) => e.detail?.session_id)?.detail.session_id ?? meta?.provenance?.session_id ?? rec?.session_id ?? null;
  const syn = skill?.stages?.find((s: J) => s.name === "synthesize" && s.request_id) ?? skill?.stages?.find((s: J) => s.request_id);
  const distill = learnTrace.find((e) => /^distill/.test(e.step));
  const reqId: string | null = syn?.request_id ?? distill?.detail?.usage?.request_id ?? distill?.detail?.request_id ?? learnCalls.find((u) => u.request_id)?.request_id ?? null;
  const model: string | null = syn?.model ?? (meta?.mode === "real" ? meta?.model : null) ?? null;
  return { chips, focus, cite, ruleText, proof, step, hoursIdx, utt, sentence, session, reqId, model, skill };
}

function learningBody(): string {
  const d = learningData();
  const f = focusFact();
  const { r1 } = take();
  // Stage strip
  const n = d.chips.length;
  const gap = 34;
  const cw = Math.min(240, (1728 - gap * (n - 1)) / n);
  const sx = 96 + (1728 - (cw * n + gap * (n - 1))) / 2;
  const SY = 206;
  const chips = d.chips
    .map((c, i) => {
      const x = sx + i * (cw + gap);
      const t = 0.5 + i * 0.25;
      return `<div class="o node" style="${box(x, SY, cw, 74)}flex-direction:column;align-items:flex-start;justify-content:center;gap:0;padding:0 14px;color:rgb(150,145,140);${at(t - 0.2, 0.35)}${c.key ? `animation: in .35s ${EASE} ${t - 0.2}s forwards, litkey .4s ease ${t + 0.2}s forwards;` : ""}">
        <div style="font-size:18px;display:flex;gap:8px;align-items:center;animation: lit .3s ease ${t}s forwards">${esc(c.name)}${c.claude ? claudeMark(15) : ""}</div><div class="mono" style="font-size:12.5px;margin-top:5px;color:rgb(128,123,118)">${esc(c.sub)}</div></div>`;
    })
    .join("");
  const chipArrows = d.chips.slice(1).map((_, i) => arrow([sx + (i + 1) * cw + i * gap + 4, SY + 37], [sx + (i + 1) * (cw + gap) - 4, SY + 37], 0.6 + i * 0.25)).join("");

  // Worked example, one left-to-right row on one baseline: recording, cited claim, learned rule with where the
  // proof lives, and the new invoice it was used on. Straight arrows, each drawn as its target appears.
  const EY = 336, BH = 262;
  const stepTxt = d.step ? stepLabel(d.step) : null;
  type Box = { head: string; body: string; claude?: boolean };
  const boxes: Box[] = [];
  const labels: string[] = [];
  boxes.push({
    head: "Recording",
    body: `${d.step ? `<div class="mono m" style="font-size:12.5px">#${d.hoursIdx} ${esc(stepTxt!.kind)}</div><div class="mono soft" style="font-size:14px;line-height:20px;margin-top:4px;word-break:break-all">${esc(stepTxt!.target)} <span class="t">${esc(stepTxt!.value)}</span></div>` : ""}
      ${d.sentence ? `<div class="mono m" style="font-size:12.5px;margin-top:16px">${d.utt ? esc(d.utt.id) : "said"}</div><div class="q" style="font-size:17px;line-height:24px;margin-top:4px">“${esc(d.sentence)}”</div>` : ""}`,
  });
  if (d.cite) {
    labels.push("cites");
    boxes.push({
      head: "Claim",
      claude: true,
      body: `<div style="border-left:2px solid ${LEMON};padding-left:14px"><div class="q" style="font-size:19px;line-height:27px;color:#fff">“${esc(d.cite.quote)}”</div></div><div class="mono m" style="font-size:12.5px;margin-top:12px">${[d.cite.utterance_id, d.cite.step_index != null ? `step #${d.cite.step_index}` : null].filter(Boolean).map(esc).join(", ")}</div>`,
    });
  }
  if (d.ruleText) {
    labels.push("becomes");
    boxes.push({
      head: d.focus ? `Rule in skill v${d.skill?.version ?? 1}` : "Rule in the workflow spec",
      claude: true,
      body: `<div style="font-size:16px;line-height:22px;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden">${d.focus ? `<span class="mono m" style="font-size:13px;margin-right:8px">${esc(d.focus.id)}</span>` : ""}${esc(shortRule(d.ruleText, 118))}</div>
        ${d.proof ? `<div class="muted" style="font-size:13.5px;margin-top:14px">proof</div><div class="mono soft" style="font-size:13px;line-height:19px;margin-top:3px;overflow-wrap:anywhere">${esc(d.proof.page).replace("?", "?<wbr>")}</div><div class="mono hl" style="font-size:13px;margin-top:3px">${esc(d.proof.field)}</div>` : ""}`,
    });
  }
  if (f && d.proof) {
    labels.push("used by agent");
    boxes.push({
      head: "New invoice HSG-1011",
      body: `<div style="font-size:17px;line-height:24px">turn ${f.navTurn ?? f.turn}: opened ${esc(f.emp)}, week ${esc(f.week)}</div><div class="mono" style="font-size:14px;margin-top:14px;color:#fff">approved_hours = ${esc(f.value)}</div><div class="mono m" style="font-size:12.5px;margin-top:6px">turn ${f.turn}, record_evidence</div>`,
    });
  }
  const GAP = 132;
  const BW = (1728 - GAP * (boxes.length - 1)) / boxes.length;
  const tBox = (i: number) => 2.6 + i * 1.05;
  const exampleHtml = boxes
    .map((bx, i) => {
      const x = 96 + i * (BW + GAP);
      return `${panel(x, EY, BW, BH, `<span>${esc(bx.head)}</span>${bx.claude && d.model ? `<span style="margin-left:auto">${claudeMark(16)}</span>` : ""}`, tBox(i))}
        ${text(x + 20, EY + 66, BW - 40, bx.body, tBox(i) + 0.15)}`;
    })
    .join("");
  const exampleArrows = labels
    .map((l, i) => {
      const x1 = 96 + (i + 1) * BW + i * GAP + 10;
      return arrow([x1, EY + BH / 2], [x1 + GAP - 20, EY + BH / 2], tBox(i + 1) - 0.45, { label: l, color: "rgb(150,145,140)" });
    })
    .join("");

  // Provenance: the recording id travels to the version it produced.
  const PY = 676;
  const prov = d.session
    ? `<div class="r mono" style="${box(96, PY, 520)}height:34px;line-height:34px;font-size:15px;color:rgb(205,200,194);transform:translateX(-30px);${at(7.9, 0.7)}">${esc(d.session)}</div>
       ${row(700, PY, 1124, 34, [d.skill ? `skill v${d.skill.version}` : "workflow spec", d.model, d.reqId].filter(Boolean).map((x) => esc(x)).join(", "), 8.4, "mono t", "font-size:15px;")}`
    : "";
  const provArrow = d.session ? arrow([600, PY + 17], [690, PY + 17], 8.3) : "";

  // Learned vs written by engineers.
  const FY = 752;
  const learned = ["rules, where the proof lives", "vendor, open questions", ...(d.cite ? ["citations to words and clicks"] : [])];
  const eng = [`6 checks in calc/ (TypeScript)`, "evidence tasks: one timecard per employee-week", "receipt enforcement, guardrails"];
  const foot = `
    <div class="r" style="${box(96, FY, 1728, 1)}background:rgb(40,38,36);${at(9.0)}"></div>
    ${row(96, FY + 18, 800, 28, "Learned from the recording", 9.1, "t", "font-size:18px;")}
    ${learned.map((l, i) => row(96, FY + 54 + i * 30, 800, 30, esc(l), 9.3 + i * 0.12, "soft", "font-size:17px;")).join("")}
    ${row(960, FY + 18, 864, 28, "Written by engineers", 9.4, "t", "font-size:18px;")}
    ${eng.map((l, i) => row(960, FY + 54 + i * 30, 864, 30, esc(l), 9.6 + i * 0.12, "soft", "font-size:17px;")).join("")}`;
  void r1;
  return `${chips}${exampleHtml}${prov}${foot}${svg(chipArrows + exampleArrows + provArrow)}`;
}

/* ================================================================== beat 9: the run */

function execBody(): string {
  const { r1, r2, skill, spec } = take();
  const f = focusFact();
  const rf = receiptFacts();
  if (!r1) return row(96, 300, 1000, 40, "No HSG-1011 run in this archive.", 0.5, "muted");

  // Left: what started the run.
  const route = r1.route;
  const wf = route?.workflow_id ? (skill?.skill_id === route.workflow_id ? skill.title : route.workflow_id) : null;
  const left: string[] = [
    row(96, 222, 380, 34, "HSG-1011 arrives", 0.5, "t", "font-size:21px;"),
    ...(route ? [text(96, 268, 380, `<span class="muted">Router:</span> ${esc(wf ?? "manual review")}${route.version ? ` v${route.version}` : ""}, ${pct(route.confidence)}`, 0.8, "font-size:17px;line-height:25px;")] : []),
    row(96, route ? 336 : 268, 380, 30, `${r1.tasks ?? "?"} timecards to read`, 1.1, "soft", "font-size:17px;"),
    row(96, route ? 370 : 302, 380, 30, skill ? `skill v${skill.version}, ${skill.rules.length} rules` : spec ? `workflow spec, ${spec.rules.length} rules` : "", 1.3, "soft", "font-size:17px;"),
  ];

  // The harness and the loop.
  const HX = 520, HY = 212, HW = 1304, HH = 432;
  const CX = 580, CY = 290, CW = 300, CH = 104;
  const PX = 1300, PY = 290, PW = 470;
  const model = r1.calls.find((u) => u.model)?.model ?? "";
  const vault = r1.actions.some((a) => /sign_in/.test(String(a.detail?.tool))) || r1.ev.some((e) => /vault/.test(String(e.step)));
  const harness = `
    ${panel(HX, HY, HW, HH, `<span>Agent harness</span><span class="n">agent/providers/browser-loop.ts</span>`, 0.4)}
    <div class="o node" style="${box(CX, CY, CW, CH)}font-size:22px;${at(0.8, 0.45)}">${claudeMark(30)}<span>Claude<span class="s">${esc(model)}</span></span></div>
    <div class="o node" style="${box(PX, PY, PW, CH)}font-size:20px;${at(1.0, 0.45)}"><span>Playwright, headless Chromium<span class="s">its own sandboxed browser</span></span></div>
    ${row(PX, PY + CH + 12, PW, 26, "fresh profile per run, localhost only", 1.4, "mono muted", "font-size:13px;")}
    ${row(PX, PY + CH + 38, PW, 26, "no scripts, no uploads", 1.5, "mono muted", "font-size:13px;")}
    ${vault ? row(PX, PY + CH + 64, PW, 26, "signs in from the vault", 1.6, "mono", `font-size:13px;color:rgb(205,200,194);`) : ""}`;
  const top = CY + 34, bot = CY + 74;
  const loopArrows = [
    arrow([CX + CW + 10, top], [PX - 10, top], 1.6, { label: "tool call" }),
    arrow([PX - 10, bot], [CX + CW + 10, bot], 1.8, { label: "page outline + refs, result", labelDy: 22 }),
  ].join("");
  // Three laps, each one real turn from the take.
  const laps: { turn: number; tools: string[] }[] = [];
  const addLap = (n: number | null | undefined) => {
    if (n == null || laps.some((l) => l.turn === n)) return;
    laps.push({ turn: n, tools: r1.turnTools(n) });
  };
  addLap(r1.actions.find((a) => /form_input|sign_in/.test(tool(a.detail.tool)))?.detail.turn);
  addLap(f?.navTurn);
  addLap(f?.turn);
  laps.sort((a, b) => a.turn - b.turn);
  const loopPath = `M${CX + CW + 10},${top} L${PX - 10},${top} L${PX - 10},${bot} L${CX + CW + 10},${bot} Z`;
  const lapHtml = laps
    .map((l, i) => {
      const t = 2.3 + i * 1.9;
      const tools = l.tools.length > 4 ? [...l.tools.slice(0, 4), `+${l.tools.length - 4}`] : l.tools;
      return `<div class="o" style="left:0;top:0;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;background:${LEMON};offset-path:path('${loopPath}');offset-rotate:0deg;animation: lap 1.6s linear ${t}s 1 both, out .2s linear ${t + 1.6}s forwards"></div>
        <div class="o mono" style="${box(CX + CW + 30, CY - 34, PX - CX - CW - 60)}text-align:center;font-size:14.5px;color:#fff;animation: flash 1.8s linear ${t}s 1 both"><span class="m">turn ${l.turn}</span>&nbsp;&nbsp;${esc(tools.join(", "))}</div>`;
    })
    .join("");
  const tFact = 2.3 + Math.max(0, laps.length - 1) * 1.9 + 1.2;
  const fact = f
    ? `<div class="o node" style="${box(CX, 468, 660, 96)}flex-direction:column;align-items:flex-start;justify-content:center;gap:0;transform:translateY(-24px);${at(tFact, 0.5)}">
         <div class="mono" style="font-size:19px;color:${LEMON}">${esc(`approved_hours = ${f.value}`)}</div><div class="mono m" style="font-size:14px;margin-top:8px">${esc(f.source)}</div></div>
       ${row(CX, 410, 300, 30, "record_evidence", tFact - 0.2, "mono muted", "font-size:13.5px;")}`
    : "";
  const stop = row(PX, 568, PW, 28, `stops: all tasks recorded, or ${r1.maxTurns ?? 25} turns`, tFact + 0.4, "mono muted", "font-size:13.5px;");

  // After the loop: checks (calc, with the credit amounts calc computes), receipt, enforcement, the person.
  const LY = 676, LH = 184;
  const tL = tFact + 0.9;
  const calc = readMaybe(runFile("calc-HSG-1011.json"));
  const fails: J[] = (calc?.checks ?? []).filter((c: J) => c.result === "fail");
  const withAmounts = fails.length > 0 && fails.every((c: J) => c.findings?.every((x: J) => typeof x.amount === "number"));
  const SHORT: Record<string, string> = {
    rate_matches_contract: "rate over contract",
    no_duplicate_lines: "duplicate line",
    hours_match_timecards: "hours over timecard",
    line_amounts_correct: "line math",
    total_matches_line_items: "total",
    no_unknown_charges: "charge not allowed",
  };
  let checkRows: string[];
  if (withAmounts) {
    const items = fails.flatMap((c: J) => c.findings.map((x: J) => ({ name: c.check, line: x.line_index != null ? x.line_index + 1 : null, amount: x.amount as number })));
    checkRows = items.slice(0, 3).map((it, i) =>
      row(118, LY + 60 + i * 28, 476, 28, `<span class="bad" style="display:inline-block;width:40px">fail</span><span class="soft">${it.line ? `line ${it.line}, ` : ""}${esc(SHORT[it.name] ?? it.name)}</span><span class="t" style="position:absolute;right:0">${money(it.amount)}</span>`, tL + 0.2 + i * 0.25, "", "font-size:16px;"),
    );
    if (typeof calc.credit_total === "number")
      checkRows.push(row(118, LY + 60 + Math.min(3, items.length) * 28 + 6, 476, 30, `<span class="muted">credit_total</span><span class="t" style="position:absolute;right:0">${money(calc.credit_total)}</span>`, tL + 1.0, "mono", "font-size:15px;border-top:1px solid rgb(48,46,44);"));
  } else {
    const hoursFail = r1.results?.hours_match_timecards;
    checkRows = [
      row(118, LY + 64, 476, 30, `hours_match_timecards <span class="${hoursFail === "fail" ? "bad" : "t"}">${esc(hoursFail ?? "")}</span>`, tL + 0.2, "mono soft", "font-size:15px;"),
      ...(f?.line ? [row(118, LY + 98, 476, 30, `line ${f.line}, timecard ${f.value} h, billed ${f.billed} h`, tL + 0.35, "soft", "font-size:16px;")] : []),
    ];
  }
  const checks = `${panel(96, LY, 520, LH, `<span>Checks</span><span class="n">calc/</span>`, tL)}${checkRows.join("")}`;
  const tR = tL + 1.3;
  const receipt = `
    ${panel(656, LY, 520, LH, `${claudeMark(20)}<span>Receipt</span>`, tR)}
    ${rf?.line ? text(678, LY + 62, 476, `<span class="q" style="font-size:16px;line-height:24px">“${esc(clip(rf.line, 130))}”</span>`, tR + 0.25) : ""}`;
  const tE = tR + 1.0;
  const enforce = `
    ${panel(1216, LY, 270, LH, `<span>Enforcement</span>`, tE)}
    ${row(1238, LY + 64, 230, 30, withAmounts ? "amounts match calc" : "checks match calc", tE + 0.2, "soft", "font-size:16px;")}
    ${row(1238, LY + 96, 230, 30, "every check has a source", tE + 0.3, "soft", "font-size:16px;")}`;
  const tY = tE + 0.8;
  const decision = r1.decision ? r1.decision[0].toUpperCase() + r1.decision.slice(1) : null;
  const credit = withAmounts && typeof calc.credit_total === "number" ? money(calc.credit_total) : rf?.credit ?? null;
  const you = `
    ${panel(1526, LY, 298, LH, `<span>You</span>`, tY, decision ? "key" : "")}
    ${row(1548, LY + 62, 260, 34, decision ?? `recommends ${esc(rf?.recommendation ?? "")}`, tY + 0.2, "t", "font-size:22px;")}
    ${credit ? row(1548, LY + 98, 260, 30, `${esc(credit)} credit`, tY + 0.3, "soft", "font-size:17px;") : ""}`;
  const laneArrows = [arrow([620, LY + 75], [652, LY + 75], tR - 0.1), arrow([1180, LY + 75], [1212, LY + 75], tE - 0.1), arrow([1490, LY + 75], [1522, LY + 75], tY - 0.1)].join("");
  // HSG-1012 for comparison.
  const all2 = r2?.results ? Object.values(r2.results) : [];
  const cmp = r2 && all2.length
    ? text(96, 470, 380, `<span class="muted">HSG-1012:</span> same workflow, ${all2.filter((v) => v === "pass").length} of ${all2.length} checks pass${r2.decision ? `, ${esc(r2.decision)}` : ""}`, tY + 0.6, "font-size:16px;line-height:24px;")
    : "";
  return `${left.join("")}${harness}${lapHtml}${fact}${stop}${checks}${receipt}${enforce}${you}${cmp}${svg(loopArrows + laneArrows)}`;
}

/* ================================================================== beat 11: evals, trace, cost */

function evalBody(): string {
  const { r1, r2, evalRun, usage, learnCalls, decisions } = take();
  const replay = replayResult();
  const f = focusFact();

  // Left: three test layers.
  const LX = 96, LW = 820;
  const cards: string[] = [];
  let y = 214;
  const card = (title: string, sub: string, how: string, result: string, rows: string[], t: number) => {
    const h = 112 + rows.length * 30;
    const html = `
      ${panel(LX, y, LW, h, "", t)}
      ${row(LX + 22, y + 16, 380, 30, `${esc(title)} <span class="muted" style="font-size:15px">${esc(sub)}</span>`, t + 0.1, "t", "font-size:20px;")}
      ${text(LX + 22, y + 52, 380, `<span class="soft" style="font-size:15.5px;line-height:22px">${how}</span>`, t + 0.2)}
      ${text(LX + 430, y + 18, LW - 452, `<span class="t" style="font-size:17px;line-height:25px">${result}</span>`, t + 0.35)}
      ${rows.map((r, i) => row(LX + 22, y + 102 + i * 30, LW - 44, 30, r, t + 0.6 + i * 0.25, "mono", "font-size:14px;")).join("")}`;
    y += h + 18;
    return html;
  };
  if (replay) {
    const seeded = replay.precision.find((p) => p.expected === "hours_match_timecards" && p.verdict === "PASS");
    const clean = replay.precision.find((p) => p.expected === "clean" && p.verdict === "PASS" && (!seeded || p.invoice > seeded.invoice));
    const pp = replay.precision.filter((p) => p.verdict === "PASS").length;
    const rows = [
      ...(seeded ? [`<span class="soft">${esc(seeded.invoice)} hours over timecard</span>  <span style="animation: failred .3s ease 2.0s forwards" class="m">fail</span>  <span class="o t" style="${at(2.4, 0.3)}">caught</span>`] : []),
      ...(clean ? [`<span class="soft">${esc(clean.invoice)} clean</span>  <span class="t">all pass</span>`] : []),
    ];
    cards.push(card("The checks", "calc/", `Replay ${replay.cases.total} past corrections and ${replay.precision.length} past invoices`, `${replay.cases.passed} of ${replay.cases.total} corrections<br>precision ${pp} of ${replay.precision.length}`, rows, 0.4));
  }
  if (evalRun) {
    const s = evalRun.summary ?? {};
    const parts = [["recall", s.rule_recall], ["precision", s.rule_precision], ["citations", s.citations_valid], ["coverage", s.coverage], ["replay", s.replay_agreement]]
      .filter(([, v]) => typeof v === "number")
      .map(([k, v]) => `${k} ${pct(v as number)}`);
    const n = evalRun.results?.length ?? 0;
    cards.push(card("The learning", "skill evals", `${n} recording variants, learned and graded, then the gate`, `${parts.slice(0, 3).join(", ")}<br>${parts.slice(3).join(", ")}`, [`<span class="${evalRun.gate?.passed ? "t" : "bad"}">gate ${evalRun.gate?.passed ? "passed" : "failed"}</span><span class="soft">, v${evalRun.version} ${evalRun.gate?.passed ? "active" : "stays a draft"}</span>`], 1.4));
  }
  const reviews = [r1, r2].filter(Boolean) as Review[];
  if (reviews.length) {
    const facts = reviews.reduce((a, r) => a + (r.facts ?? 0), 0);
    const receipts = reviews.filter((r) => r.receipt).length;
    const outcome = reviews.map((r) => r.decision ?? r.receipt?.recommendation).filter(Boolean).join(", ");
    const chk = r1?.check?.checks;
    const rows = chk?.length ? [`<span class="soft">${chk.filter((c: J) => c.status === "match").length} of ${chk.length} facts read again from the page: same value</span>`] : [];
    cards.push(card("The whole review", "agent end to end", `Live runs of ${reviews.map((r) => r.id).join(" and ")}`, `${esc(outcome)}<br>${facts} facts, ${receipts} receipts`, rows, 2.4));
  }
  const next = row(LX, y + 4, LW, 28, "Next: a browser-agent suite with seeded portal changes", 3.6, "muted", "font-size:15.5px;");

  // Right: the run you watched, as data.
  const RX = 960, RW = 864;
  const tr: { ts: string; label: string; detail: string; key?: boolean }[] = [];
  if (r1) {
    const rt = r1.route;
    if (rt) tr.push({ ts: hms(rt.decided_at), label: "route", detail: `${rt.workflow_id ?? "manual review"}${rt.version ? ` v${rt.version}` : ""}, ${pct(rt.confidence)}` });
    const nav = f?.navTurn != null ? r1.actions.find((a) => a.detail.turn === f.navTurn && tool(a.detail.tool) === "navigate" && String(a.detail.input?.url ?? "").includes(f.emp)) : null;
    if (nav) tr.push({ ts: hms(nav.ts), label: `turn ${nav.detail.turn}`, detail: `navigate ${urlPath(nav.detail.input.url)}` });
    const recAct = f ? r1.actions.find((a) => a.detail.turn === f.turn && tool(a.detail.tool) === "record_evidence" && a.detail.input?.subject_ref?.employee_id === f.emp && a.detail.input?.key === "approved_hours") : null;
    if (recAct) tr.push({ ts: hms(recAct.ts), label: `turn ${f!.turn}`, detail: `record_evidence approved_hours = ${f!.value}`, key: true });
    const evd = f ? r1.ev.find((e) => e.step === "browser.evidence" && e.detail?.key === "approved_hours" && e.detail?.subject_ref?.employee_id === f.emp) : null;
    if (evd) tr.push({ ts: hms(evd.ts), label: "evidence", detail: f!.source });
    const calc = r1.ev.find((e) => e.step === "calc.with_evidence");
    if (calc && r1.results?.hours_match_timecards) tr.push({ ts: hms(calc.ts), label: "calc", detail: `hours_match_timecards ${r1.results.hours_match_timecards}` });
    const rw = r1.ev.find((e) => e.step === "receipt.written");
    if (rw) tr.push({ ts: hms(rw.ts), label: "receipt", detail: String(rw.detail?.recommendation ?? "") });
  }
  const TRH = 34;
  const tT = 5.4;
  const traceHtml = `
    ${panel(RX, 214, RW, 50 + 12 + tr.length * TRH + 12, `<span>HSG-1011 trace</span><span class="n">agent/trace.jsonl</span>`, tT)}
    ${tr
      .map((r, i) =>
        row(
          RX + 20,
          214 + 50 + 10 + i * TRH,
          RW - 40,
          TRH,
          `<span class="m" style="display:inline-block;width:92px">${esc(r.ts)}</span><span style="display:inline-block;width:104px;color:rgb(150,145,140)">${esc(r.label)}</span><span class="${r.key ? "hl" : "t"}">${esc(clip(r.detail, 58))}</span>`,
          tT + 0.3 + i * 0.22,
          "mono",
          "font-size:14px;",
        ),
      )
      .join("")}`;
  let sy = 214 + 50 + 12 + tr.length * TRH + 12 + 20;
  const tS = tT + 0.5 + tr.length * 0.22;
  const stat = (label: string, value: string, i: number) =>
    row(RX + 20, sy + 58 + i * 32, RW - 40, 32, `<span class="soft" style="display:inline-block;width:200px">${esc(label)}</span><span class="t">${value}</span>`, tS + 0.3 + i * 0.15, "", "font-size:17px;");
  let summary = "";
  if (r1) {
    const reqTurn = f?.turn ?? null;
    const req = reqTurn != null ? r1.turnRequest(reqTurn) : null;
    const stats: [string, string][] = [];
    if (r1.turns != null) stats.push(["model turns", `${r1.turns}`]);
    stats.push(["tool calls", `${r1.actions.length}`]);
    stats.push(["facts", `${r1.facts}`]);
    if (r1.t.total != null) stats.push(["end to end", `${secs(r1.t.total)}${r1.t.browser != null ? `  <span class="muted">browser ${secs(r1.t.browser)}${r1.t.receipt != null ? `, receipt ${secs(r1.t.receipt)}` : ""}</span>` : ""}`]);
    if (r1.calls.length) stats.push(["Claude calls", `${r1.calls.length}, ${money(r1.cost)}`]);
    const h = 58 + stats.length * 32 + (req ? 40 : 0) + 16;
    summary = `
      ${panel(RX, sy, RW, h, `<span>HSG-1011, one review</span>`, tS)}
      ${stats.map(([l, v], i) => stat(l, v, i)).join("")}
      ${req ? row(RX + 20, sy + 58 + stats.length * 32 + 4, RW - 40, 32, `<span class="hl">${esc(req)}</span> <span class="m">turn ${reqTurn}</span>`, tS + 0.5 + stats.length * 0.15, "mono", "font-size:14.5px;") : ""}`;
    // Bar: browser vs receipt share of the run.
    if (r1.t.total && r1.t.browser) {
      const bw = 300, bx = RX + RW - 20 - bw, by = sy + 58 + 3 * 32 + 26;
      const b = Math.min(1, r1.t.browser / r1.t.total), rr = Math.min(1 - b, (r1.t.receipt ?? 0) / r1.t.total);
      summary += `<div class="o grow" style="${box(bx, by, bw * b, 4)}background:rgb(205,200,194);animation: growx .8s ${EASE} ${tS + 1.0}s forwards"></div>
        <div class="o grow" style="${box(bx + bw * (1 - rr), by, bw * rr, 4)}background:rgb(120,116,111);animation: growx .5s ${EASE} ${tS + 1.6}s forwards"></div>`;
    }
    sy += h + 16;
  }
  const takeLine = usage.length
    ? row(RX, sy, RW, 30, `Whole take: ${usage.length} Claude calls, ${money(usage.reduce((a, r) => a + usd(r), 0))} <span class="muted">(learning ${learnCalls.length}, ${[r1, r2].filter(Boolean).length} reviews)</span>`, tS + 1.6, "t", "font-size:17px;")
    : "";
  void decisions;
  return `${cards.join("")}${next}${traceHtml}${summary}${takeLine}`;
}

/* ================================================================== beat 12: close */

function closeBody(): string {
  const steps = ["One recording", "A tested workflow", "Agent brings back sourced evidence", "A person decides"];
  const widths = [300, 330, 520, 330];
  const gap = 70;
  const total = widths.reduce((a, b) => a + b, 0) + gap * 3;
  let x = (W - total) / 2;
  const y = 300;
  const parts: string[] = [];
  const arrows: string[] = [];
  steps.forEach((s, i) => {
    const t = 0.3 + i * 0.4;
    parts.push(`<div class="o node" style="${box(x, y, widths[i], 84)}justify-content:center;font-size:22px;${at(t, 0.45)}">${esc(s)}</div>`);
    if (i < 3) arrows.push(arrow([x + widths[i] + 10, y + 42], [x + widths[i] + gap - 10, y + 42], t + 0.3));
    x += widths[i] + gap;
  });
  // Full-color marks (gilbarbara/logos via @iconify-json/logos, CC0), as images so their gradient ids stay separate.
  const logo = (file: string) => `data:image/svg+xml;base64,${fs.readFileSync(path.join(LOGOS_DIR, file)).toString("base64")}`;
  const tile = (file: string, x0: number, t: number, label: string) => `
    <div class="o" style="${box(x0, 492, 180)}text-align:center;transform:translateY(16px);${at(t, 0.6)}">
      <div style="height:112px;display:flex;align-items:center;justify-content:center;animation: float 3s ease-in-out ${t + 0.6}s infinite">
        <img src="${logo(file)}" style="height:96px;width:auto;display:block"></div>
      <div class="muted" style="font-size:16px;margin-top:12px">${label}</div></div>`;
  return `
    ${parts.join("")}${svg(arrows.join(""))}
    ${tile("microsoftteams.svg", W / 2 - 200, 2.6, "Microsoft Teams")}
    ${tile("slack.svg", W / 2 + 20, 2.8, "Slack")}
    <div class="o" style="${box(W / 2 - 640, 720, 1280)}text-align:center;font-size:30px;line-height:42px;color:rgb(222,218,213);transform:translateY(8px);${at(3.3, 0.6)}"><span style="color:${LEMON}">Next:</span> confirm service delivery in an approved Teams or Slack channel and attach the message link to the receipt</div>`;
}

/* ================================================================== outro */

function outroBody(logos: Logos): string {
  const h = 92;
  return `<div style="left:0;top:${(H - h) / 2}px;width:${W}px;display:flex;justify-content:center">
    <div class="lock" style="height:${h}px;gap:34px">
      <svg viewBox="0 0 227 61" fill="#fff" style="height:${h}px;width:auto;clip-path: inset(0 100% 0 0);animation: wipe .8s ${EASE} .15s forwards"><path d="${logos.word}"/><path d="${logos.mark}"/></svg>
      <span class="o grow-y" style="width:2px;height:96px;background:rgb(80,77,74);animation: growy .45s ${EASE} .75s forwards"></span>
      <span class="o" style="font-size:96px;line-height:1;letter-spacing:-.02em;transform:translateX(-18px);${at(0.9, 0.6)}">Teach</span>
    </div></div>`;
}

/* ================================================================== the sections */

const rv = () => take().r1;
export const SECTIONS: Section[] = [
  {
    id: "intro",
    title: null,
    duration: 8,
    body: introBody,
    captions: [],
  },
  {
    id: "record",
    title: "Recording and Transcription",
    duration: 12.5,
    minimap: ["chrome"],
    body: recordBody,
    get captions(): DCaption[] {
      const speech = !!take().speech;
      return [
        {
          t0: 0.4,
          t1: 8.4,
          text: speech
            ? "The recorder saves each click with the exact element it hit, and every sentence I say with its timing, linked to the clicks around it."
            : "The recorder saves each click with the exact element it hit, and every sentence I say, on the same clock.",
        },
        { t0: 8.6, t1: 12.3, text: "The click shows where the evidence is; the sentence says the rule." },
      ];
    },
  },
  {
    id: "overview",
    title: "Architecture",
    duration: 6.5,
    body: overviewBody,
    captions: [{ t0: 0.4, t1: 6.3, text: "What I recorded becomes a workflow. When a new invoice arrives, an agent runs it in its own browser and brings back evidence." }],
  },
  {
    id: "learning",
    title: "Agent Learning",
    duration: 12,
    minimap: ["app", "anthropic"],
    body: learningBody,
    get captions(): DCaption[] {
      const cited = !!learningData().cite;
      return [
        {
          t0: 0.4,
          t1: 7.2,
          text: cited
            ? "Claude reads the recording and writes the workflow: each rule with the words and click it came from, and where the proof lives."
            : "Claude reads the recording and writes the workflow: the rules, and where the proof lives.",
        },
        { t0: 7.4, t1: 11.8, text: "The checks are code we wrote; what it learned is what to check and where." },
      ];
    },
  },
  {
    id: "execution",
    title: "Agent execution and evaluation",
    duration: 13.5,
    minimap: ["sandbox", "anthropic"],
    body: execBody,
    captions: [
      { t0: 0.4, t1: 6.8, text: "The agent works in its own browser. Each turn, Claude sees the page as an outline, picks an action and gets the result." },
      { t0: 7.0, t1: 13.3, text: "It records facts with the page they came from. Code turns them into pass or fail, Claude writes the receipt, and I decide." },
    ],
  },
  {
    id: "evaluation",
    title: "Agent execution and evaluation",
    duration: 12.5,
    minimap: ["chrome", "app", "sandbox", "anthropic"],
    body: evalBody,
    get captions(): DCaption[] {
      const r = rv();
      const n = r?.calls.length ?? 0;
      const second =
        r && n && r.t.total != null
          ? `One review was ${n} Claude calls, ${Math.round(r.t.total / 1000)} seconds and ${money(r.cost)}, and each call has a request ID we can look up.`
          : "Every step is logged, and each Claude call has a request ID we can look up.";
      return [
        { t0: 0.4, t1: 6.2, text: "We test the checks against past corrections, the learning against recordings with known answers, and the whole review end to end." },
        { t0: 6.4, t1: 12.3, text: second },
      ];
    },
  },
  {
    id: "close",
    title: null,
    duration: 7,
    body: closeBody,
    captions: [
      { t0: 0.4, t1: 3.4, text: "Today, one recording becomes a tested workflow with evidence behind every recommendation." },
      { t0: 3.6, t1: 6.8, text: "Next, it could pull a delivery confirmation from Teams or Slack and attach it to the receipt." },
    ],
  },
  { id: "outro", title: null, duration: 3.5, body: outroBody, captions: [] },
];
/** Kept for older callers. */
export const DIAGRAMS = SECTIONS;
export const sectionById = (id: string) => {
  const s = SECTIONS.find((x) => x.id === id);
  if (!s) throw new Error(`no section ${id}`);
  return s;
};

/* ------------------------------------------------------------------ render */

/** Visible text of a page (no styles, scripts, SVG paths or data URIs). */
export function visibleText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/data:[^"')]+/g, "")
    .replace(/\sd="[^"]*"/g, "")
    .replace(/<[^>]+>/g, " ");
}
/** Words and signs the owner ruled out of every frame. */
export const BANNED = /simulat|—|·|≈/i;

export async function renderSection(d: Section, outMp4: string, workDir: string, logos: Logos, opts: { stills?: number[] } = {}) {
  const dir = path.join(workDir, `frames-${d.id}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const html = sectionHtml(d, logos);
  const vis = visibleText(html);
  const bad = BANNED.exec(vis);
  if (bad) throw new Error(`section ${d.id} has banned text near: ${vis.slice(Math.max(0, bad.index - 40), bad.index + 40)}`);
  fs.writeFileSync(path.join(workDir, `sec-${d.id}.html`), html);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  await page.evaluate(() => document.getAnimations().forEach((a) => a.pause()));
  const seek = (t: number) => page.evaluate((ms) => document.getAnimations().forEach((a) => (a.currentTime = ms)), t * 1000);
  if (opts.stills) {
    for (const t of opts.stills) {
      await seek(t);
      await page.screenshot({ path: path.join(workDir, `still-${d.id}-${t}.png`) });
    }
    await browser.close();
    return;
  }
  const frames = Math.round(d.duration * FPS);
  for (let i = 0; i < frames; i++) {
    await seek(i / FPS);
    await page.screenshot({ path: path.join(dir, `f${String(i).padStart(4, "0")}.png`) });
  }
  await browser.close();
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", path.join(dir, "f%04d.png"), "-c:v", "libx264", "-preset", "medium", "-crf", "14", "-pix_fmt", "yuv420p", outMp4]);
  fs.rmSync(dir, { recursive: true, force: true });
}
/** Kept for older callers. */
export const renderDiagram = renderSection;
