/**
 * Technical diagrams for the product film (dark, Ramp-themed): the three pillars and observability.
 *
 *   01 voice      the word-timed transcript and its links to the recorded clicks (the take's own recording)
 *   02 skill      the six learning stages, a rule with its citations, the skill package, the evals and the gate
 *   03 execution  routing, the workflow agent's page outline with refs, its tool calls, the evidence re-check
 *   04 trace      the take's own logs: trace lines, the route decision, spans, Claude calls and request ids
 *
 * Data comes from the take's archive (setRunDir: demo/video/film-run for a real take, work-film/rehearsal-run for a
 * rehearsal), read at render time, so the diagrams match the take shown. The portal screenshot, its element boxes
 * and the page outline come from an earlier live take (demo/video/diagram-assets/). Nothing is invented: when a
 * piece of data is missing the diagram shows the structure without it (eval scores only for a real eval run).
 *
 * Rendered frame by frame (CSS animations paused and seeked through the Web Animations API) and encoded to MP4.
 * Motion is kept small: fade-and-rise, rows appearing in order, a few connector lines drawing in.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { GATE, type Recording, type Utterance } from "@/contracts";
import { simulatedTranscript } from "@/lib/speech/simulated";
import { fontFaceCss } from "./fonts";

const W = 1920;
const H = 1080;
const FPS = 30;
const EASE = "cubic-bezier(.2,.8,.2,1)";
const ROOT = process.cwd(); // run from the repo root
const ASSETS = path.join(ROOT, "demo", "video", "diagram-assets");
const LEMON = "rgb(228,242,34)";
const RED = "rgb(255,122,107)";

let RUN_DIR = path.join(ROOT, "demo", "video", "film-run");
/** Where the take's archive is (film.ts sets it: film-run for a real take, the rehearsal archive otherwise). */
export const setRunDir = (d: string) => (RUN_DIR = d);
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
export interface Diagram {
  id: string;
  kicker: string;
  title: string;
  duration: number;
  captions: DCaption[];
  body: (logos: Logos) => string;
}

/* ------------------------------------------------------------------ helpers */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = any;
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const at = (t: number, dur = 0.5) => `animation: in ${dur}s ${EASE} ${t}s forwards;`;
const box = (x: number, y: number, w: number, h?: number) =>
  `left:${x}px;top:${y}px;width:${w}px;${h != null ? `height:${h}px;` : ""}`;
const readMaybe = <T = J>(f: string): T | null => {
  try {
    return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, "utf8")) as T) : null;
  } catch {
    return null;
  }
};
const jsonl = (f: string): J[] =>
  fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const kfmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const clock = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
const urlPath = (u: string) => {
  try {
    const x = new URL(u);
    return x.pathname + x.search;
  } catch {
    return u;
  }
};
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

// Simple Icons "claude" (CC0), drawn in Claude's terracotta.
const CLAUDE_PATH =
  "m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z";
const claudeMark = (size = 22) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}"><path fill="#D97757" d="${CLAUDE_PATH}"/></svg>`;

const dataCache = new Map<string, string>();
function dataUri(file: string): string {
  if (!dataCache.has(file)) dataCache.set(file, `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`);
  return dataCache.get(file)!;
}
const extIcon = (size = 22) =>
  `<img src="${dataUri(path.join(ROOT, "extension", "icons", "icon128.png"))}" width="${size}" height="${size}" style="border-radius:5px;display:block">`;

function panel(x: number, y: number, w: number, h: number, head: string, t: number) {
  return `<div class="panel" style="${box(x, y, w, h)}${at(t, 0.6)}"><div class="ph">${head}</div></div>`;
}

/**
 * A cropped screenshot (CSS-pixel crop of a 1100x720 capture) inside a browser-like frame.
 * Returns html plus a mapper from capture coordinates to absolute page coordinates.
 */
function shot(file: string, url: string, x: number, y: number, w: number, crop: { x: number; y: number; w: number; h: number }, t: number) {
  const s = w / crop.w;
  const h = Math.round(crop.h * s);
  const top = y + 48;
  const html = `<div class="frame" style="${box(x, y, w, h + 48)}${at(t, 0.6)}">
      <div class="fbar"><span class="url">${esc(url)}</span></div>
      <div class="fimg" style="height:${h}px"><img src="${dataUri(path.join(ASSETS, file))}" style="width:${1100 * s}px;left:${-crop.x * s}px;top:${-crop.y * s}px"></div>
    </div>`;
  const map = (b: { x: number; y: number; w: number; h: number }) => ({
    x: x + (b.x - crop.x) * s,
    y: top + (b.y - crop.y) * s,
    w: b.w * s,
    h: b.h * s,
  });
  return { html, map, bottom: top + h };
}

/** Connector: a smooth horizontal S-curve that draws in, with small end dots. */
function wire(a: [number, number], b: [number, number], t: number, color = "rgb(96,93,89)") {
  const dx = (b[0] - a[0]) * 0.5;
  const d = `M${a[0]},${a[1]} C${a[0] + dx},${a[1]} ${b[0] - dx},${b[1]} ${b[0]},${b[1]}`;
  return `<path d="${d}" pathLength="1" class="wire" stroke="${color}" style="animation: draw .6s ${EASE} ${t}s forwards"/>
    <circle cx="${a[0]}" cy="${a[1]}" r="3.5" fill="${color}" class="o" style="${at(t, 0.2)}"/>
    <circle cx="${b[0]}" cy="${b[1]}" r="3.5" fill="${color}" class="o" style="${at(t + 0.5, 0.2)}"/>`;
}

const rule = (x: number, y: number, w: number, t: number) => `<div class="r" style="${box(x, y, w, 1)}background: rgb(40,38,36);${at(t)}"></div>`;
/** One text row that fades and rises in at t. */
const row = (x: number, y: number, w: number, h: number, html: string, t: number, cls = "", style = "") =>
  `<div class="r ${cls}" style="${box(x, y, w)}height:${h}px;line-height:${h}px;${style}${at(t, 0.4)}">${html}</div>`;

