// @ts-check
/**
 * Ramp Teach Recorder (demo) — side panel UI.
 *
 * Talks to the background via chrome.runtime.sendMessage and re-renders on chrome.storage changes.
 *
 * Voice:
 *   mic on   MediaRecorder captures the take; an AnalyserNode drives the visualizer and the level peaks.
 *            Live preview: ElevenLabs Scribe v2 Realtime (single-use token from GET /api/stt/token) when the app
 *            has a key, else the browser's dictation (Web Speech API), labeled. Final phrases become narration
 *            steps, as before.
 *   Stop     uploads the takes + recording to POST /api/stt, which returns the word-timed, click-aligned
 *            transcript (recording.speech). Low-confidence words are underlined; click a word to fix it.
 *   Send     posts the enriched recording to /api/learn ({recording, operator}) and opens Bill Pay > Workflows.
 *
 * The film's stage sets window.__RT_VOICE = "simulated" (public/stage/chrome-shim.js): no mic is opened, the
 * visualizer follows the narrator's lines, and Stop asks /api/stt for the scripted demo transcript
 * (provider "simulated", mode "scripted"). No provider name is shown for it.
 */
import { applyWordEdit, clock, exportFilename, shortStepLabel, toRecording } from "./lib/recording.js";

/** @typedef {import("./lib/recording.js").Session} Session */
/** @typedef {import("./lib/recording.js").Step} Step */
/** @typedef {import("./lib/recording.js").Utterance} Utterance */
/** @typedef {{ session_id: string, started_at: string, steps: Step[], transcript: string[], audio?: any, speech?: { provider: string, model: string|null, mode: string, utterances: Utterance[], [k: string]: any } }} EnrichedRecording */

/** @param {string} id */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const w = /** @type {any} */ (window);

/** The film's stage drives the voice (no mic). */
const SIM = w.__RT_VOICE === "simulated";
const operator = () => (w.__RT_OPERATOR === "scripted_playwright" ? "scripted_playwright" : "human");
const PEAKS_RATE = 20; // level samples per second, on the recording's clock
const WPS = 2.6; // demo voice speaking rate (matches lib/speech/simulated.ts)
const REALTIME_LABEL = "ElevenLabs Scribe v2 Realtime";
const DICTATION_LABEL = "Browser dictation";

const btnStart = /** @type {HTMLButtonElement} */ ($("btn-start"));
const btnStop = /** @type {HTMLButtonElement} */ ($("btn-stop"));
const btnMic = /** @type {HTMLButtonElement} */ ($("btn-mic"));
const btnNarrate = /** @type {HTMLButtonElement} */ ($("btn-narrate"));
const btnExport = /** @type {HTMLButtonElement} */ ($("btn-export"));
const btnSend = /** @type {HTMLButtonElement} */ ($("btn-send"));
const btnClear = /** @type {HTMLButtonElement} */ ($("btn-clear"));
const narration = /** @type {HTMLInputElement} */ ($("narration"));

/* ----------------------------------------------------------------------- state */

let recording = false;
/** @type {Session | null} */
let session = null;
let voiceOn = false;
let sttBusy = false;
/** @type {EnrichedRecording | null} recording with `speech` (and `audio`) from /api/stt */
let enriched = null;
/** @type {string | null} provider label from /api/stt (only for a real provider) */
let providerLabel = null;
/** @type {string | null} live preview label (never set in the film) */
let previewLabel = null;
/** @type {{ text: string, at: number, revealAt: number | null }[]} final phrases heard while recording (at = s on the recording clock) */
let liveLines = [];
let interim = "";
/** @type {Set<string>} "u:w" keys of words a person corrected */
const edited = new Set();
/** @type {Promise<void> | null} */
let sttPending = null;
/** @type {Set<number>} step indices highlighted from the transcript */
let highlighted = new Set();

/**
 * @param {Record<string, unknown>} msg
 * @returns {Promise<any>}
 */
async function send(msg) {
  try {
    return await chrome.runtime.sendMessage(msg);
  } catch (err) {
    return { ok: false, error: errText(err) };
  }
}

/** @param {unknown} err */
function errText(err) {
  return String(/** @type {Error} */ (err)?.message ?? err);
}

/** @param {string} text @param {boolean} [isError] */
function say(text, isError = false) {
  const m = $("message");
  m.textContent = text;
  m.classList.toggle("error", isError);
}

/** Origin of the local Ramp Teach app (the localhost page being recorded). */
function appOrigin() {
  const url = session?.last_page?.url || [...(session?.steps ?? [])].reverse().find((s) => s.detail.url)?.detail.url || "";
  try {
    const u = new URL(url);
    return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1") ? u.origin : "";
  } catch {
    return "";
  }
}

