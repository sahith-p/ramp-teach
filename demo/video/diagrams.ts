/**
 * Technical diagrams for the product film (dark, Ramp-themed). Each one shows the real mechanism with real data
 * from an earlier live take (snapshots in demo/video/diagram-assets/source-*): portal screenshots, the steps the
 * recorder saved, the page outline the agent read, its tool calls, the evidence it recorded and the receipt.
 *
 * Rendered frame by frame (CSS animations paused and seeked through the Web Animations API) and encoded to MP4.
 * Motion is kept small: fade-and-rise, rows appearing in order, a few connector lines drawing in.
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
const ASSETS = path.join(ROOT, "demo", "video", "diagram-assets");
const LEMON = "rgb(228,242,34)";

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
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const at = (t: number, dur = 0.5) => `animation: in ${dur}s ${EASE} ${t}s forwards;`;
const box = (x: number, y: number, w: number, h?: number) =>
  `left:${x}px;top:${y}px;width:${w}px;${h != null ? `height:${h}px;` : ""}`;

// Simple Icons "claude" (CC0), drawn in Claude's terracotta.
const CLAUDE_PATH =
  "m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z";
const claudeMark = (size = 22) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}"><path fill="#D97757" d="${CLAUDE_PATH}"/></svg>`;
const rampMark = (logos: Logos, h = 18) =>
  `<svg viewBox="171 0 56 48" height="${h}" width="${(h * 56) / 48}" fill="#fff"><path d="${logos.mark}"/></svg>`;

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
    .r { transform: translateY(6px); white-space:nowrap; }
    .mono { font: 400 16px/1 "JetBrains Mono", monospace; color: rgb(205,200,194); }
    .mono .t { color:#fff; }
    .mono .m { color: rgb(128,123,118); }
    .mono .q { color: rgb(196,190,183); font-style: italic; }
    .mono .hl { color:${LEMON}; }
    .muted { color: rgb(140,135,130); }
    .bad { color: rgb(255,122,107); }
    .ok { color: rgb(150,146,141); }
    .hlbox { border:2px solid ${LEMON}; border-radius:5px; box-sizing:border-box; }
    .tag { font: 500 13px/1 "JetBrains Mono", monospace; color:#121211; background:${LEMON}; border-radius:4px; padding:4px 6px; }
    .btn { font-size:18px; padding:11px 22px; border-radius:2px; }
    svg.wires { left:0; top:0; overflow:visible; }
    .wire { fill:none; stroke-width:1.6; stroke-dasharray:1; stroke-dashoffset:1; }
    .cap { left:50%; bottom:46px; transform:translateX(-50%); max-width:1400px; width:max-content; background:rgba(18,18,18,.84);
      border:1px solid rgba(255,255,255,.06); color:#fff; font: 500 30px/1.35 Inter, system-ui, sans-serif; text-align:center; padding:14px 28px; border-radius:14px; }
    @keyframes in { to { opacity:1; transform:none; } }
    @keyframes out { from { opacity:1; } to { opacity:0; } }
    @keyframes capin { to { opacity:1; } }
    @keyframes capout { from { opacity:1; } to { opacity:0; } }
    @keyframes draw { to { stroke-dashoffset:0; } }
  </style></head><body>
    <div class="kick">${esc(d.kicker)}</div>
    <div class="title">${esc(d.title)}</div>
    ${d.body(logos)}
    ${caps}
  </body></html>`;
}

/* ------------------------------------------------------------------ the three diagrams */
const BOXES = () => JSON.parse(fs.readFileSync(path.join(ASSETS, "boxes.json"), "utf8"));

