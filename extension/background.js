// @ts-check
/**
 * Ramp Teach Recorder (demo) — background service worker (MV3, ES module).
 *
 * Holds recording state in chrome.storage.local so it survives page navigations and service-worker
 * restarts:
 *   { recording: boolean, session: Session | null }
 *
 * Message API (chrome.runtime.sendMessage({ type, ... })):
 *   rt:capture  { raw }        content script → append a DOM step (localhost senders only)
 *   rt:start    { tabId? }     start (or resume) recording; refuses non-localhost tabs
 *   rt:stop                    stop recording (session kept for export)
 *   rt:narrate  { text }       append a narration step (typed or dictated)
 *   rt:status                  → { recording, session }
 *   rt:export                  → { recording: Recording } (RecordingSchema shape)
 *   rt:clear                   stop and delete the session
 * Every reply is { ok: true, ... } or { ok: false, error }.
 */
import {
  appendStep,
  buildNarrationStep,
  buildStep,
  isAllowedUrl,
  newSession,
  toRecording,
} from "./lib/recording.js";

/** @typedef {import("./lib/recording.js").Session} Session */
/** @typedef {{ recording: boolean, session: Session | null }} State */

const NOT_LOCALHOST = "Refused: the recorder only records localhost fixture pages (http://localhost or http://127.0.0.1).";

/* Open the side panel when the toolbar icon is clicked. */
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});
});

/* ------------------------------------------------------------- state (serialized) */

/** @type {Promise<unknown>} */
let queue = Promise.resolve();

/**
 * Run a read-modify-write on the state, one at a time (content scripts can fire bursts).
 * @template T
 * @param {(s: State) => Promise<T> | T} fn
 * @returns {Promise<T>}
 */
function withState(fn) {
  const run = queue.then(async () => {
    const got = await chrome.storage.local.get(["recording", "session"]);
    /** @type {State} */
    const state = { recording: Boolean(got.recording), session: /** @type {Session|null} */ (got.session ?? null) };
    const before = JSON.stringify(state);
    const result = await fn(state);
    if (JSON.stringify(state) !== before) {
      await chrome.storage.local.set({ recording: state.recording, session: state.session });
    }
    return result;
  });
  queue = run.catch(() => {});
  return run;
}

/* ------------------------------------------------------------------- tab helpers */

/**
 * Resolve the tab to record: the given tab, else the active tab of the last-focused window, else
 * (when the panel is opened as a normal tab, e.g. by the Playwright driver) the most recently used
 * localhost tab.
 * @param {number | undefined} tabId
 * @returns {Promise<chrome.tabs.Tab | undefined>}
 */
async function resolveTargetTab(tabId) {
  if (typeof tabId === "number") return chrome.tabs.get(tabId).catch(() => undefined);
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (active?.url && !active.url.startsWith("chrome-extension://")) return active;
  const local = await chrome.tabs.query({ url: ["http://localhost/*", "http://127.0.0.1/*"] });
  local.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  return local[0] ?? active;
}

/**
 * Make sure our content script is present (tabs opened before install/reload lack it).
 * content.js guards against double injection.
 * @param {number} tabId
 */
async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  } catch {
    /* page not scriptable — capture just won't happen there */
  }
}

/* -------------------------------------------------------------------- handlers */

/**
 * @param {any} msg
 * @param {chrome.runtime.MessageSender} sender
 */
async function handle(msg, sender) {
  switch (msg?.type) {
    case "rt:capture": {
      const pageUrl = sender.tab?.url ?? msg.raw?.url;
      if (!isAllowedUrl(pageUrl) || !isAllowedUrl(msg.raw?.url)) return { ok: false, error: NOT_LOCALHOST };
      return withState((s) => {
        if (!s.recording || !s.session) return { ok: false, error: "not recording" };
        const step = buildStep(msg.raw);
        s.session.steps = appendStep(s.session.steps, step);
        if (step.detail.event === "navigate") {
          s.session.last_page = { url: step.detail.url ?? "", title: step.detail.title ?? "" };
        }
        return { ok: true, count: s.session.steps.length };
      });
    }

    case "rt:start": {
      const tab = await resolveTargetTab(msg.tabId);
      if (!tab || !isAllowedUrl(tab.url)) {
        return { ok: false, error: `${NOT_LOCALHOST} Current tab: ${tab?.url ?? "none"}` };
      }
      const res = await withState((s) => {
        if (!s.session) s.session = newSession();
        s.recording = true;
        // The page is already loaded, so seed a navigate step for it.
        const step = buildStep({ event: "navigate", url: tab.url ?? "", title: tab.title ?? "" });
        s.session.steps = appendStep(s.session.steps, step);
        s.session.last_page = { url: tab.url ?? "", title: tab.title ?? "" };
        return { ok: true, session_id: s.session.session_id, tabId: tab.id };
      });
      if (typeof tab.id === "number") await ensureContentScript(tab.id);
      return res;
    }

    case "rt:stop":
      return withState((s) => {
        s.recording = false;
        return { ok: true };
      });

    case "rt:narrate": {
      const text = String(msg.text ?? "").trim();
      if (!text) return { ok: false, error: "empty narration" };
      return withState((s) => {
        if (!s.recording || !s.session) return { ok: false, error: "Start recording before adding narration." };
        s.session.steps = appendStep(s.session.steps, buildNarrationStep(text, s.session.last_page));
        return { ok: true, count: s.session.steps.length };
      });
    }

    case "rt:status":
      return withState((s) => ({ ok: true, recording: s.recording, session: s.session }));

    case "rt:export":
      return withState((s) =>
        s.session ? { ok: true, recording: toRecording(s.session) } : { ok: false, error: "no session to export" },
      );

    case "rt:clear":
      return withState((s) => {
        s.recording = false;
        s.session = null;
        return { ok: true };
      });

    default:
      return { ok: false, error: `unknown message type: ${msg?.type}` };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (typeof msg?.type !== "string" || !msg.type.startsWith("rt:")) return false;
  handle(msg, sender).then(sendResponse, (err) => sendResponse({ ok: false, error: String(err?.message ?? err) }));
  return true; // async response
});