/* ------------------------------------------------------------------ page */
export function diagramHtml(d: Diagram, logos: Logos): string {
  const caps = d.captions
    .map((c) => `<div class="cap" style="animation: capin .3s ease ${c.t0}s forwards, capout .3s ease ${Math.max(c.t0 + 0.3, c.t1 - 0.3)}s forwards">${esc(c.text)}</div>`)
    .join("");
  const plus = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><path d="M48 43v10M43 48h10" stroke="rgba(255,255,255,0.075)" stroke-width="1.2"/></svg>`,
  );
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    ${fontFaceCss()}
    html,body { margin:0; width:${W}px; height:${H}px; overflow:hidden; background:#121211; font-family: Lausanne, Inter, sans-serif; color:#fff; -webkit-font-smoothing: antialiased; }
    body { background-image: url("data:image/svg+xml,${plus}"); background-position: -48px -48px; }
    body > * { position:absolute; }
    .o, .panel, .frame, .r, .kick, .title, .cap { opacity:0; }
    .kick { left:96px; top:74px; font: 500 15px "JetBrains Mono", monospace; letter-spacing:.14em; color:${LEMON}; text-transform:uppercase; ${at(0.05)} }
    .title { left:96px; top:102px; font-size:46px; font-weight:400; letter-spacing:-.015em; transform: translateY(8px); ${at(0.1, 0.6)} }
    .panel, .frame { background:#1a1918; border:1px solid rgb(46,44,42); border-radius:14px; overflow:hidden; transform: translateY(10px); box-sizing:border-box; }
    .ph { height:54px; display:flex; align-items:center; gap:12px; padding:0 22px; font-size:19px; color: rgb(222,218,213); border-bottom:1px solid rgb(40,38,36); }
    .ph .n { margin-left:auto; font: 400 14px "JetBrains Mono", monospace; color: rgb(140,135,130); }
    .fbar { height:48px; display:flex; align-items:center; padding:0 14px; border-bottom:1px solid rgb(40,38,36); box-sizing:border-box; }
    .url { font: 400 14px "JetBrains Mono", monospace; color: rgb(160,155,150); background: rgb(36,35,33); border-radius:8px; padding:6px 12px; }
    .fimg { position:relative; overflow:hidden; background:#fff; }
    .fimg img { position:absolute; }
    .r { transform: translateY(6px); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .r.wrap { white-space:normal; overflow:visible; }
    .mono { font: 400 16px/1 "JetBrains Mono", monospace; color: rgb(205,200,194); }
    .t { color:#fff; }
    .m { color: rgb(128,123,118); }
    .q { color: rgb(196,190,183); font-style: italic; }
    .hl { color:${LEMON}; }
    .muted { color: rgb(140,135,130); }
    .bad { color: ${RED}; }
    .ok { color: rgb(150,146,141); }
    .hlbox { border:2px solid ${LEMON}; border-radius:5px; box-sizing:border-box; }
    .tag { font: 500 13px/1 "JetBrains Mono", monospace; color:#121211; background:${LEMON}; border-radius:4px; padding:4px 6px; }
    svg.wires { left:0; top:0; overflow:visible; }
    .wire { fill:none; stroke-width:1.6; stroke-dasharray:1; stroke-dashoffset:1; }
    .grow { transform-origin:left center; transform: scaleX(0); }
    .cap { left:50%; bottom:46px; transform:translateX(-50%); max-width:1400px; width:max-content; background:rgba(18,18,18,.84);
      border:1px solid rgba(255,255,255,.06); color:#fff; font: 500 30px/1.35 Inter, system-ui, sans-serif; text-align:center; padding:14px 28px; border-radius:14px; }
    @keyframes in { to { opacity:1; transform:none; } }
    @keyframes capin { to { opacity:1; } }
    @keyframes capout { from { opacity:1; } to { opacity:0; } }
    @keyframes draw { to { stroke-dashoffset:0; } }
    @keyframes growx { to { opacity:1; transform: scaleX(1); } }
  </style></head><body>
    <div class="kick">${esc(d.kicker)}</div>
    <div class="title">${esc(d.title)}</div>
    ${d.body(logos)}
    ${caps}
  </body></html>`;
}

/* ============================================================== 01 · voice */

interface Step {
  ts: string;
  kind: string;
  detail: { event?: string; url?: string; selector?: string; text?: string; value?: string };
}
type Rec = Recording & { steps: Step[] };

/** The recording Send to Ramp uploaded in the take (its word-timed transcript; else its narration aligned in code). */
function voiceData() {
  const rec = readMaybe<Rec>(runFile("sent-recording.json")) ?? readMaybe<Rec>(runFile("film-recording.json")) ?? readMaybe<Rec>(path.join(ASSETS, "source-recording.json"))!;
  const utts: Utterance[] = rec.speech?.utterances?.length ? rec.speech.utterances : simulatedTranscript(rec).utterances;
  const t0 = Date.parse(rec.started_at);
  const stepAt = (s: Step) => (Date.parse(s.ts) - t0) / 1000;
  const isHit = (s: Step | undefined) => !!s && /approved_hours/.test(s.detail.selector ?? "");
  const focal =
    utts.find((u) => /\b40\b/.test(u.text) && u.step_refs.some((i) => isHit(rec.steps[i]))) ??
    [...utts].sort((a, b) => b.step_refs.length - a.step_refs.length)[0];
  return { rec, utts, focal, stepAt };
}

function stepText(s: Step): { kind: string; html: string } {
  const d = s.detail;
  const ev = d.event ?? s.kind;
  if (ev === "navigate") return { kind: "page", html: `<span class="t">${esc(urlPath(d.url ?? ""))}</span>` };
  const target = esc(clip(d.selector ?? "", 44));
  if (ev === "input") return { kind: "type", html: `${target}  ${d.value === "[redacted]" ? `<span class="m">[redacted]</span>` : `<span class="t">"${esc(d.value)}"</span>`}` };
  return { kind: ev, html: `${target}${d.text ? `  <span class="t">"${esc(clip(d.text, 16))}"</span>` : ""}` };
}