/** 01 · What the recorder saves (steps from source-recording.json) */
function recordBody(): string {
  const b = BOXES();
  const s = shot("timecard-E-101.png", "portal.halcyonstaffing.demo/employees/E-101?week=2026-10-11", 96, 214, 600, { x: 60, y: 0, w: 720, h: 470 }, 0.3);
  const hb = s.map(b.timecard.hours);
  const hl = { x: hb.x - 6, y: hb.y - 2, w: 62, h: hb.h + 5 };

  const PX = 790, PY = 214, PW = 1034;
  const rows: [string, string, string?][] = [
    ["page", `<span class="t">/portal/login</span>`],
    ["say", `<span class="q">"I'm checking this month's invoice from Halcyon Staffing."</span>`],
    ["type", `input[name="username"]  <span class="t">"ap.reviewer"</span>`],
    ["type", `input[name="password"]  <span class="m">[redacted]</span>`],
    ["click", `button  <span class="t">"Sign in"</span>`],
    ["say", `<span class="q">"Every rate on it has to match our contract."</span>`],
    ["click", `a[href="/portal/invoices/HSG-1010"]  <span class="t">"HSG-1010"</span>`],
    ["click", `a[href="/portal/employees/E-101?week=2026-10-11"]`],
    ["click", `<span class="hl">[data-field="approved_hours"]</span>  <span class="t">"40"</span>`, "hit"],
    ["say", `<span class="q">"Maya is approved for 40 hours. Billed hours can't go over that."</span>`],
  ];
  const RH = 42, R0 = PY + 54 + 22, T0 = 1.0, ST = 0.42;
  const rowHtml = rows
    .map(
      ([k, v], i) =>
        `<div class="r mono" style="${box(PX + 26, R0 + i * RH, PW - 52)}height:${RH}px;line-height:${RH}px;${at(T0 + i * ST, 0.4)}"><span class="m" style="display:inline-block;width:78px">${k}</span>${v}</div>`,
    )
    .join("");
  const hitIdx = rows.findIndex((r) => r[2] === "hit");
  const tHit = T0 + hitIdx * ST;
  const moreY = R0 + rows.length * RH;
  const tEnd = T0 + rows.length * ST;
  const footY = moreY + RH + 26;
  const PH = footY + 70 - PY;
  const cx = hb.x + 14, cy = hb.y + hb.h * 0.55;
  return `
    ${s.html}
    <div class="hlbox o" style="${box(hl.x, hl.y, hl.w, hl.h)}${at(tHit - 0.1, 0.3)}"></div>
    <svg class="o" style="left:${cx}px;top:${cy}px;${at(tHit - 0.5, 0.3)}" width="22" height="28" viewBox="0 0 22 28"><path d="M2 2l17 10.5-7.4 1.6L8 21.8Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>
    <div class="r muted" style="${box(96, s.bottom + 28, 600)}font-size:19px;line-height:1.5;white-space:normal;${at(1.6)}">The page reports every click, keystroke, form submit and page change. Each is saved with the exact element it hit.</div>
    ${panel(PX, PY, PW, PH, `${extIcon(24)}<span>Recording</span><span class="n">25 steps · 7 spoken</span>`, 0.6)}
    ${rowHtml}
    <div class="r mono" style="${box(PX + 26, moreY, 400)}height:${RH}px;line-height:${RH}px;${at(tEnd, 0.4)}"><span class="m">… 15 more steps</span></div>
    ${rule(PX, footY - 14, PW, tEnd + 0.3)}
    <div class="r" style="${box(PX + 26, footY, PW - 52)}display:flex;align-items:center;gap:18px;${at(tEnd + 0.6)}">
      <span class="btn" style="background:${LEMON};color:#121211">Send to Ramp</span>
      <span class="muted" style="font-size:18px">One JSON file: the steps and the transcript</span>
    </div>
    <svg class="wires" width="${W}" height="${H}">${wire([698, hl.y + hl.h / 2], [PX + 16, R0 + hitIdx * RH + RH / 2], tHit + 0.35, LEMON)}</svg>`;
}