const recClock = () => (session ? (Date.now() - Date.parse(session.started_at)) / 1000 : 0);

/* --------------------------------------------------------------------- persist */

const SPEECH_KEY = "rt_speech";

function saveSpeech() {
  try {
    const value = enriched ? { session_id: enriched.session_id, recording: enriched, provider_label: providerLabel, edited: [...edited] } : null;
    Promise.resolve(chrome.storage.local.set({ [SPEECH_KEY]: value })).catch(() => {});
  } catch {
    /* storage unavailable */
  }
}

async function loadSpeech() {
  try {
    const got = await chrome.storage.local.get(SPEECH_KEY);
    const v = got?.[SPEECH_KEY];
    if (v && session && v.session_id === session.session_id && v.recording?.speech) {
      enriched = v.recording;
      providerLabel = v.provider_label ?? null;
      edited.clear();
      for (const k of v.edited ?? []) edited.add(k);
    }
  } catch {
    /* none */
  }
}

/* ------------------------------------------------------------------- rendering */

/**
 * @param {Step} step
 * @param {number} i
 */
function renderStep(step, i) {
  const li = document.createElement("li");
  li.dataset.i = String(i);
  if (highlighted.has(i)) li.classList.add("hl");
  const idx = document.createElement("span");
  idx.className = "i";
  idx.textContent = String(i);
  const ev = document.createElement("span");
  const d = step.detail;
  ev.className = `ev ${step.kind}`;
  ev.textContent = step.kind === "narration" ? "narration" : d.event ?? "dom";
  const body = document.createElement("div");
  body.className = "body";
  const main = document.createElement("div");
  main.className = "main";
  const sub = document.createElement("div");
  sub.className = "sub";
  if (step.kind === "narration") {
    main.textContent = `“${d.text ?? ""}”`;
  } else if (d.event === "navigate") {
    main.textContent = d.title || d.url || "";
    try {
      const u = new URL(d.url ?? "");
      sub.textContent = u.pathname + u.search;
    } catch {
      sub.textContent = d.url ?? "";
    }
  } else {
    main.textContent = d.text ?? (d.value !== undefined ? `= ${d.value}` : shortStepLabel(step));
    sub.textContent = d.selector ?? "";
  }
  main.title = main.textContent ?? "";
  sub.title = sub.textContent ?? "";
  body.append(main);
  if (sub.textContent) body.append(sub);
  li.append(idx, ev, body);
  return li;
}

function renderSteps() {
  const steps = session?.steps ?? [];
  $("step-count").textContent = String(steps.length);
  const list = $("steps");
  const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 4;
  list.replaceChildren(...steps.map(renderStep));
  if (atBottom) list.scrollTop = list.scrollHeight;
}

/** @param {Set<number>} refs */
function highlightSteps(refs) {
  highlighted = refs;
  const list = $("steps");
  let first = /** @type {HTMLElement | null} */ (null);
  for (const li of /** @type {NodeListOf<HTMLElement>} */ (list.querySelectorAll("li"))) {
    const on = refs.has(Number(li.dataset.i));
    li.classList.toggle("hl", on);
    if (on && !first) first = li;
  }
  if (first) {
    const top = first.offsetTop - list.offsetTop;
    if (top < list.scrollTop || top > list.scrollTop + list.clientHeight - first.offsetHeight) list.scrollTop = Math.max(0, top - 8);
  }
}

/** @param {string} text @param {string} cls */
function span(text, cls) {
  const s = document.createElement("span");
  s.className = cls;
  s.textContent = text;
  return s;
}

/** Final transcript from /api/stt: word-timed utterances, linked steps, low-confidence words. */
function renderFinalTranscript() {
  const box = $("transcript");
  const utts = enriched?.speech?.utterances ?? [];
  const steps = enriched?.steps ?? session?.steps ?? [];
  if (!utts.length) {
    box.replaceChildren(span("No speech in this recording", "empty"));
    return;
  }
  const rows = utts.map((u, ui) => {
    const row = document.createElement("div");
    row.className = "utt";
    row.dataset.u = String(ui);
    const t = span(clock(u.start), "t");
    t.title = `${u.start.toFixed(2)}s to ${u.end.toFixed(2)}s`;
    const text = document.createElement("div");
    text.className = "text";
    u.words.forEach((word, wi) => {
      if (wi > 0) text.append(" ");
      const key = `${ui}:${wi}`;
      const low = typeof word.confidence === "number" && word.confidence < 0.6;
      const s = span(word.text, `w${low ? " low" : ""}${edited.has(key) ? " edited" : ""}${recording ? "" : " editable"}`);
      s.dataset.u = String(ui);
      s.dataset.w = String(wi);
      s.title = `${word.start.toFixed(2)}s${typeof word.confidence === "number" ? ` · ${Math.round(word.confidence * 100)}%` : ""}`;
      text.append(s);
    });
    row.append(t, text);
    if (u.step_refs.length) {
      const refs = document.createElement("div");
      refs.className = "refs";
      for (const i of u.step_refs) {
        const st = steps[i];
        const r = span(`#${i} ${shortStepLabel(st, 18)}`, "ref");
        r.title = st ? `${st.detail.event ?? st.kind} ${st.detail.selector ?? st.detail.url ?? ""}` : "";
        refs.append(r);
      }
      row.append(refs);
    }
    row.addEventListener("mouseenter", () => highlightSteps(new Set(u.step_refs)));
    row.addEventListener("mouseleave", () => highlightSteps(new Set()));
    return row;
  });
  box.replaceChildren(...rows);
  $("utt-count").textContent = String(utts.length);
}