function voiceBody(): string {
  const { rec, utts, focal, stepAt } = voiceData();
  const words = utts.reduce((n, u) => n + u.words.length, 0);

  // left: the transcript, one sentence per row; the focal one shows each word with its start time
  const LX = 96, LY = 214, LW = 1010;
  const RH = 44, R0 = LY + 54 + 12, T0 = 0.8, ST = 0.26, WORD_H = 64;
  let y = R0;
  const parts: string[] = [];
  let focalX = LX + LW + 2;
  let focalY = 0;
  let tFocal = 0;
  utts.forEach((u, i) => {
    const t = T0 + i * ST;
    const isF = u === focal;
    parts.push(
      row(LX + 24, y, LW - 48, RH, `<span class="mono m" style="display:inline-block;width:92px;font-size:14.5px">${clock(u.start)}</span><span style="font-size:19px;color:${isF ? "#fff" : "rgb(165,160,155)"}">${esc(u.text)}</span>`, t),
    );
    if (!isF) {
      y += RH;
      return;
    }
    tFocal = t;
    y += RH;
    let x = LX + 24 + 92;
    u.words.forEach((w, j) => {
      const wpx = Math.max(50, w.text.length * 10 + 16);
      const key = /^40\b/.test(w.text);
      parts.push(`<div class="r" style="${box(x, y + 2, wpx)}height:${WORD_H - 12}px;${at(tFocal + 0.5 + j * 0.07, 0.35)}">
          <div class="mono" style="font-size:16px;color:${key ? LEMON : "#fff"}">${esc(w.text)}</div>
          <div class="mono m" style="font-size:12.5px;margin-top:9px">${w.start.toFixed(2)}</div></div>`);
      x += wpx + 6;
    });
    // the link to the steps starts where the sentence's words end
    focalX = x + 8;
    focalY = y + 14;
    y += WORD_H;
  });
  const LH = y + 12 - LY;

  // right: the recorded steps around the focal sentence, its linked steps highlighted
  const RX = 1146, RY = 214, RW = 678;
  const dom = rec.steps.map((s, i) => ({ s, i })).filter((x) => x.s.kind === "dom");
  const refs = new Set(focal.step_refs);
  const firstRef = dom.findIndex((x) => refs.has(x.i));
  const from = Math.max(0, Math.min(dom.length - 9, (firstRef < 0 ? 0 : firstRef) - 4));
  const shown = dom.slice(from, from + 9);
  const SRH = 40, S0 = RY + 54 + 12, tS = 2.0;
  const stepRows = shown
    .map(({ s, i }, k) => {
      const { kind, html } = stepText(s);
      return row(RX + 22, S0 + k * SRH, RW - 44, SRH, `<span class="m" style="display:inline-block;width:62px;font-size:13px">${clock(stepAt(s))}</span><span class="m" style="display:inline-block;width:72px">${esc(kind)}</span><span class="${refs.has(i) ? "hl" : ""}">${html}</span>`, tS + k * 0.16, "mono", "font-size:14.5px;");
    })
    .join("");
  const RHh = 54 + 12 + shown.length * SRH + 12;
  const tWire = Math.max(tFocal + 1.3, tS + shown.length * 0.16 + 0.2);
  const wires = shown.map(({ i }, k) => (refs.has(i) ? wire([focalX, focalY], [RX - 2, S0 + k * SRH + SRH / 2], tWire, LEMON) : "")).join("");

  // bottom: words and clicks on one time axis
  const AX = 96, AW = 1728, AY = Math.max(LY + LH, RY + RHh) + 58;
  const dur = Math.max(1, ...utts.map((u) => u.end), ...rec.steps.map(stepAt));
  const px = (s: number) => AX + (s / dur) * AW;
  const tAx = tWire + 0.7;
  const appear = (s: number) => at(tAx + 0.3 + (s / dur) * 1.2, 0.2);
  const ticks = utts
    .flatMap((u) => u.words.map((w) => `<div class="o" style="${box(px(w.start), AY - 22, 1.5, 18)}background:${u === focal ? LEMON : "rgb(125,121,116)"};${appear(w.start)}"></div>`))
    .join("");
  const dots = rec.steps
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.kind === "dom" && (s.detail.event === "click" || s.detail.event === "navigate"))
    .map(({ s, i }) => `<div class="o" style="${box(px(stepAt(s)) - 4, AY + 8, 8, 8)}border-radius:50%;background:${refs.has(i) ? LEMON : "rgb(205,200,194)"};${appear(stepAt(s))}"></div>`)
    .join("");
  return `
    ${panel(LX, LY, LW, LH, `${extIcon(24)}<span>Transcript</span><span class="n">${words} words · word times in seconds</span>`, 0.4)}
    ${parts.join("")}
    ${panel(RX, RY, RW, RHh, `<span>Recorded steps</span><span class="n">${dom.length} steps</span>`, 1.7)}
    ${stepRows}
    <svg class="wires" width="${W}" height="${H}">${wires}</svg>
    <div class="o grow" style="${box(AX, AY, AW, 1)}background: rgb(70,67,64);animation: growx 1.4s ${EASE} ${tAx}s forwards"></div>
    ${ticks}${dots}
    <div class="r mono m" style="${box(AX, AY + 28, 300)}font-size:13px;${at(tAx + 1.4)}">0:00</div>
    <div class="r mono m" style="${box(AX + AW - 300, AY + 28, 300)}font-size:13px;text-align:right;${at(tAx + 1.4)}">${clock(dur)}</div>
    <div class="r mono m" style="${box(AX + 564, AY + 28, 600)}font-size:13px;text-align:center;${at(tAx + 1.5)}">| words      ● clicks and pages</div>`;
}

/* ============================================================== 02 · skill */

const STAGES: [string, string, string][] = [
  ["segment", "Segment", "Split the recording by page, with what was said there"],
  ["claims", "Claims", "Pull out each claim, citing the words and the clicks"],
  ["synthesize", "Synthesize", "Write the rules and the portal pages they need"],
  ["critique", "Critique", "Drop rules nothing supports, add what is missing"],
  ["checks", "Checks", "Check scripts run in a sandbox, compared with plain code"],
  ["package", "Package", "SKILL.md, skill.json and the checks, as a new version"],
];
/** What each eval recording changes (docs/TECHNICAL.md, skill evals). */
const CASE_NOTE: Record<string, string> = {
  baseline: "the narration word for word",
  paraphrase: "casual wording",
  reordered: "decision rule first",
  "shown-not-said": "hours limit only clicked",
  "said-not-shown": "timecards never opened",
  filler: "small talk mixed in",
  "step-skipped": "a check never mentioned",
  "stt-noise": "speech-to-text errors",
};
const GRADERS = ["rule recall", "rule precision", "citations", "coverage", "replay", "consistency", "voice accuracy"];
const GATE_LABEL: Record<keyof typeof GATE, string> = {
  rule_recall: "Rule recall",
  rule_precision: "Rule precision",
  citations_valid: "Citations valid",
  coverage: "Coverage",
  replay_agreement: "Replay on past invoices",
};

function skillData() {
  const skill = readMaybe(runFile("skill/skill.json"));
  const evalRun = readMaybe(runFile("eval-run.json"));
  const casesDir = path.join(ROOT, "evals", "cases");
  const cases: { id: string; variant: string }[] = fs.existsSync(casesDir)
    ? fs
        .readdirSync(casesDir)
        .filter((f) => f.endsWith(".json"))
        .sort()
        .map((f) => readMaybe(path.join(casesDir, f)))
        .filter(Boolean)
        .map((c: J) => ({ id: c.id, variant: c.variant }))
    : [];
  const pkg = runFile("skill");
  const files = {
    checks: fs.existsSync(path.join(pkg, "checks")) ? fs.readdirSync(path.join(pkg, "checks")).filter((f) => f.endsWith(".py")).length : 0,
    stages: fs.existsSync(path.join(pkg, "stages")) ? fs.readdirSync(path.join(pkg, "stages")).length : 0,
  };
  // Scores only from a real eval run of this very version.
  const scored = evalRun && skill && evalRun.mode === "real" && evalRun.version === skill.version ? evalRun : null;
  return { skill, cases, files, scored };
}