/** 02 · How the agent works a page (outline + tool calls from source-trace-HSG-1011.jsonl) */
function agentBody(): string {
  const b = BOXES();
  const s = shot("login.png", "portal.halcyonstaffing.demo/login", 96, 214, 540, { x: 300, y: 70, w: 500, h: 360 }, 0.3);
  const els = [
    { ref: "ref_2", b: s.map(b.login.user) },
    { ref: "ref_3", b: s.map(b.login.pass) },
    { ref: "ref_4", b: s.map(b.login.btn) },
  ];
  const tTag = 1.4;
  const tags = els
    .map(
      (e, i) => `<div class="hlbox o" style="${box(e.b.x - 3, e.b.y - 3, e.b.w + 6, e.b.h + 6)}border-width:1.5px;${at(tTag + i * 0.25, 0.3)}"></div>
        <div class="tag o" style="left:${e.b.x + e.b.w - 62}px;top:${e.b.y + e.b.h / 2 - 11}px;${at(tTag + i * 0.25, 0.3)}">${e.ref}</div>`,
    )
    .join("");

  // middle: what Claude reads (the real read_page output, trimmed)
  const MX = 676, MY = 214, MW = 540;
  const outline: string[] = [
    `<span class="m">Page: Sign in — /portal/login</span>`,
    `- link <span class="t">"Halcyon Staffing"</span> <span class="m">[ref=ref_1]</span>`,
    `- textbox <span class="t">"Username"</span> <span class="hl">[ref=ref_2]</span>`,
    `- textbox (password) <span class="t">"Password"</span> <span class="hl">[ref=ref_3]</span>`,
    `- button <span class="t">"Sign in"</span> <span class="hl">[ref=ref_4]</span>`,
  ];
  const ORH = 40, OR0 = MY + 54 + 18, tOut = 2.6;
  const outHtml = outline
    .map((l, i) => `<div class="r mono" style="${box(MX + 24, OR0 + i * ORH, MW - 48)}font-size:15px;height:${ORH}px;line-height:${ORH}px;${at(tOut + i * 0.22, 0.4)}">${l}</div>`)
    .join("");
  const MH = OR0 + outline.length * ORH + 16 - MY;
  const offY = MY + MH + 24;
  const off = ["Run scripts on the page", "Upload files", "Open sites other than the portal", "Go past 25 turns"];
  const tOff = 11.0;
  const offHtml =
    panel(MX, offY, MW, 54 + 18 + off.length * 36 + 14, `<span>It can't</span>`, tOff - 0.3) +
    off
      .map(
        (t, i) =>
          `<div class="r" style="${box(MX + 24, offY + 54 + 16 + i * 36, MW - 48)}font-size:19px;color: rgb(222,218,213);${at(tOff + 0.15 + i * 0.18)}"><span class="muted" style="display:inline-block;width:26px">×</span>${t}</div>`,
      )
      .join("");

  // right: what it does, turn by turn
  const RX = 1256, RY = 214, RW = 568;
  const acts: [string, string, string][] = [
    ["1", "read_page", `<span class="m">interactive</span>`],
    ["2", "form_input", `<span class="hl">ref_2</span> <span class="m">username</span>`],
    ["2", "form_input", `<span class="hl">ref_3</span> <span class="m">password</span>`],
    ["2", "left_click", `<span class="hl">ref_4</span>`],
    ["2", "navigate", `<span class="m">/portal/invoices/HSG-1011</span>`],
    ["2", "find", `<span class="m">"View timecard links"</span>`],
    ["3", "note", `<span class="q">"E-103 appears twice"</span>`],
    ["3", "navigate", `<span class="m">/portal/employees/E-101?week=…</span>`],
    ["3", "get_page_text", ""],
    ["4", "record_evidence", `<span class="t">approved_hours = 40</span>`],
    ["4", "record_evidence", `<span class="t">status = approved</span>`],
    ["…", "", `<span class="m">then E-102, E-103 and E-104</span>`],
  ];
  const ARH = 38, AR0 = RY + 54 + 16, tAct = 5.4, ST = 0.36;
  const actHtml = acts
    .map(
      ([n, tool, arg], i) =>
        `<div class="r mono" style="${box(RX + 22, AR0 + i * ARH, RW - 44)}font-size:15px;height:${ARH}px;line-height:${ARH}px;${at(tAct + i * ST, 0.35)}"><span class="m" style="display:inline-block;width:34px">${n}</span><span class="t" style="display:inline-block;width:186px">${tool}</span>${arg}</div>`,
    )
    .join("");
  const sumY = AR0 + acts.length * ARH + 14;
  const tSum = tAct + acts.length * ST + 0.2;
  const RH = sumY + 66 - RY;

  const w = els
    .map((e, i) => wire([e.b.x + e.b.w + 4, e.b.y + e.b.h / 2], [MX - 2, OR0 + (i + 2) * ORH + ORH / 2], tOut + (i + 2) * 0.22 + 0.15))
    .join("");
  return `
    ${s.html}${tags}
    <div class="r mono" style="${box(96, s.bottom + 26, 540)}font-size:14px;color: rgb(150,145,140);${at(2.2)}">&lt;input name="username" <span class="hl">data-agent-ref="ref_2"</span>&gt;</div>
    <div class="r muted" style="${box(96, s.bottom + 62, 540)}font-size:19px;line-height:1.5;white-space:normal;${at(2.4)}">Each element it could use gets a tag written into the page, so it can point at things by name instead of by pixel.</div>
    ${panel(MX, MY, MW, MH, `${claudeMark(22)}<span>What Claude reads</span>`, 2.4)}
    ${outHtml}${offHtml}
    ${panel(RX, RY, RW, RH, `${claudeMark(22)}<span>What it does</span><span class="n">turn · action</span>`, 5.1)}
    ${actHtml}
    ${rule(RX, sumY, RW, tSum - 0.2)}
    <div class="r" style="${box(RX + 22, sumY + 21, RW - 44)}font-size:19px;${at(tSum)}"><span style="color:#fff">8 turns · 30 actions · 12 facts</span> <span class="muted">from 4 timecards</span></div>
    <svg class="wires" width="${W}" height="${H}">${w}</svg>`;
}