/** Live transcript while recording: final phrases plus the current interim text. */
function renderLiveTranscript() {
  const box = $("transcript");
  if (!liveLines.length && !interim) {
    box.replaceChildren(span(voiceOn ? "Listening" : "No speech yet", "empty"));
    return;
  }
  const rows = liveLines.map((l) => {
    const row = document.createElement("div");
    row.className = "utt live";
    const text = document.createElement("div");
    text.className = "text";
    const words = l.text.split(/\s+/);
    const shownWords = l.revealAt == null ? words.length : Math.floor(((Date.now() - l.revealAt) / 1000) * WPS) + 1;
    if (shownWords < words.length) text.dataset.reveal = String(l.revealAt);
    words.forEach((word, i) => {
      if (i > 0) text.append(" ");
      text.append(span(word, i >= shownWords ? "w reveal" : "w"));
    });
    row.append(span(clock(l.at), "t"), text);
    return row;
  });
  if (interim) {
    const row = document.createElement("div");
    row.className = "utt live";
    const text = document.createElement("div");
    text.className = "text";
    text.append(span(interim, "interim"));
    row.append(span("", "t"), text);
    rows.push(row);
  }
  box.replaceChildren(...rows);
  box.scrollTop = box.scrollHeight;
  $("utt-count").textContent = String(liveLines.length);
}

function renderTranscript() {
  if (enriched?.speech && !recording) {
    renderFinalTranscript();
    computeSummary();
  } else {
    renderLiveTranscript();
    summary = null;
  }
  $("utt-count").hidden = !(enriched?.speech?.utterances?.length || liveLines.length);
  renderMeta();
}

function wordCount() {
  if (enriched?.speech && !recording) return enriched.speech.utterances.reduce((n, u) => n + u.words.length, 0);
  const live = liveLines.reduce((n, l) => n + l.text.split(/\s+/).filter(Boolean).length, 0);
  return live + (interim ? interim.split(/\s+/).filter(Boolean).length : 0);
}

function duration() {
  if (!session) return 0;
  if (recording) return recClock();
  let end = 0;
  for (const s of session.steps) end = Math.max(end, (Date.parse(s.ts) - Date.parse(session.started_at)) / 1000);
  for (const u of enriched?.speech?.utterances ?? []) end = Math.max(end, u.end);
  return end;
}

function renderMeta() {
  $("timer").textContent = clock(duration());
  $("word-count").textContent = String(wordCount());
  // Provider name only for a real provider: never for the film's scripted voice.
  const p = $("provider");
  const label = enriched?.speech?.provider === "elevenlabs" && !recording ? providerLabel || "ElevenLabs Scribe v2" : voiceOn && !SIM ? previewLabel : null;
  p.hidden = !label;
  p.textContent = label ?? "";
}

function render() {
  $("status-text").textContent = recording ? "Recording" : session ? "Stopped" : "Idle";
  $("status").classList.toggle("on", recording);
  $("session-id").textContent = session ? session.session_id : "";
  btnStart.disabled = recording;
  btnStart.hidden = recording;
  btnStart.textContent = session ? "Resume" : "Start recording";
  btnStop.disabled = !recording;
  btnStop.hidden = !recording;
  btnMic.disabled = !recording;
  btnMic.setAttribute("aria-pressed", String(voiceOn));
  btnMic.title = voiceOn ? "Stop voice" : "Voice";
  btnNarrate.disabled = !recording;
  narration.disabled = !recording;
  const hasSteps = Boolean(session && session.steps.length > 0);
  btnExport.disabled = !hasSteps;
  btnSend.disabled = recording || !hasSteps || sttBusy;
  btnClear.disabled = !session;
  renderSteps();
  renderTranscript();
}