function skillBody(): string {
  const { skill, cases, files, scored } = skillData();

  // left: the six stages, then the package
  const LX = 96, LY = 214, LW = 520;
  const SRH = 64, S0 = LY + 54 + 6, tS = 0.7, SST = 0.3;
  const stageRows = STAGES.map(([key, name, what], i) => {
    const st = skill?.stages?.find((s: J) => s.name === key);
    const ms = st ? Date.parse(st.finished_at) - Date.parse(st.started_at) : null;
    const time = ms == null ? "" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
    return `<div class="r" style="${box(LX + 22, S0 + i * SRH, LW - 44)}height:${SRH}px;${i ? "border-top:1px solid rgb(38,36,34);" : ""}${at(tS + i * SST, 0.4)}">
        <div style="display:flex;align-items:center;gap:10px;margin-top:11px;font-size:19px"><span class="mono m" style="font-size:13px;width:22px">${i + 1}</span>${name}${st?.mode === "real" ? claudeMark(16) : ""}<span class="mono m" style="margin-left:auto;font-size:13px">${time}</span></div>
        <div class="muted" style="font-size:14.5px;margin:7px 0 0 32px">${what}</div></div>`;
  }).join("");
  const LH = 54 + 6 + STAGES.length * SRH + 6;
  const PY = LY + LH + 22;
  const tP = tS + STAGES.length * SST + 0.2;
  const v = skill?.version ?? 1;
  const tree: string[] = [
    `<span class="t">skills/${esc(skill?.skill_id ?? "halcyon-invoice-review")}/v${v}/</span>`,
    `&nbsp;&nbsp;SKILL.md`,
    `&nbsp;&nbsp;skill.json  <span class="m">${skill ? `${skill.rules.length} rules · ${skill.portal_map.length} pages` : ""}</span>`,
    `&nbsp;&nbsp;checks/  <span class="m">${files.checks ? `${files.checks} scripts` : "none in this version"}</span>`,
    `&nbsp;&nbsp;stages/  <span class="m">${files.stages ? `${files.stages} stage outputs` : ""}</span>`,
  ];
  const treeHtml = tree.map((l, i) => row(LX + 22, PY + 54 + 8 + i * 30, LW - 44, 30, l, tP + 0.2 + i * 0.12, "mono", "font-size:14.5px;")).join("");
  const PH = 54 + 8 + tree.length * 30 + 12;

  // middle: one rule and where it came from, then the other rules
  const MX = 656, MY = 214, MW = 580;
  const rules: J[] = skill?.rules ?? [];
  const focus = rules.find((r) => /hour/i.test(r.text) && r.citations?.some((c: J) => c.quote && c.selector)) ?? rules.find((r) => r.citations?.length) ?? rules[0];
  const cite = focus?.citations?.find((c: J) => c.quote) ?? null;
  const click = focus?.citations?.find((c: J) => c.selector) ?? null;
  const tM = 3.2;
  let my = MY + 54 + 20;
  const mid: string[] = [];
  if (focus) {
    const lines = Math.ceil(focus.text.length / 44);
    mid.push(`<div class="r wrap" style="${box(MX + 24, my, MW - 48)}font-size:21px;line-height:30px;${at(tM + 0.2)}">${esc(focus.text)}</div>`);
    my += lines * 30 + 8;
    mid.push(row(MX + 24, my, MW - 48, 26, `<span class="m">${esc(focus.kind)} · ${focus.source === "both" ? "said and shown" : esc(focus.source)}</span>`, tM + 0.4, "mono", "font-size:14px;"));
    my += 42;
    if (cite) {
      const ql = Math.ceil(cite.quote.length / 46);
      mid.push(`<div class="r wrap" style="${box(MX + 24, my, MW - 48)}border-left:2px solid ${LEMON};padding-left:16px;box-sizing:border-box;${at(tM + 0.9)}"><div class="q" style="font-size:19px;line-height:27px">“${esc(cite.quote)}”</div><div class="mono m" style="font-size:13px;margin-top:10px">said${cite.utterance_id ? ` · ${esc(cite.utterance_id)}` : ""}</div></div>`);
      my += ql * 27 + 50;
    }
    if (click) {
      mid.push(`<div class="r wrap" style="${box(MX + 24, my, MW - 48)}border-left:2px solid rgb(80,77,74);padding-left:16px;box-sizing:border-box;${at(tM + 1.5)}"><div class="mono" style="font-size:15px"><span class="m">click</span>  <span class="t">${esc(click.selector)}</span></div><div class="mono m" style="font-size:13px;margin-top:10px">${esc(clip(urlPath(click.url ?? ""), 50))}${click.step_index != null ? ` · step ${click.step_index}` : ""}</div></div>`);
      my += 74;
    }
  }
  const others = rules.filter((r) => r !== focus).slice(0, 6);
  my += 6;
  mid.push(rule(MX, my, MW, tM + 2.0));
  my += 14;
  mid.push(row(MX + 24, my, MW - 48, 28, `<span class="muted" style="font-size:15px">${rules.length ? `${rules.length - 1} more rules, each with its citations` : "The rules appear here after a take"}</span>`, tM + 2.1));
  my += 34;
  others.forEach((r, i) => {
    mid.push(row(MX + 24, my, MW - 48, 30, `<span class="mono m" style="font-size:13px;display:inline-block;width:34px">${esc(r.id)}</span><span style="font-size:15.5px;color:rgb(200,195,190)">${esc(r.text)}</span>`, tM + 2.3 + i * 0.15));
    my += 30;
  });
  const MH = my + 14 - MY;
  const realRules = skill?.mode === "real";

  // right: the evals and the gate
  const RX = 1276, RY = 214, RW = 548;
  const tE = 9.6;
  const CRH = 31, C0 = RY + 54 + 10;
  const caseRows = cases
    .map((c, i) => row(RX + 22, C0 + i * CRH, RW - 44, CRH, `<span class="t" style="display:inline-block;width:178px">${esc(c.id)}</span><span class="m">${esc(CASE_NOTE[c.id] ?? c.variant)}</span>`, tE + 0.2 + i * 0.1, "mono", "font-size:14px;"))
    .join("");
  let ry = C0 + cases.length * CRH + 12;
  const gradersHtml = `<div class="r wrap muted" style="${box(RX + 22, ry, RW - 44)}font-size:14.5px;line-height:1.5;${at(tE + 1.1)}"><span style="color:rgb(222,218,213)">Graders</span>&nbsp;&nbsp;${GRADERS.join(" · ")}</div>`;
  ry += 62;
  const gateHead = rule(RX, ry, RW, tE + 1.4) + row(RX + 22, ry + 12, RW - 44, 30, `<span style="font-size:17px;color:rgb(222,218,213)">Promotion gate</span>`, tE + 1.5);
  ry += 50;
  const keys = Object.keys(GATE) as (keyof typeof GATE)[];
  const gateRows = keys
    .map((k, i) => {
      const need = GATE[k] >= 1 ? "100%" : `at least ${Math.round(GATE[k] * 100)}%`;
      const got: number | null = scored ? scored.summary[k] : null;
      const ok = got == null ? null : got >= GATE[k];
      return row(
        RX + 22,
        ry + i * 32,
        RW - 44,
        32,
        `<span style="font-size:15.5px;color:rgb(222,218,213)">${GATE_LABEL[k]}</span><span class="mono" style="position:absolute;right:0;top:0;font-size:14px;line-height:32px"><span class="m">${need}</span>${got != null ? `<span class="${ok ? "t" : "bad"}" style="display:inline-block;width:70px;text-align:right">${Math.round(got * 100)}%</span>` : ""}</span>`,
        tE + 1.7 + i * 0.15,
      );
    })
    .join("");
  ry += keys.length * 32 + 14;
  const verdict = scored
    ? scored.gate.passed
      ? `<span class="hl">Passed</span><span class="muted">, v${scored.version} is the active version</span>`
      : `<span class="bad">Blocked</span><span class="muted">, v${scored.version} stays off</span>`
    : `<span class="muted">A version goes live only when all five hold.</span>`;
  const verdictHtml = row(RX + 22, ry, RW - 44, 30, `<span style="font-size:16px">${verdict}</span>`, tE + 2.6);
  const RHh = ry + 44 - RY;

  return `
    ${panel(LX, LY, LW, LH, `<span>Learning</span><span class="n">six stages</span>`, 0.4)}
    ${stageRows}
    ${panel(LX, PY, LW, PH, `<span>Skill package</span><span class="n">${skill ? `v${v}` : ""}</span>`, tP)}
    ${treeHtml}
    ${panel(MX, MY, MW, MH, `${realRules ? claudeMark(22) : ""}<span>A rule and where it came from</span>`, tM)}
    ${mid.join("")}
    ${panel(RX, RY, RW, RHh, `<span>Evals</span><span class="n">${cases.length} recordings</span>`, tE)}
    ${caseRows}${gradersHtml}${gateHead}${gateRows}${verdictHtml}`;
}