/** 03 · From facts to a decision (checks, evidence and receipt from the HSG-1011 run) */
function reviewBody(logos: Logos): string {
  const b = BOXES();
  const LX = 96, LY = 214, LW = 560;
  const checks: [string, "pass" | "fail" | "wait"][] = [
    ["Line amounts add up", "pass"],
    ["Total matches the lines", "pass"],
    ["Rates match the contract", "fail"],
    ["One line per person per week", "fail"],
    ["Only allowed charges", "pass"],
    ["Hours match timecards", "wait"],
  ];
  const CRH = 56, CR0 = LY + 54 + 10, tC = 0.8;
  const tFlip = 4.6;
  const chkHtml = checks
    .map(([name, r], i) => {
      const y = CR0 + i * CRH;
      const right =
        r === "wait"
          ? `<span class="muted" style="position:absolute;right:0;top:0;animation: out .25s ease ${tFlip - 0.25}s forwards">needs the timecards</span><span class="o bad" style="position:absolute;right:0;top:0;${at(tFlip, 0.3)}">fail</span>`
          : `<span class="${r === "fail" ? "bad" : "ok"}" style="position:absolute;right:0;top:0">${r}</span>`;
      return `<div class="r" style="${box(LX + 24, y, LW - 48)}height:${CRH}px;line-height:${CRH}px;font-size:20px;${i ? "border-top:1px solid rgb(38,36,34);" : ""}${at(tC + i * 0.2, 0.4)}"><span style="color: rgb(228,224,219)">${name}</span><span class="mono" style="font-size:16px;line-height:${CRH}px">${right}</span></div>`;
    })
    .join("");
  const lFoot = CR0 + checks.length * CRH + 16;
  const LH = lFoot + 46 - LY;

  const MX = 700, MY = 214, MW = 520;
  const s = shot("timecard-E-104.png", "portal.halcyonstaffing.demo/employees/E-104", MX, MY, MW, { x: 70, y: 330, w: 680, h: 160 }, 2.0);
  const hb = s.map(b.timecard104.hours);
  const facts: [string, string][] = [
    ["approved_hours", "38"],
    ["status", "approved"],
    ["approved_by", "Dana Whitfield"],
  ];
  const FR0 = s.bottom + 22, FRH = 36, tF = 2.8;
  const factHtml =
    facts
      .map(
        ([k, v], i) =>
          `<div class="r mono" style="${box(MX + 4, FR0 + i * FRH, MW)}height:${FRH}px;line-height:${FRH}px;${at(tF + i * 0.2, 0.4)}"><span class="m" style="display:inline-block;width:190px">${k}</span><span class="${i === 0 ? "hl" : "t"}">${v}</span></div>`,
      )
      .join("") +
    `<div class="r mono" style="${box(MX + 4, FR0 + facts.length * FRH + 8, MW)}font-size:14px;color: rgb(128,123,118);${at(tF + 0.7)}">source: /portal/employees/E-104?week=2026-10-18</div>` +
    `<div class="r" style="${box(MX + 4, FR0 + facts.length * FRH + 48, MW)}font-size:19px;line-height:1.5;white-space:normal;${at(tF + 0.9)}"><span class="muted">Invoice line 4 bills Sam Okafor for</span> <span style="color:#fff">44 h</span><span class="muted">.</span></div>`;

  const RX = 1264, RY = 214, RW = 560;
  const tR = 6.0;
  const reasons: [string, string, string][] = [
    ["Maya Chen at $105/h; contract says $95/h", "$400.00", "contract rate card"],
    ["Priya Natarajan billed twice for one week", "$2,520.00", "invoice lines 3 and 5"],
    ["Sam Okafor 44 h; timecard approves 38 h", "$528.00", "timecard E-104"],
  ];
  const RR0 = RY + 54 + 116, RRH = 80;
  const reasonHtml = reasons
    .map(
      ([t, amt, src], i) =>
        `<div class="r" style="${box(RX + 24, RR0 + i * RRH, RW - 48)}${at(tR + 0.6 + i * 0.35, 0.4)}">
          <div style="display:flex;justify-content:space-between;font-size:19px;color: rgb(232,228,223)"><span>${t}</span><span class="mono" style="font-size:16px;color:#fff">${amt}</span></div>
          <div class="mono" style="font-size:14px;color: rgb(128,123,118);margin-top:10px">source: ${src}</div></div>`,
    )
    .join("");
  const totY = RR0 + reasons.length * RRH;
  const btnY = totY + 76;
  const RH = btnY + 124 - RY;
  return `
    ${panel(LX, LY, LW, LH, `<span>Checks in plain code</span><span class="n">no model</span>`, 0.5)}
    ${chkHtml}
    <div class="r muted" style="${box(LX + 24, lFoot, LW - 48)}font-size:17px;${at(tC + 1.4)}">The same invoice always gets the same answer.</div>
    ${s.html}
    <div class="hlbox o" style="${box(hb.x - 5, hb.y - 5, 52, hb.h + 10)}${at(2.6, 0.3)}"></div>
    ${factHtml}
    ${panel(RX, RY, RW, RH, `${rampMark(logos, 17)}<span>Receipt · HSG-1011</span>`, tR)}
    <div class="r" style="${box(RX + 24, RY + 54 + 22, RW - 48)}${at(tR + 0.3)}"><div class="muted" style="font-size:16px">Recommendation</div><div style="font-size:34px;margin-top:6px">Dispute</div></div>
    ${reasonHtml}
    <div class="r" style="${box(RX + 24, totY, RW - 48)}display:flex;justify-content:space-between;border-top:1px solid rgb(40,38,36);padding-top:16px;font-size:19px;${at(tR + 1.8)}"><span class="muted">Credit to request</span><span class="mono" style="font-size:17px;color:#fff">$3,448.00</span></div>
    <div class="r" style="${box(RX + 24, btnY, RW - 48)}display:flex;gap:12px;align-items:center;${at(tR + 2.3)}">
      <span class="btn" style="border:1px solid rgb(80,77,74);color:#fff">Approve</span><span class="btn" style="background:#fff;color:#121211">Dispute</span>
    </div>
    <div class="r muted" style="${box(RX + 24, btnY + 66, RW - 48)}font-size:17px;${at(tR + 2.5)}">Claude writes the receipt. Only a person can press these.</div>
    <svg class="wires" width="${W}" height="${H}">
      ${wire([MX - 4, FR0 + FRH / 2], [LX + LW + 4, CR0 + 5 * CRH + CRH / 2], tFlip - 0.7, LEMON)}
    </svg>`;
}