async function refresh() {
  const got = await chrome.storage.local.get(["recording", "session"]);
  const wasRecording = recording;
  recording = Boolean(got.recording);
  session = /** @type {Session|null} */ (got.session ?? null);
  if (!session) {
    enriched = null;
    liveLines = [];
    interim = "";
  } else if (enriched && enriched.session_id !== session.session_id) {
    enriched = null;
  }
  if (!enriched && session && !recording) await loadSpeech();
  if (recording && !wasRecording && voiceOn === false) interim = "";
  render();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.recording || changes.session)) refresh();
});

/* ------------------------------------------------------------------ visualizer */

const BARS = 28;
const viz = /** @type {HTMLCanvasElement} */ ($("viz"));
const g = /** @type {CanvasRenderingContext2D} */ (viz.getContext("2d"));
const shown = new Float32Array(BARS);
/** @type {{ start: number, dur: number } | null} the film narrator's current line */
let simTalk = null;

/** Deterministic 0..1 hash. @param {number} n */
function h01(n) {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** Speech envelope of the film narrator's line at `now` (same shape as lib/speech/peaks.ts). @param {number} now */
function simLevel(now) {
  if (!simTalk) return 0;
  const t = (now - simTalk.start) / 1000;
  if (t < 0 || t > simTalk.dur) return 0;
  const slot = 1 / WPS;
  const wi = Math.floor(t / slot);
  const x = t / slot - wi;
  if (x > 0.82) return 0.05;
  const xx = x / 0.82;
  const edge = Math.min(1, xx / 0.18, (1 - xx) / 0.22);
  const syl = 1 + Math.floor(h01(wi * 13 + 1) * 2.5);
  const pulse = 0.62 + 0.38 * Math.abs(Math.sin(Math.PI * syl * xx + h01(wi) * 0.8));
  return edge * pulse * (0.6 + 0.4 * h01(wi * 7 + 3));
}

/** @type {Float32Array | null} static bars after a transcript: how much was said across the recording */
let summary = null;

/** Summary bars: share of each slice of the recording that was voiced (mic peaks when real, word timings otherwise). */
function computeSummary() {
  const utts = enriched?.speech?.utterances ?? [];
  const words = utts.flatMap((u) => u.words);
  const end = Math.max(duration(), words.length ? words[words.length - 1].end : 0);
  if (!words.length || end <= 0) return (summary = null);
  const out = new Float32Array(BARS);
  const slice = end / BARS;
  const peaks = audio.peaks;
  for (let i = 0; i < BARS; i++) {
    const a = i * slice;
    const b = a + slice;
    let v = 0;
    if (peaks.length) {
      let sum = 0;
      let n = 0;
      for (let k = Math.floor(a * PEAKS_RATE); k < Math.ceil(b * PEAKS_RATE); k++, n++) sum += peaks[k] ?? 0;
      v = n ? sum / n : 0;
    } else {
      let voiced = 0;
      for (const wd of words) voiced += Math.max(0, Math.min(b, wd.end) - Math.max(a, wd.start));
      v = voiced / slice;
    }
    out[i] = 0.05 + 0.4 * Math.min(1, v);
  }
  summary = out;
}

/** Bar shape: taller in the middle. @param {number} i */
const shape = (i) => {
  const d = Math.abs(i - (BARS - 1) / 2) / ((BARS - 1) / 2);
  return 0.32 + 0.68 * (1 - Math.pow(d, 1.7));
};

/** @param {number} now */
function targets(now) {
  const out = new Float32Array(BARS);
  if (voiceOn && audio.analyser && audio.freq) {
    audio.analyser.getByteFrequencyData(audio.freq);
    for (let i = 0; i < BARS; i++) {
      const band = Math.floor(Math.abs(i - (BARS - 1) / 2)); // 0 at the centre (low voice band) .. 13
      const lo = 2 + band * 3;
      let sum = 0;
      for (let b = lo; b < lo + 3; b++) sum += audio.freq[b] ?? 0;
      const v = Math.max(0, (sum / 3 - 72) / 150);
      out[i] = Math.min(1, Math.pow(v, 0.9) * 1.25) * (0.55 + 0.45 * shape(i));
    }
  } else if (voiceOn && SIM) {
    const lvl = simLevel(now);
    const s = now / 1000;
    for (let i = 0; i < BARS; i++) out[i] = lvl * shape(i) * (0.7 + 0.3 * Math.sin(s * (5.2 + ((i * 7) % 5)) + i * 1.3));
  }
  if (recording || voiceOn) {
    const s = now / 1000;
    for (let i = 0; i < BARS; i++) out[i] = Math.max(out[i], 0.035 + 0.025 * (0.5 + 0.5 * Math.sin(s * 1.6 + i * 0.55)));
  }
  return out;
}

let lastMeta = 0;
/** @param {number} now */
function frame(now) {
  const dpr = window.devicePixelRatio || 1;
  const cw = viz.clientWidth;
  const ch = viz.clientHeight;
  if (viz.width !== Math.round(cw * dpr) || viz.height !== Math.round(ch * dpr)) {
    viz.width = Math.round(cw * dpr);
    viz.height = Math.round(ch * dpr);
  }
  const tg = recording || voiceOn || !summary ? targets(now) : summary;
  for (let i = 0; i < BARS; i++) {
    const k = tg[i] > shown[i] ? 0.45 : 0.14; // quick attack, soft release
    shown[i] += (tg[i] - shown[i]) * k;
  }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, cw, ch);
  const bw = 3;
  const gap = Math.min(6, Math.max(3, (cw - BARS * bw) / (BARS - 1)));
  const total = BARS * bw + (BARS - 1) * gap;
  const x0 = (cw - total) / 2 + bw / 2;
  const mid = ch / 2;
  const live = recording || voiceOn;
  g.lineCap = "round";
  g.lineWidth = bw;
  g.strokeStyle = live ? "rgb(26, 25, 25)" : summary ? "rgb(150, 146, 142)" : "rgb(210, 206, 203)";
  g.beginPath();
  for (let i = 0; i < BARS; i++) {
    const half = Math.max(0.01, (shown[i] * (ch - bw * 2)) / 2);
    const x = x0 + i * (bw + gap);
    g.moveTo(x, mid - half);
    g.lineTo(x, mid + half);
  }
  g.stroke();

  // Level peaks for the waveform UI (real mic only), on the recording's clock.
  if (voiceOn && audio.analyser && audio.time && session) {
    audio.analyser.getFloatTimeDomainData(audio.time);
    let sum = 0;
    for (let i = 0; i < audio.time.length; i++) sum += audio.time[i] * audio.time[i];
    const level = Math.min(1, Math.sqrt(Math.sqrt(sum / audio.time.length)) * 1.6);
    const idx = Math.floor(recClock() * PEAKS_RATE);
    if (idx >= 0 && idx < PEAKS_RATE * 3600) audio.peaks[idx] = Math.max(audio.peaks[idx] ?? 0, level);
  }

  // Word-by-word reveal of the narrator's line in the film.
  for (const el of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll("[data-reveal]"))) {
    const n = Math.floor(((Date.now() - Number(el.dataset.reveal)) / 1000) * WPS) + 1;
    const words = el.querySelectorAll(".w");
    words.forEach((s, i) => s.classList.toggle("reveal", i >= n));
    if (n >= words.length) delete el.dataset.reveal;
  }

  if (now - lastMeta > 250) {
    lastMeta = now;
    if (recording) renderMeta();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* The film's stage calls this when the narrator starts a line (window.__ext.speak, wrapped by chrome-shim.js). */
w.__rtVoice = {
  /** @param {string} text */
  talk(text) {
    if (!voiceOn) return;
    const n = String(text).trim().split(/\s+/).filter(Boolean).length;
    simTalk = { start: performance.now(), dur: n / WPS + 0.2 };
  },
};

/* ------------------------------------------------------------------------ voice */

const audio = {
  /** @type {MediaStream | null} */ stream: null,
  /** @type {AudioContext | null} */ ctx: null,
  /** @type {MediaStreamAudioSourceNode | null} */ source: null,
  /** @type {AnalyserNode | null} */ analyser: null,
  /** @type {Uint8Array<ArrayBuffer> | null} */ freq: null,
  /** @type {Float32Array<ArrayBuffer> | null} */ time: null,
  /** @type {MediaRecorder | null} */ recorder: null,
  /** @type {{ blob: Blob, mime: string, offset_s: number, duration_s: number }[]} */ takes: [],
  /** @type {number[]} */ peaks: [],
  /** @type {ScriptProcessorNode | null} */ processor: null,
  /** @type {WebSocket | null} */ ws: null,
};

/** @type {any} */
let recognizer = null;
let wantDictation = false;

/** @param {string} text */
async function addNarration(text) {
  const res = await send({ type: "rt:narrate", text });
  if (!res?.ok) say(res?.error ?? "Could not add narration.", true);
  return Boolean(res?.ok);
}

/** A final phrase from the live preview: shown live and kept as a narration step. @param {string} text */
function onFinal(text) {
  const t = String(text ?? "").trim();
  if (!t) return;
  interim = "";
  liveLines.push({ text: t, at: SIM && simTalk ? Math.max(0, recClock() - (performance.now() - simTalk.start) / 1000) : recClock(), revealAt: SIM ? Date.now() : null });
  renderTranscript();
  addNarration(t);
}

/** @param {string} text */
function onInterim(text) {
  interim = String(text ?? "").trim();
  renderTranscript();
}

function startDictation() {
  const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!SR) return false;
  wantDictation = true;
  recognizer = new SR();
  recognizer.continuous = true;
  recognizer.interimResults = true;
  recognizer.lang = navigator.language || "en-US";
  recognizer.onresult = (/** @type {any} */ ev) => {
    let partial = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      const text = String(r[0]?.transcript ?? "");
      if (r.isFinal) onFinal(text);
      else partial += text;
    }
    if (partial) onInterim(partial);
  };
  recognizer.onerror = (/** @type {any} */ ev) => {
    if (ev.error === "not-allowed" || ev.error === "service-not-allowed") say("Dictation is blocked. Audio still records.", true);
  };
  recognizer.onend = () => {
    // Chrome ends dictation after a silence: keep it going while the voice is on.
    if (wantDictation && voiceOn && !SIM) {
      try {
        recognizer.start();
      } catch {
        /* already started */
      }
    }
  };
  try {
    recognizer.start();
    return true;
  } catch {
    return false;
  }
}