/* ============================================================== 03 · execution */

const BOXES = () => JSON.parse(fs.readFileSync(path.join(ASSETS, "boxes.json"), "utf8"));

/** Tool calls the agent made in the take (a real run), else the snapshot of an earlier live take. */
function agentActions(trace: J[]): { rows: [string, string, string][]; summary: string } {
  const acts = trace.filter((e) => e.step === "browser.action" && e.mode === "real" && !/wait$/.test(e.detail?.tool ?? ""));
  if (acts.length >= 6) {
    const rows = acts.slice(0, 9).map((e): [string, string, string] => {
      const i = e.detail.input ?? {};
      const tool = String(e.detail.tool).replace(/^browser\./, "");
      let arg = "";
      if (i.url) arg = `<span class="m">${esc(clip(urlPath(i.url), 32))}</span>`;
      else if (i.target?.ref) arg = `<span class="hl">${esc(i.target.ref)}</span>`;
      else if (i.query) arg = `<span class="m">"${esc(clip(i.query, 28))}"</span>`;
      else if (i.key) arg = `<span class="t">${esc(i.key)} = ${esc(i.value)}</span>`;
      else if (i.filter) arg = `<span class="m">${esc(i.filter)}</span>`;
      return [String(e.detail.turn ?? ""), tool, arg];
    });
    const done = trace.find((e) => e.step === "browser.done");
    rows.push(["…", "", `<span class="m">${acts.length - rows.length} more actions</span>`]);
    return { rows, summary: done ? `${done.detail.turns} turns · ${acts.length} actions · ${done.detail.facts} facts` : `${acts.length} actions` };
  }
  return {
    rows: [
      ["1", "read_page", `<span class="m">interactive</span>`],
      ["2", "form_input", `<span class="hl">ref_2</span> <span class="m">username</span>`],
      ["2", "form_input", `<span class="hl">ref_3</span> <span class="m">password</span>`],
      ["2", "left_click", `<span class="hl">ref_4</span>`],
      ["2", "navigate", `<span class="m">/portal/invoices/HSG-1011</span>`],
      ["2", "find", `<span class="m">"View timecard links"</span>`],
      ["3", "navigate", `<span class="m">/portal/employees/E-101?week=…</span>`],
      ["3", "get_page_text", ""],
      ["4", "record_evidence", `<span class="t">approved_hours = 40</span>`],
      ["…", "", `<span class="m">then E-102, E-103 and E-104</span>`],
    ],
    summary: "8 turns · 30 actions · 12 facts",
  };
}

