// @ts-check
/**
 * Ramp Teach Recorder (demo) — side panel UI.
 * Talks to the background via chrome.runtime.sendMessage and re-renders on chrome.storage changes.
 */
import { exportFilename, toRecording } from "./lib/recording.js";

/** @typedef {import("./lib/recording.js").Session} Session */

/** @param {string} id */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

const btnStart = /** @type {HTMLButtonElement} */ ($("btn-start"));
const btnStop = /** @type {HTMLButtonElement} */ ($("btn-stop"));
const btnNarrate = /** @type {HTMLButtonElement} */ ($("btn-narrate"));
const btnMic = /** @type {HTMLButtonElement} */ ($("btn-mic"));
const btnExport = /** @type {HTMLButtonElement} */ ($("btn-export"));
const btnClear = /** @type {HTMLButtonElement} */ ($("btn-clear"));
const narration = /** @type {HTMLTextAreaElement} */ ($("narration"));

let recording = false;
/** @type {Session | null} */
let session = null;

/**
 * @param {Record<string, unknown>} msg
 * @returns {Promise<any>}
 */
async function send(msg) {
  try {
    return await chrome.runtime.sendMessage(msg);
  } catch (err) {
    return { ok: false, error: String(/** @type {Error} */ (err)?.message ?? err) };
  }
}

/** @param {string} text @param {boolean} [isError] */
function say(text, isError = false) {
  const m = $("message");
  m.textContent = text;
  m.classList.toggle("error", isError);
}

/* ------------------------------------------------------------------- rendering */

/** @param {import("./lib/recording.js").Step} step */
function renderStep(step) {
  const li = document.createElement("li");
  const kind = document.createElement("div");
  kind.className = `kind ${step.kind}`;
  const d = step.detail;
  kind.textContent = step.kind === "narration" ? "narration" : d.event ?? "dom";
  const main = document.createElement("div");
  main.className = "main";
  const sub = document.createElement("div");
  sub.className = "sub";
  if (step.kind === "narration") {
    main.textContent = `“${d.text ?? ""}”`;
  } else if (d.event === "navigate") {
    main.textContent = d.title || d.url || "";
    sub.textContent = d.url ?? "";
  } else {
    main.textContent = d.text ?? (d.value !== undefined ? `= ${d.value}` : "");
    sub.textContent = d.selector ?? "";
  }
  li.append(kind, main);
  if (sub.textContent) li.append(sub);
  return li;
}

function render() {
  $("status-text").textContent = recording ? "Recording" : session ? "Stopped" : "Idle";
  $("status-dot").classList.toggle("on", recording);
  $("session-id").textContent = session ? session.session_id : "";
  btnStart.disabled = recording;
  btnStart.textContent = session && !recording ? "Resume recording" : "Start recording";
  btnStop.disabled = !recording;
  btnNarrate.disabled = !recording;
  btnMic.disabled = !recording;
  btnExport.disabled = !session || session.steps.length === 0;
  btnClear.disabled = !session;

  const steps = session?.steps ?? [];
  $("step-count").textContent = String(steps.length);
  const list = $("steps");
  const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 4;
  list.replaceChildren(...steps.map(renderStep));
  if (atBottom) list.scrollTop = list.scrollHeight;
}

async function refresh() {
  const got = await chrome.storage.local.get(["recording", "session"]);
  recording = Boolean(got.recording);
  session = /** @type {Session|null} */ (got.session ?? null);
  render();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.recording || changes.session)) refresh();
});

/* --------------------------------------------------------------------- actions */

btnStart.addEventListener("click", async () => {
  const res = await send({ type: "rt:start" });
  if (res?.ok) say(`Recording localhost tab. Session ${res.session_id}.`);
  else say(res?.error ?? "Could not start recording.", true);
});

btnStop.addEventListener("click", async () => {
  stopMic();
  const res = await send({ type: "rt:stop" });
  say(res?.ok ? "Stopped. Export or resume." : res?.error ?? "Could not stop.", !res?.ok);
});

/** @param {string} text */
async function addNarration(text) {
  const res = await send({ type: "rt:narrate", text });
  if (!res?.ok) say(res?.error ?? "Could not add narration.", true);
  return Boolean(res?.ok);
}

btnNarrate.addEventListener("click", async () => {
  const text = narration.value.trim();
  if (!text) return say("Type something to narrate first.", true);
  if (await addNarration(text)) {
    narration.value = "";
    say("Narration added.");
  }
});

narration.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) btnNarrate.click();
});

btnExport.addEventListener("click", async () => {
  const res = await send({ type: "rt:export" });
  const rec = res?.ok ? res.recording : session ? toRecording(session) : null;
  if (!rec) return say(res?.error ?? "Nothing to export.", true);
  const blob = new Blob([JSON.stringify(rec, null, 2) + "\n"], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename: exportFilename(rec.session_id), saveAs: false });
    say(`Exported ${exportFilename(rec.session_id)} (${rec.steps.length} steps).`);
  } catch (err) {
    // Fallback: plain anchor download.
    const a = document.createElement("a");
    a.href = url;
    a.download = exportFilename(rec.session_id);
    a.click();
    say(`Exported via browser download (${String(/** @type {Error} */ (err)?.message ?? err)}).`);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
});

btnClear.addEventListener("click", async () => {
  if (session && session.steps.length > 0 && !confirm("Delete this recording? Export it first if you need it.")) return;
  stopMic();
  await send({ type: "rt:clear" });
  say("Cleared.");
});

/* ----------------------------------------------------------- mic (Web Speech API) */

const w = /** @type {any} */ (window);
const SpeechRecognition = w.SpeechRecognition ?? w.webkitSpeechRecognition;
/** @type {any} */
let recognizer = null;
let listening = false;

function stopMic() {
  if (recognizer && listening) recognizer.stop();
}

if (SpeechRecognition) {
  btnMic.hidden = false;
  btnMic.addEventListener("click", () => {
    if (listening) return stopMic();
    recognizer = new SpeechRecognition();
    recognizer.continuous = true;
    recognizer.interimResults = false;
    recognizer.lang = navigator.language || "en-US";
    recognizer.onresult = (/** @type {any} */ ev) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) {
          const text = String(r[0]?.transcript ?? "").trim();
          if (text) addNarration(text);
        }
      }
    };
    recognizer.onerror = (/** @type {any} */ ev) => {
      const why =
        ev.error === "not-allowed" || ev.error === "service-not-allowed"
          ? "Microphone permission denied. Open sidepanel.html in a tab once to grant it, or type narration instead."
          : `Dictation error: ${ev.error}. Typed narration still works.`;
      $("mic-note").textContent = why;
    };
    recognizer.onstart = () => {
      listening = true;
      btnMic.setAttribute("aria-pressed", "true");
      btnMic.textContent = "Stop dictation";
      $("mic-note").textContent = "Listening… final phrases are added as narration.";
    };
    recognizer.onend = () => {
      listening = false;
      btnMic.setAttribute("aria-pressed", "false");
      btnMic.textContent = "Dictate (mic)";
    };
    try {
      recognizer.start();
    } catch (err) {
      $("mic-note").textContent = `Dictation unavailable: ${String(/** @type {Error} */ (err)?.message ?? err)}`;
    }
  });
} else {
  $("mic-note").textContent = "Dictation unavailable in this browser (no Web Speech API). Type narration instead.";
}

refresh();