function stopDictation() {
  wantDictation = false;
  try {
    recognizer?.stop();
  } catch {
    /* not started */
  }
  recognizer = null;
}

/** 16 kHz little-endian PCM16, base64. @param {Float32Array} input @param {number} rate */
function pcm16Base64(input, rate) {
  const ratio = rate / 16000;
  const n = Math.floor(input.length / ratio);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, input[Math.floor(i * ratio)]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(out.buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * Live preview over ElevenLabs Scribe v2 Realtime. Protocol (official SDK wrapper/realtime): query params
 * model_id, token, audio_format, commit_strategy, keyterms; send input_audio_chunk; receive partial_transcript /
 * committed_transcript. See lib/speech/elevenlabs.ts.
 * @param {{ token: string, model_id: string, ws_url: string }} t
 * @param {string[]} keyterms
 */
function openRealtime(t, keyterms) {
  if (!audio.ctx || !audio.source) return false;
  const params = new URLSearchParams({ model_id: t.model_id, token: t.token, audio_format: "pcm_16000", commit_strategy: "vad" });
  for (const k of keyterms.slice(0, 50)) params.append("keyterms", k);
  let ws;
  try {
    ws = new WebSocket(`${t.ws_url}?${params}`);
  } catch {
    return false;
  }
  audio.ws = ws;
  const ctx = audio.ctx;
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  audio.processor = proc;
  audio.source.connect(proc);
  proc.connect(ctx.destination); // output stays silent; needed for onaudioprocess to run
  proc.onaudioprocess = (e) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    const chunk = pcm16Base64(e.inputBuffer.getChannelData(0), ctx.sampleRate);
    ws.send(JSON.stringify({ message_type: "input_audio_chunk", audio_base_64: chunk, commit: false, sample_rate: 16000 }));
  };
  ws.onmessage = (e) => {
    let m;
    try {
      m = JSON.parse(String(e.data));
    } catch {
      return;
    }
    if (m.message_type === "partial_transcript") onInterim(m.text ?? "");
    else if (m.message_type === "committed_transcript") onFinal(m.text ?? "");
  };
  ws.onclose = () => {
    if (audio.ws === ws && voiceOn) {
      // Realtime dropped mid-take: carry on with the browser's dictation.
      audio.ws = null;
      closeProcessor();
      previewLabel = startDictation() ? DICTATION_LABEL : null;
      renderMeta();
    }
  };
  return true;
}

function closeProcessor() {
  try {
    audio.processor?.disconnect();
  } catch {
    /* gone */
  }
  audio.processor = null;
}

async function startPreview() {
  const origin = appOrigin();
  if (origin) {
    try {
      const r = await fetch(`${origin}/api/stt/token`);
      if (r.ok) {
        const t = await r.json();
        const exp = await send({ type: "rt:export" });
        if (voiceOn && openRealtime(t, exp?.page_terms ?? [])) {
          previewLabel = REALTIME_LABEL;
          return renderMeta();
        }
      }
    } catch {
      /* no token: fall back */
    }
  }
  if (!voiceOn) return;
  previewLabel = startDictation() ? DICTATION_LABEL : null;
  renderMeta();
}

function pickMime() {
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(m)) return m;
  }
  return "";
}