function execBody(): string {
  const b = BOXES();
  const route = readMaybe(runFile("route-HSG-1011.json"));
  const skill = readMaybe(runFile("skill/skill.json"));
  const check = readMaybe(runFile("evidence-check-HSG-1011.json"));
  const trace = jsonl(runFile("trace.jsonl")).filter((e) => String(e.run_id).includes("HSG-1011"));

  // left: routing, then the page with the refs the agent can use
  const LX = 96, LY = 214, LW = 520;
  const tR = 0.5;
  const wfTitle = route?.workflow_id ? (skill?.skill_id === route.workflow_id ? skill.title : route.workflow_id) : null;
  const rr: string[] = [];
  let ry = LY + 54 + 14;
  rr.push(row(LX + 22, ry, LW - 44, 30, `<span class="m">invoice</span>  <span class="t">HSG-1011</span>  <span class="m">Halcyon Staffing</span>`, tR + 0.3, "mono", "font-size:14.5px;"));
  ry += 34;
  for (const c of (route?.candidates ?? []).slice(0, 2)) {
    rr.push(row(LX + 22, ry, LW - 44, 30, `<span class="m">fit</span>  ${esc(clip(c.workflow_id, 28))}  <span class="t">${Math.round(c.score * 100)}%</span>`, tR + 0.6, "mono", "font-size:14.5px;"));
    ry += 32;
  }
  const chosen = route
    ? wfTitle
      ? `<span class="t" style="font-size:18px">${esc(wfTitle)}${route.version ? ` v${route.version}` : ""}</span><span class="muted" style="font-size:15px">  starts its agent</span>`
      : `<span class="muted" style="font-size:16px">No workflow fits: manual review</span>`
    : `<span class="muted" style="font-size:16px">Picks the workflow for the vendor and the invoice</span>`;
  rr.push(row(LX + 22, ry + 4, LW - 44, 34, chosen, tR + 1.0));
  ry += 46;
  const RTH = ry + 4 - LY;
  const routeHead = `${route?.mode === "real" ? claudeMark(20) : ""}<span>Routing</span><span class="n">${route && route.mode !== "real" ? "vendor and invoice shape" : ""}</span>`;

  const SY = LY + RTH + 22;
  const s = shot("login.png", "portal.halcyonstaffing.demo/login", LX, SY, LW, { x: 300, y: 90, w: 500, h: 310 }, 2.2);
  const els = [
    { ref: "ref_2", b: s.map(b.login.user) },
    { ref: "ref_3", b: s.map(b.login.pass) },
    { ref: "ref_4", b: s.map(b.login.btn) },
  ];
  const tTag = 3.2;
  const tags = els
    .map(
      (e, i) => `<div class="hlbox o" style="${box(e.b.x - 3, e.b.y - 3, e.b.w + 6, e.b.h + 6)}border-width:1.5px;${at(tTag + i * 0.25, 0.3)}"></div>
        <div class="tag o" style="left:${e.b.x + e.b.w - 62}px;top:${e.b.y + e.b.h / 2 - 11}px;${at(tTag + i * 0.25, 0.3)}">${e.ref}</div>`,
    )
    .join("");

  // middle: what the agent reads (the real read_page output, trimmed), and what it can't do
  const MX = 656, MY = 214, MW = 540;
  const outline: string[] = [
    `<span class="m">Page: Sign in · /portal/login</span>`,
    `- link <span class="t">"Halcyon Staffing"</span> <span class="m">[ref=ref_1]</span>`,
    `- textbox <span class="t">"Username"</span> <span class="hl">[ref=ref_2]</span>`,
    `- textbox (password) <span class="t">"Password"</span> <span class="hl">[ref=ref_3]</span>`,
    `- button <span class="t">"Sign in"</span> <span class="hl">[ref=ref_4]</span>`,
  ];
  const ORH = 40, OR0 = MY + 54 + 16, tOut = 4.0;
  const outHtml = outline.map((l, i) => row(MX + 24, OR0 + i * ORH, MW - 48, ORH, l, tOut + i * 0.22, "mono", "font-size:15px;")).join("");
  const MH = OR0 + outline.length * ORH + 14 - MY;
  const offY = MY + MH + 22;
  const off = ["Run scripts on the page", "Upload files", "Open sites other than the portal", "Go past 25 turns"];
  const tOff = 11.0;
  const offHtml =
    panel(MX, offY, MW, 54 + 14 + off.length * 36 + 12, `<span>It can't</span>`, tOff - 0.3) +
    off.map((t, i) => `<div class="r" style="${box(MX + 24, offY + 54 + 14 + i * 36, MW - 48)}font-size:19px;color: rgb(222,218,213);${at(tOff + 0.15 + i * 0.18)}"><span class="muted" style="display:inline-block;width:26px">×</span>${t}</div>`).join("");

  // right: what it does, turn by turn, then the facts read again by plain code
  const RX = 1236, RY = 214, RW = 588;
  const { rows: acts, summary } = agentActions(trace);
  const ARH = 34, AR0 = RY + 54 + 12, tAct = 6.4, ST = 0.28;
  const actHtml = acts
    .map(([n, tool, arg], i) => row(RX + 22, AR0 + i * ARH, RW - 44, ARH, `<span class="m" style="display:inline-block;width:34px">${esc(n)}</span><span class="t" style="display:inline-block;width:176px">${esc(tool)}</span>${arg}`, tAct + i * ST, "mono", "font-size:14.5px;"))
    .join("");
  const sumY = AR0 + acts.length * ARH + 8;
  const tSum = tAct + acts.length * ST + 0.1;
  const RH = sumY + 52 - RY;
  const vY = RY + RH + 20;
  const checks: J[] = (check?.checks ?? []).filter((c: J) => c.key === "approved_hours").slice(0, 3);
  const tV = 12.4;
  const vRows = checks.length
    ? checks
        .map((c, i) =>
          row(
            RX + 22,
            vY + 54 + 8 + i * 32,
            RW - 44,
            32,
            `<span class="m" style="display:inline-block;width:70px">${esc(c.subject?.employee_id)}</span><span class="t">${esc(c.key)} = ${esc(c.value)}</span><span style="position:absolute;right:0;top:0" class="${c.status === "match" ? "ok" : "bad"}">${c.status === "match" ? "same on the page" : esc(c.status)}</span>`,
            tV + 0.2 + i * 0.18,
            "mono",
            "font-size:14px;",
          ),
        )
        .join("")
    : row(RX + 22, vY + 54 + 8, RW - 44, 32, `<span class="muted" style="font-size:15px">Each recorded fact is read again from its page.</span>`, tV + 0.2);
  const VH = 54 + 8 + Math.max(1, checks.length) * 32 + 10;
  const counts = check ? `${check.checks.filter((c: J) => c.status === "match").length} of ${check.checks.length} match` : "";

  const w = els.map((e, i) => wire([e.b.x + e.b.w + 4, e.b.y + e.b.h / 2], [MX - 2, OR0 + (i + 2) * ORH + ORH / 2], tOut + (i + 2) * 0.22 + 0.15)).join("");
  return `
    ${panel(LX, LY, LW, RTH, routeHead, tR)}
    ${rr.join("")}
    ${s.html}${tags}
    <div class="r mono" style="${box(LX, s.bottom + 20, LW)}font-size:14px;color: rgb(150,145,140);${at(3.8)}">&lt;input name="username" <span class="hl">data-agent-ref="ref_2"</span>&gt;</div>
    ${panel(MX, MY, MW, MH, `${claudeMark(22)}<span>What the agent reads</span>`, 3.7)}
    ${outHtml}${offHtml}
    ${panel(RX, RY, RW, RH, `${claudeMark(22)}<span>What it does</span><span class="n">turn · action</span>`, 6.1)}
    ${actHtml}
    ${rule(RX, sumY, RW, tSum - 0.2)}
    <div class="r" style="${box(RX + 22, sumY + 15, RW - 44)}font-size:18px;${at(tSum)}"><span style="color:#fff">${esc(summary)}</span> <span class="muted">from 4 timecards</span></div>
    ${panel(RX, vY, RW, VH, `<span>Read again by plain code</span><span class="n">${counts}</span>`, tV)}
    ${vRows}
    <svg class="wires" width="${W}" height="${H}">${w}</svg>`;
}

/* ============================================================== 04 · trace */

const tin = (u: J) => (u?.input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0);
// Same prices as scripts/usage.ts (claude-opus-5-5, USD per million tokens).
const usd = (r: J) => ((r.input_tokens ?? 0) * 4 + (r.output_tokens ?? 0) * 20 + (r.cache_read_input_tokens ?? 0) * 0.2 + (r.cache_creation_input_tokens ?? 0) * 5) / 1e6;