/** 04 · The take's own logs (read at render time from demo/video/film-run/, so they match the take shown). */
let RUN_DIR = path.join(ROOT, "demo", "video", "film-run");
export const setRunDir = (d: string) => (RUN_DIR = d);
const RUN = () => RUN_DIR;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = any;
const jsonl = (f: string): J[] =>
  fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const kfmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const tin = (u: J) => (u?.input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0);

function traceData() {
  const learn = jsonl(path.join(RUN(), "learn-trace.jsonl"));
  const trace = jsonl(path.join(RUN(), "trace.jsonl"));
  const usage = jsonl(path.join(RUN(), "usage.jsonl"));
  const decisions = jsonl(path.join(RUN(), "decisions.jsonl"));
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

  const lr = step("load_recording", learn);
  add(lr, `${lr?.detail.steps} steps, ${lr?.detail.narration} spoken · operator ${lr?.detail.provenance?.operator ?? "?"}`);
  const dr = step("distill.real", learn);
  add(dr, `${dr?.detail.model} · ${dr?.detail.cache_hit ? "cache hit" : "live call"} · ${kfmt(tin(dr?.detail.usage))} in / ${kfmt(dr?.detail.usage?.output_tokens ?? 0)} out · ${dr?.detail.rules} rules`);
  const ci = step("calc.initial");
  add(ci, fails(ci?.detail.results));
  const bs = step("browser.start");
  add(bs, `${bs?.detail.model} · ${bs?.detail.tasks} timecards to read · max ${bs?.detail.max_turns} turns`);
  for (const e of e1.filter((x) => x.step === "browser.action" && !/wait$/.test(x.detail.tool)).slice(0, 7)) {
    const i = e.detail.input ?? {};
    const tool = String(e.detail.tool).replace(/^browser\./, "");
    let arg = "";
    if (i.url) arg = new URL(i.url).pathname + new URL(i.url).search;
    else if (i.target?.ref) arg = i.target.ref;
    else if (i.query) arg = `"${i.query}"`;
    else if (i.key) arg = `${i.key} = ${i.value}`;
    else if (i.filter) arg = i.filter;
    add(e, `turn ${e.detail.turn} · ${tool} ${arg}`);
  }
  const ev = e1.find((e) => e.step === "browser.evidence" && e.detail.key === "approved_hours" && String(e.detail.source).includes("E-104"));
  add(ev, `approved_hours = ${ev?.detail.value} · ${String(ev?.detail.source ?? "").replace(/^fixture:/, "")}`);
  const bd = step("browser.done");
  add(bd, `${bd?.detail.turns} turns · ${bd?.detail.facts} facts · ${bd?.detail.stop_reason}`);
  const cw = step("calc.with_evidence");
  add(cw, fails(cw?.detail.results));
  const sd = step("synthesis.done");
  add(sd, `${sd?.detail.model} · ${kfmt(tin(sd?.detail.usage))} in / ${kfmt(sd?.detail.usage?.output_tokens ?? 0)} out`);
  const rw = step("receipt.written");
  add(rw, `${rw?.detail.path} · recommends ${rw?.detail.recommendation}`);
  const d1 = decisions.find((d) => JSON.stringify(d).includes("HSG-1011"));
  if (d1) rows.push({ ts: time(d1.decided_at), mode: "human", step: "decision", detail: `${d1.decision} by ${d1.decided_by ?? "reviewer"}` });

  // Claude calls in the take, counted from the traces.
  const byRun = (run: string) => trace.filter((e) => e.run_id === run);
  const calls: { label: string; n: number; tin: number; tout: number }[] = [
    { label: "Learn the rules", n: dr ? 1 : 0, tin: tin(dr?.detail.usage), tout: dr?.detail.usage?.output_tokens ?? 0 },
  ];
  for (const run of runs) {
    const id = /HSG-\d+/.exec(run)?.[0] ?? run;
    const turns = byRun(run).filter((e) => e.step === "browser.result" && e.detail.stop_reason);
    calls.push({
      label: `${id} agent`,
      n: turns.length,
      tin: turns.reduce((a, e) => a + tin(e.detail.usage), 0),
      tout: turns.reduce((a, e) => a + (e.detail.usage?.output_tokens ?? 0), 0),
    });
    const sy = byRun(run).find((e) => e.step === "synthesis.done");
    if (sy) calls.push({ label: `${id} receipt`, n: 1, tin: tin(sy.detail.usage), tout: sy.detail.usage?.output_tokens ?? 0 });
  }
  // Cost from the usage ledger when the take archived it (same prices as scripts/usage.ts).
  const cost = usage.length
    ? usage.reduce((a, r) => a + (r.input_tokens * 4 + r.output_tokens * 20 + r.cache_read_input_tokens * 0.2 + r.cache_creation_input_tokens * 5) / 1e6, 0)
    : null;
  const reqIds = [...usage.map((u) => u.request_id), ...trace.map((e) => e.detail?.request_id), dr?.detail.usage?.request_id].filter(
    (x): x is string => typeof x === "string" && x.length > 0,
  );
  return { rows, calls, cost, reqIds: [...new Set(reqIds)] };
}