async function micOn() {
  if (SIM) {
    voiceOn = true;
    startDictation(); // the stage's stand-in recognizer delivers the narrator's lines
    render();
    return;
  }
  /** @type {MediaStream} */
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (err) {
    const name = /** @type {any} */ (err)?.name;
    if (name === "NotAllowedError" || name === "SecurityError") {
      // Side panels cannot show the mic prompt: ask once in a tab, then come back.
      say("Allow the microphone in the new tab, then press the mic again.");
      try {
        await chrome.tabs.create({ url: chrome.runtime.getURL("permission.html") });
      } catch {
        window.open("permission.html", "_blank");
      }
    } else if (name === "NotFoundError") say("No microphone found.", true);
    else say(`Microphone unavailable: ${errText(err)}`, true);
    return;
  }
  if (!recording) {
    stream.getTracks().forEach((t) => t.stop());
    return;
  }
  audio.stream = stream;
  const ctx = new AudioContext();
  audio.ctx = ctx;
  audio.source = ctx.createMediaStreamSource(stream);
  audio.analyser = ctx.createAnalyser();
  audio.analyser.fftSize = 512;
  audio.analyser.smoothingTimeConstant = 0.6;
  audio.source.connect(audio.analyser);
  audio.freq = new Uint8Array(audio.analyser.frequencyBinCount);
  audio.time = new Float32Array(audio.analyser.fftSize);

  const mime = pickMime();
  const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
  /** @type {Blob[]} */
  const chunks = [];
  const offset = recClock();
  const t0 = performance.now();
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  rec.onstop = () => {
    const type = rec.mimeType || mime || "audio/webm";
    audio.takes.push({ blob: new Blob(chunks, { type }), mime: type, offset_s: offset, duration_s: (performance.now() - t0) / 1000 });
  };
  rec.start(1000);
  audio.recorder = rec;
  voiceOn = true;
  say("");
  render();
  startPreview();
}