function traceData() {
  const learn = jsonl(runFile("learn-trace.jsonl"));
  const trace = jsonl(runFile("trace.jsonl"));
  const usage = jsonl(runFile("usage.jsonl"));
  const decisions = jsonl(runFile("decisions.jsonl"));
  const route = readMaybe(runFile("route-HSG-1011.json"));
  const spans = jsonl(runFile("spans-HSG-1011.jsonl"));
  const marks = readMaybe<{ t0: string; marks: Record<string, number> }>(runFile("marks.json"));
  const runs = [...new Set(trace.map((e) => e.run_id as string))];
  const r1 = runs.find((r) => r.includes("HSG-1011")) ?? runs[0];
  const e1 = trace.filter((e) => e.run_id === r1);
  const step = (name: string, from: J[] = e1) => from.find((e) => e.step === name);
  const time = (ts: string) => ts.slice(11, 22);
  type Row = { ts: string; mode: string; step: string; detail: string };
  const rows: Row[] = [];
  const add = (e: J, detail: string, stepName?: string) => {
    if (e) rows.push({ ts: time(e.ts), mode: e.mode, step: stepName ?? e.step, detail });
  };
  const SHORT: Record<string, string> = {
    line_amounts_correct: "line math",
    total_matches_line_items: "total",
    rate_matches_contract: "rates",
    no_duplicate_lines: "duplicates",
    no_unknown_charges: "charges",
    hours_match_timecards: "hours",
  };
  const fails = (r: Record<string, string> | undefined) => {
    const e = Object.entries(r ?? {});
    const pass = e.filter(([, v]) => v === "pass").length;
    const other = e.filter(([, v]) => v !== "pass").map(([n, v]) => `${SHORT[n] ?? n} ${v}`);
    return `${pass} pass · ${other.join(", ")}`;
  };

  // learning (learn/trace.jsonl)
  const ls = step("skill.start", learn);
  add(ls, `v${ls?.detail.version} from ${ls?.detail.session_id}`);
  const sy = step("skill.synthesize", learn);
  add(sy, `${sy?.detail.model ?? "plain code"} · ${sy?.detail.ms} ms${sy?.detail.request_id ? ` · ${sy.detail.request_id}` : ""}`);
  const ld = step("skill.done", learn);
  add(ld, `${ld?.detail.rules} rules · ${ld?.detail.portal_pages} pages · ${ld?.detail.checks} checks`);
  // routing (runs/<id>/route.json)
  if (route) rows.push({ ts: time(route.decided_at), mode: route.mode, step: "route", detail: `${route.workflow_id ?? "none"}${route.version ? ` v${route.version}` : ""} · ${Math.round(route.confidence * 100)}% · ${route.reason}` });
  // the agent run (agent/trace.jsonl)
  const ci = step("calc.initial");
  add(ci, fails(ci?.detail.results));
  const bs = step("browser.start");
  add(bs, `${bs?.detail.model} · ${bs?.detail.tasks} timecards to read · max ${bs?.detail.max_turns} turns`);
  for (const e of e1.filter((x) => x.step === "browser.action" && !/wait$/.test(x.detail.tool)).slice(0, 3)) {
    const i = e.detail.input ?? {};
    const tool = String(e.detail.tool).replace(/^browser\./, "");
    let arg = "";
    if (i.url) arg = urlPath(i.url);
    else if (i.target?.ref) arg = i.target.ref;
    else if (i.query) arg = `"${i.query}"`;
    else if (i.key) arg = `${i.key} = ${i.value}`;
    add(e, `turn ${e.detail.turn} · ${tool} ${arg}`);
  }
  const ss = step("scripted.start");
  add(ss, `${ss?.detail.tasks?.length ?? ""} timecards · fixed steps`);
  const ev = e1.find((e) => e.step === "browser.evidence" && e.detail.key === "approved_hours");
  add(ev, `approved_hours = ${ev?.detail.value} · ${String(ev?.detail.source ?? "").replace(/^fixture:/, "")}`);
  const bd = step("browser.done");
  add(bd, `${bd?.detail.turns} turns · ${bd?.detail.facts} facts · ${bd?.detail.stop_reason}`);
  const ec = step("evidence.check");
  add(ec, `${ec?.detail.match} match · ${ec?.detail.mismatch} mismatch · ${ec?.detail.unavailable} not found`);
  const cw = step("calc.with_evidence");
  add(cw, fails(cw?.detail.results));
  const sd = step("synthesis.done");
  add(sd, `${sd?.detail.model} · ${kfmt(tin(sd?.detail.usage))} in / ${kfmt(sd?.detail.usage?.output_tokens ?? 0)} out`);
  const rw = step("receipt.written");
  add(rw, `${rw?.detail.path} · recommends ${rw?.detail.recommendation}`);
  const d1 = decisions.find((d) => JSON.stringify(d).includes("HSG-1011"));
  if (d1) rows.push({ ts: time(d1.decided_at), mode: "human", step: "decision", detail: `${d1.decision} by ${d1.decided_by ?? "reviewer"}` });

  // Claude calls in the take, from the usage ledger, grouped by the part of the take they happened in.
  const abs = (k: string) => (marks?.marks?.[k] != null ? new Date(Date.parse(marks.t0) + marks.marks[k] * 1000).toISOString() : null);
  const parts: [string, string | null][] = [
    ["Learn the workflow", abs("eval_start")],
    ["Evals", abs("deliver_1011")],
    ["HSG-1011", abs("deliver_1012")],
    ["HSG-1012", null],
  ];
  const groupOf = (r: J) => {
    const g = parts.find(([, until]) => until == null || r.ts < until)![0];
    if (!g.startsWith("HSG")) return g;
    return `${g} ${r.purpose === "browser-turn" ? "agent" : r.purpose === "route" ? "routing" : "receipt"}`;
  };
  const groups = new Map<string, { n: number; tin: number; tout: number }>();
  for (const r of usage) {
    const g = groupOf(r);
    const x = groups.get(g) ?? { n: 0, tin: 0, tout: 0 };
    x.n++;
    x.tin += tin(r);
    x.tout += r.output_tokens ?? 0;
    groups.set(g, x);
  }
  const calls = [...groups.entries()].map(([label, x]) => ({ label, ...x }));
  const cost = usage.length ? usage.reduce((a, r) => a + usd(r), 0) : null;
  const reqIds = [...new Set([...usage.map((u) => u.request_id), ...spans.map((s) => s.attrs?.request_id)].filter((x): x is string => typeof x === "string" && x.length > 0))];

  // the HSG-1011 run's spans
  const kinds = new Map<string, number>();
  for (const s of spans) if (s.kind !== "run") kinds.set(s.kind, (kinds.get(s.kind) ?? 0) + 1);
  const st0 = spans.length ? Math.min(...spans.map((s) => Date.parse(s.start))) : 0;
  const st1 = spans.length ? Math.max(...spans.map((s) => Date.parse(s.end))) : 1;
  const ledger = fs.existsSync(runFile("usage.jsonl"));
  return { rows: rows.slice(0, 17), calls, cost, reqIds, spans, kinds, st0, st1, ledger };
}

export const hasRequestIds = () => traceData().reqIds.length > 0;

const KIND_SHADE: Record<string, string> = {
  model: "rgb(236,232,227)",
  synthesis: "rgb(236,232,227)",
  tool: "rgb(150,146,141)",
  calc: "rgb(105,101,97)",
  verify: "rgb(105,101,97)",
  run: "rgb(70,67,64)",
};