export const hasRequestIds = () => traceData().reqIds.length > 0;

function traceBody(): string {
  const { rows, calls, cost, reqIds } = traceData();
  const LX = 96, LY = 214, LW = 1150;
  const RH = 31, R0 = LY + 54 + 14, T0 = 0.8, ST = 0.28;
  const modeCls = (m: string) => (m === "real" ? "hl" : m === "human" ? "t" : "m");
  const clip = (s: string) => (s.length > 66 ? s.slice(0, 65) + "…" : s);
  const rowHtml = rows
    .map(
      (r, i) =>
        `<div class="r mono" style="${box(LX + 22, R0 + i * RH, LW - 44)}font-size:14.5px;height:${RH}px;line-height:${RH}px;${at(T0 + i * ST, 0.3)}"><span class="m" style="display:inline-block;width:124px">${esc(r.ts)}</span><span class="${modeCls(r.mode)}" style="display:inline-block;width:132px">${esc(r.mode)}</span><span class="t" style="display:inline-block;width:196px">${esc(r.step)}</span><span>${esc(clip(r.detail))}</span></div>`,
    )
    .join("");
  const footY = R0 + rows.length * RH + 12;
  const LH = footY + 52 - LY;
  const tEnd = T0 + rows.length * ST;

  const RX = 1290, RY = 214, RW = 534;
  const CRH = 46, C0 = RY + 54 + 12, tC = tEnd - 0.6;
  const callHtml = calls
    .map(
      (c, i) =>
        `<div class="r" style="${box(RX + 22, C0 + i * CRH, RW - 44)}height:${CRH}px;line-height:${CRH}px;font-size:18px;${i ? "border-top:1px solid rgb(38,36,34);" : ""}${at(tC + i * 0.2, 0.4)}"><span style="color: rgb(228,224,219)">${esc(c.label)}</span><span class="mono" style="position:absolute;right:0;top:0;font-size:14.5px;line-height:${CRH}px"><span class="t">${c.n} ${c.n === 1 ? "call" : "calls"}</span> <span class="m">· ${kfmt(c.tin)} in · ${kfmt(c.tout)} out</span></span></div>`,
    )
    .join("");
  const total = calls.reduce((a, c) => a + c.n, 0);
  const totY = C0 + calls.length * CRH + 10;
  const tTot = tC + calls.length * 0.2;
  const ids = reqIds.slice(0, 4);
  const idY = totY + 64;
  const PH = (ids.length ? idY + 40 + ids.length * 30 + 14 : totY + 62) - RY;
  const idHtml = ids.length
    ? `<div class="r muted" style="${box(RX + 22, idY, RW - 44)}font-size:15px;letter-spacing:.06em;text-transform:uppercase;${at(tTot + 0.4)}">Request IDs · first ${ids.length} of ${reqIds.length}</div>` +
      ids.map((id, i) => `<div class="r mono" style="${box(RX + 22, idY + 36 + i * 30, RW - 44)}font-size:14px;color: rgb(190,185,180);${at(tTot + 0.6 + i * 0.15)}">${esc(id)}</div>`).join("")
    : "";
  return `
    ${panel(LX, LY, LW, LH, `<span>Trace</span><span class="n">learn/trace.jsonl · agent/trace.jsonl · receipts/decisions.jsonl</span>`, 0.4)}
    ${rowHtml}
    ${rule(LX, footY - 4, LW, tEnd)}
    <div class="r mono" style="${box(LX + 22, footY + 12, LW - 44)}font-size:14px;${at(tEnd + 0.2)}"><span class="hl">real</span><span class="m"> Claude did it</span><span class="m" style="margin-left:36px">deterministic</span><span class="m"> plain code</span><span class="t" style="margin-left:36px">human</span><span class="m"> a person</span></div>
    ${panel(RX, RY, RW, PH, `${claudeMark(22)}<span>Claude calls in this take</span>`, tC - 0.3)}
    ${callHtml}
    <div class="r" style="${box(RX + 22, totY, RW - 44)}display:flex;justify-content:space-between;border-top:1px solid rgb(48,46,44);padding-top:14px;font-size:19px;${at(tTot)}"><span style="color:#fff">${total} calls</span><span class="mono" style="font-size:15px;color:#fff">${cost != null ? `≈ $${cost.toFixed(2)}` : ""}</span></div>
    ${idHtml}`;
}