/** Stop the voice: finish the take and release the mic. */
async function micOff() {
  if (!voiceOn) return;
  voiceOn = false;
  simTalk = null;
  stopDictation();
  interim = "";
  if (audio.ws) {
    const ws = audio.ws;
    audio.ws = null;
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ message_type: "input_audio_chunk", audio_base_64: "", commit: true, sample_rate: 16000 }));
      ws.close();
    } catch {
      /* closed */
    }
  }
  closeProcessor();
  const rec = audio.recorder;
  audio.recorder = null;
  if (rec && rec.state !== "inactive") {
    await new Promise((resolve) => {
      rec.addEventListener("stop", resolve, { once: true });
      rec.stop();
    });
  }
  audio.stream?.getTracks().forEach((t) => t.stop());
  audio.stream = null;
  try {
    await audio.ctx?.close();
  } catch {
    /* closed */
  }
  audio.ctx = null;
  audio.source = null;
  audio.analyser = null;
  render();
}

/* ------------------------------------------------------------- speech to text */

/** Upload what was recorded to /api/stt and show the word-timed transcript. */
async function transcribe() {
  const exp = await send({ type: "rt:export" });
  if (!exp?.ok) return;
  const rec = exp.recording;
  const origin = appOrigin();
  if (!origin) return;
  const op = operator();
  /** @type {RequestInit} */
  let init;
  if (audio.takes.length && !SIM) {
    const form = new FormData();
    form.append("recording", JSON.stringify(rec));
    form.append("operator", op);
    audio.takes.forEach((t, i) => form.append("audio", t.blob, `take${i + 1}.webm`));
    form.append("takes", JSON.stringify(audio.takes.map((t) => ({ offset_s: t.offset_s, duration_s: t.duration_s }))));
    form.append("peaks", JSON.stringify(Array.from(audio.peaks, (v) => v ?? 0)));
    form.append("page_terms", JSON.stringify(exp.page_terms ?? []));
    form.append("language", (navigator.language || "en").slice(0, 2));
    init = { method: "POST", body: form };
  } else if (SIM || op === "scripted_playwright") {
    if (!rec.steps.some((/** @type {Step} */ s) => s.kind === "narration")) return;
    init = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recording: rec, operator: op, provider: "simulated", page_terms: exp.page_terms ?? [] }),
    };
  } else {
    return; // typed notes only: nothing to transcribe
  }
  sttBusy = true;
  say("Transcribing");
  render();
  try {
    const r = await fetch(`${origin}/api/stt`, init);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      say(j.error ?? `Speech to text failed (${r.status}).`, true);
      return;
    }
    enriched = j.recording;
    providerLabel = j.provider_label ?? null;
    edited.clear();
    liveLines = [];
    saveSpeech();
    say("");
  } catch (err) {
    say(`Could not reach Ramp Teach: ${errText(err)}`, true);
  } finally {
    sttBusy = false;
    render();
  }
}