function traceBody(): string {
  const { rows, calls, cost, reqIds, spans, kinds, st0, st1, ledger } = traceData();
  const LX = 96, LY = 214, LW = 1150;
  const RH = 31, R0 = LY + 54 + 14, T0 = 0.8, ST = 0.24;
  const modeCls = (m: string) => (m === "real" ? "hl" : m === "human" ? "t" : "m");
  const rowHtml = rows
    .map((r, i) =>
      row(LX + 22, R0 + i * RH, LW - 44, RH, `<span class="m" style="display:inline-block;width:124px">${esc(r.ts)}</span><span class="${modeCls(r.mode)}" style="display:inline-block;width:132px">${esc(r.mode)}</span><span class="t" style="display:inline-block;width:196px">${esc(r.step)}</span><span>${esc(clip(r.detail, 66))}</span>`, T0 + i * ST, "mono", "font-size:14.5px;"),
    )
    .join("");
  const footY = R0 + rows.length * RH + 12;
  const LH = footY + 52 - LY;
  const tEnd = T0 + rows.length * ST;

  // right top: Claude calls in this take
  const RX = 1290, RY = 214, RW = 534;
  const CRH = 40, C0 = RY + 54 + 8, tC = 2.4;
  const callHtml = calls.length
    ? calls
        .map(
          (c, i) =>
            `<div class="r" style="${box(RX + 22, C0 + i * CRH, RW - 44)}height:${CRH}px;line-height:${CRH}px;font-size:17px;${i ? "border-top:1px solid rgb(38,36,34);" : ""}${at(tC + i * 0.18, 0.4)}"><span style="color: rgb(228,224,219)">${esc(c.label)}</span><span class="mono" style="position:absolute;right:0;top:0;font-size:14px;line-height:${CRH}px"><span class="t">${c.n}</span> <span class="m">· ${kfmt(c.tin)} in · ${kfmt(c.tout)} out</span></span></div>`,
        )
        .join("")
    : row(RX + 22, C0, RW - 44, CRH, `<span class="muted" style="font-size:16px">${ledger ? "No Claude calls in this take." : "This archive has no usage ledger."}</span>`, tC);
  const total = calls.reduce((a, c) => a + c.n, 0);
  const totY = C0 + Math.max(1, calls.length) * CRH + 8;
  const tTot = tC + calls.length * 0.18;
  const ids = reqIds.slice(0, 3);
  const idY = totY + 58;
  const CH = (ids.length ? idY + 34 + ids.length * 28 + 10 : totY + 54) - RY;
  const idHtml = ids.length
    ? `<div class="r muted" style="${box(RX + 22, idY, RW - 44)}font-size:14px;letter-spacing:.06em;text-transform:uppercase;${at(tTot + 0.4)}">Request IDs · ${ids.length} of ${reqIds.length}</div>` +
      ids.map((id, i) => `<div class="r mono" style="${box(RX + 22, idY + 32 + i * 28, RW - 44)}font-size:13.5px;color: rgb(190,185,180);${at(tTot + 0.6 + i * 0.15)}">${esc(id)}</div>`).join("")
    : "";

  // right bottom: the run's spans on one time axis (runs/HSG-1011/spans.jsonl)
  const SY = RY + CH + 22;
  const tSp = 7.0;
  const len = Math.max(1, st1 - st0);
  const inner = spans.filter((s) => s.kind !== "run");
  const LANES = (["model", "tool", "verify", "calc", "synthesis"] as const).filter((k) => inner.some((s) => s.kind === k));
  const LBL = 92, BW = RW - 44 - LBL, LH2 = 22;
  const labels = LANES.map((k, i) => row(RX + 22, SY + 54 + 14 + i * LH2, LBL, LH2, k, tSp + 0.3, "mono m", "font-size:13px;")).join("");
  const bars = inner
    .map((s, i) => {
      const x = ((Date.parse(s.start) - st0) / len) * BW;
      const w = Math.max(2, ((Date.parse(s.end) - Date.parse(s.start)) / len) * BW);
      const lane = LANES.indexOf(s.kind);
      return `<div class="o" style="${box(RX + 22 + LBL + x, SY + 54 + 14 + lane * LH2 + 7, w, 8)}border-radius:2px;background:${KIND_SHADE[s.kind] ?? "rgb(105,101,97)"};${at(tSp + 0.4 + (i / Math.max(1, inner.length)) * 1.4, 0.2)}"></div>`;
    })
    .join("");
  const kindLine = [...kinds.entries()].map(([k, v]) => `${v} ${k}`).join(" · ");
  const SH = 54 + 14 + LANES.length * LH2 + 12 + 30;
  const spanHtml = spans.length
    ? panel(RX, SY, RW, SH, `<span>Spans · HSG-1011</span><span class="n">${((st1 - st0) / 1000).toFixed(1)} s</span>`, tSp) +
      labels +
      bars +
      row(RX + 22, SY + 54 + 14 + LANES.length * LH2 + 6, RW - 44, 26, esc(kindLine), tSp + 1.8, "mono m", "font-size:13.5px;")
    : "";

  return `
    ${panel(LX, LY, LW, LH, `<span>Trace</span><span class="n">learn · agent · route.json · spans.jsonl · decisions</span>`, 0.4)}
    ${rowHtml}
    ${rule(LX, footY - 4, LW, tEnd)}
    <div class="r mono" style="${box(LX + 22, footY + 12, LW - 44)}font-size:14px;${at(tEnd + 0.2)}"><span class="hl">real</span><span class="m"> Claude did it</span><span class="m" style="margin-left:36px">deterministic, scripted</span><span class="m"> plain code, fixed steps</span><span class="t" style="margin-left:36px">human</span><span class="m"> a person</span></div>
    ${panel(RX, RY, RW, CH, `${claudeMark(22)}<span>Claude calls in this take</span>`, tC - 0.3)}
    ${callHtml}
    <div class="r" style="${box(RX + 22, totY, RW - 44)}display:flex;justify-content:space-between;border-top:1px solid rgb(48,46,44);padding-top:14px;font-size:18px;${at(tTot)}"><span style="color:#fff">${ledger ? `${total} calls` : ""}</span><span class="mono" style="font-size:15px;color:#fff">${cost != null ? `≈ $${cost.toFixed(2)}` : ""}</span></div>
    ${idHtml}
    ${spanHtml}`;
}

/* ============================================================== the four diagrams */

export const DIAGRAMS: Diagram[] = [
  {
    id: "voice",
    kicker: "01 · Voice",
    title: "Words lined up with clicks",
    duration: 13,
    body: voiceBody,
    captions: [
      { t0: 0.4, t1: 6.2, text: "Every word gets its own time, on the same clock as the clicks." },
      { t0: 6.4, t1: 12.8, text: "So each sentence links to the clicks it is about, and a rule can point at both." },
    ],
  },
  {
    id: "skill",
    kicker: "02 · Learning a skill",
    title: "From one recording to a tested skill",
    duration: 16,
    body: skillBody,
    captions: [
      { t0: 0.4, t1: 5.2, text: "Learning runs in six stages, from the recording to a packaged skill." },
      { t0: 5.4, t1: 10.4, text: "Every rule cites the words I said and the click that shows it." },
      { t0: 10.6, t1: 15.8, text: "Eight test recordings check it. It goes live only if every gate holds." },
    ],
  },
  {
    id: "execution",
    kicker: "03 · Execution",
    title: "How the workflow agent works",
    duration: 16,
    body: execBody,
    captions: [
      { t0: 0.4, t1: 5.4, text: "Routing matches the vendor and the shape of the invoice to one workflow." },
      { t0: 5.6, t1: 10.8, text: "The agent sees each page as a short outline, with a tag on every element it can use." },
      { t0: 11.0, t1: 15.8, text: "It can't run scripts or leave the portal, and plain code reads every fact again." },
    ],
  },
  {
    id: "trace",
    kicker: "04 · Observability",
    title: "Every step is on the record",
    duration: 14,
    body: traceBody,
    get captions(): DCaption[] {
      return [
        { t0: 0.4, t1: 6.4, text: "Every step writes a line to a log: what ran, and whether Claude, plain code or a person did it." },
        {
          t0: 6.6,
          t1: 13.8,
          text: hasRequestIds()
            ? "Each Claude call is logged with its request ID, so it can be checked against Anthropic's own records."
            : "Each step is timed, and each Claude call is logged with its model and tokens.",
        },
      ];
    },
  },
];

/* ------------------------------------------------------------------ render */
export async function renderDiagram(d: Diagram, outMp4: string, workDir: string, logos: Logos, opts: { stills?: number[] } = {}) {
  const dir = path.join(workDir, `frames-${d.id}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const html = diagramHtml(d, logos);
  // Visible text only (data URIs and SVG paths aside) must never say "simulated".
  if (/simulat/i.test(html.replace(/data:[^"')]+/g, "").replace(/<svg[\s\S]*?<\/svg>/g, ""))) throw new Error(`diagram ${d.id} must not say simulated`);
  fs.writeFileSync(path.join(workDir, `diag-${d.id}.html`), html);
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