export const DIAGRAMS: Diagram[] = [
  {
    id: "record",
    kicker: "01 · Record",
    title: "What the recorder saves",
    duration: 12,
    body: recordBody,
    captions: [
      { t0: 0.4, t1: 5.8, text: "While I work, the recorder saves each click with the exact element it hit." },
      { t0: 6.0, t1: 11.8, text: "What I say is saved alongside, and passwords are blanked before they leave the page." },
    ],
  },
  {
    id: "agent",
    kicker: "02 · Browser agent",
    title: "How the agent works a page",
    duration: 16,
    body: agentBody,
    captions: [
      { t0: 0.4, t1: 5.2, text: "The agent sees each page as a short outline, with a tag on every element it can use." },
      { t0: 5.4, t1: 10.8, text: "It picks an action, sees what changed, and goes again. Eight turns to read four timecards." },
      { t0: 11.0, t1: 15.8, text: "It can't run scripts, upload files or leave the vendor's portal." },
    ],
  },
  {
    id: "review",
    kicker: "03 · Review",
    title: "From facts to a decision",
    duration: 13,
    body: reviewBody,
    captions: [
      { t0: 0.4, t1: 6.0, text: "Plain code does the math. The agent's timecard facts settle the one check code can't do alone." },
      { t0: 6.2, t1: 12.8, text: "Claude writes the receipt with a source for each problem, and only I can approve or dispute." },
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
            : "Each Claude call is logged with the model that ran it and the tokens it used.",
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
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.setContent(diagramHtml(d, logos), { waitUntil: "networkidle" });
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