/* Click a word to correct it (low-confidence words are underlined). */
$("transcript").addEventListener("click", (e) => {
  const el = /** @type {HTMLElement} */ (e.target);
  if (!el.classList?.contains("editable") || !enriched?.speech || recording) return;
  const ui = Number(el.dataset.u);
  const wi = Number(el.dataset.w);
  const input = document.createElement("input");
  input.className = "w-edit";
  input.value = el.textContent ?? "";
  input.size = Math.max(2, input.value.length + 1);
  el.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  /** @param {boolean} keep */
  const finish = (keep) => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    if (keep && v && v !== el.textContent && enriched?.speech) {
      enriched.speech.utterances = applyWordEdit(enriched.speech.utterances, ui, wi, v);
      edited.add(`${ui}:${wi}`);
      saveSpeech();
    }
    renderTranscript();
  };
  input.addEventListener("keydown", (k) => {
    if (k.key === "Enter") finish(true);
    if (k.key === "Escape") finish(false);
  });
  input.addEventListener("input", () => (input.size = Math.max(2, input.value.length + 1)));
  input.addEventListener("blur", () => finish(true));
});

/* --------------------------------------------------------------------- actions */

btnStart.addEventListener("click", async () => {
  const resuming = Boolean(session);
  const res = await send({ type: "rt:start" });
  if (!res?.ok) return say(res?.error ?? "Could not start recording.", true);
  if (resuming && enriched) {
    // New speech will be transcribed again at the next Stop.
    enriched = null;
    saveSpeech();
  }
  say("");
});

btnStop.addEventListener("click", async () => {
  await micOff();
  const res = await send({ type: "rt:stop" });
  if (!res?.ok) return say(res?.error ?? "Could not stop.", true);
  say("");
  sttPending = transcribe().finally(() => (sttPending = null));
});

let micBusy = false;
btnMic.addEventListener("click", async () => {
  if (micBusy) return;
  micBusy = true;
  try {
    if (voiceOn) await micOff();
    else await micOn();
  } finally {
    micBusy = false;
  }
});

$("note-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = narration.value.trim();
  if (!text) return;
  if (await addNarration(text)) narration.value = "";
});

/** The recording to export or send: with speech when there is a transcript. */
async function currentRecording() {
  const res = await send({ type: "rt:export" });
  const rec = res?.ok ? res.recording : session ? toRecording(session) : null;
  if (rec && enriched?.speech && enriched.session_id === rec.session_id) {
    return { ...rec, ...(enriched.audio ? { audio: enriched.audio } : {}), speech: enriched.speech };
  }
  return rec;
}

btnExport.addEventListener("click", async () => {
  if (sttPending) await sttPending;
  const rec = await currentRecording();
  if (!rec) return say("Nothing to export.", true);
  const blob = new Blob([JSON.stringify(rec, null, 2) + "\n"], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename: exportFilename(rec.session_id), saveAs: false });
    say(`Exported ${exportFilename(rec.session_id)}`);
  } catch (err) {
    const a = document.createElement("a");
    a.href = url;
    a.download = exportFilename(rec.session_id);
    a.click();
    say(`Exported (${errText(err)})`);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
});

/* Send to Ramp: the recording (with its word-timed transcript) starts LEARN in the local app, then the
   panel opens Bill Pay > Workflows for it. */
btnSend.addEventListener("click", async () => {
  if (sttPending) await sttPending;
  const rec = await currentRecording();
  const origin = appOrigin();
  if (!rec || !origin) return say("Nothing to send.", true);
  try {
    const r = await fetch(`${origin}/api/learn`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recording: rec, operator: operator() }),
    });
    if (!r.ok) return say(`Ramp said no (${r.status}).`, true);
    say("Sent to Ramp");
    const url = `${origin}/bills/workflows?recording=${encodeURIComponent(rec.session_id)}`;
    try {
      await chrome.tabs.create({ url });
    } catch {
      window.open(url, "_blank");
    }
  } catch (err) {
    say(`Could not reach Ramp Teach: ${errText(err)}`, true);
  }
});

btnClear.addEventListener("click", async () => {
  if (session && session.steps.length > 0 && !confirm("Delete this recording?")) return;
  await micOff();
  audio.takes = [];
  audio.peaks = [];
  enriched = null;
  providerLabel = null;
  liveLines = [];
  interim = "";
  edited.clear();
  saveSpeech();
  await send({ type: "rt:clear" });
  say("");
});

window.addEventListener("pagehide", () => {
  audio.stream?.getTracks().forEach((t) => t.stop());
});

refresh();
