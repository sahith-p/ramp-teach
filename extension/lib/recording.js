// @ts-check
/**
 * Ramp Teach Recorder (demo) — pure helpers.
 *
 * No chrome.* and no DOM access in this file: everything here takes plain objects so it can be
 * unit-tested in Node (extension/recording.test.ts) and shared by the background service worker
 * and the side panel (both load it as an ES module).
 *
 * The content script does not import this module (MV3 content scripts are classic scripts). It
 * converts the event target into a plain "element descriptor" (see ElementDesc below) and the
 * background turns that into a step with buildStep(). Passwords are redacted in BOTH places.
 *
 * Export format = RecordingSchema in contracts/core.ts:
 *   { session_id, started_at, steps: [{ ts, kind: "dom"|"narration", detail }], transcript }
 */

/**
 * Plain, serializable description of a DOM element (built by content.js `describe()`).
 * @typedef {Object} ElementDesc
 * @property {string} tag                       lowercase tag name, e.g. "a", "input"
 * @property {Record<string, string>} [attrs]   subset of attributes: id, name, type, data-field, href, role, aria-label
 * @property {string} [text]                    visible text (only on the event target itself)
 * @property {number} [nth]                     1-based :nth-of-type index among siblings
 * @property {ElementDesc | null} [parent]      parent descriptor (a few levels at most)
 */

/**
 * Raw capture sent by the content script.
 * @typedef {Object} RawCapture
 * @property {"click"|"input"|"change"|"submit"|"navigate"} event
 * @property {string} url
 * @property {string} [title]
 * @property {ElementDesc | null} [target]
 * @property {string} [value]
 */

/**
 * @typedef {Object} StepDetail
 * @property {string} [event]
 * @property {string} [url]
 * @property {string} [title]
 * @property {string} [selector]
 * @property {string} [text]
 * @property {string} [value]
 */

/** @typedef {{ ts: string, kind: "dom" | "narration", detail: StepDetail }} Step */

/**
 * @typedef {Object} Session
 * @property {string} session_id
 * @property {string} started_at
 * @property {Step[]} steps
 * @property {{ url: string, title: string } | null} [last_page]
 * @property {string[]} [page_terms]   names, IDs and field labels seen on recorded pages (speech keyterms)
 */

export const REDACTED = "[redacted]";
export const MAX_TEXT = 120;
export const MAX_VALUE = 500;

/** Tags a click is usually "about" — the click target is promoted to the nearest one of these. */
const INTERACTIVE_TAGS = new Set(["a", "button", "input", "select", "textarea", "label", "summary", "option"]);

/** Field names/ids treated as secrets in addition to type=password (belt and braces). */
const SENSITIVE_NAME = /pass(word|wd|code)?|pwd|secret|token|otp|cvv|cvc|ssn/i;

/* ------------------------------------------------------------------ URL guard */

/**
 * Only localhost fixture pages may be recorded.
 * @param {string | undefined | null} url
 * @returns {boolean}
 */
export function isAllowedUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------- text utils */

/**
 * Collapse whitespace and trim to `max` chars (with an ellipsis when cut).
 * @param {string | undefined | null} s
 * @param {number} [max]
 * @returns {string}
 */
export function cleanText(s, max = MAX_TEXT) {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

/** @param {string} v */
function cssAttrValue(v) {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/* -------------------------------------------------------------------- redaction */

/**
 * True when the element is a password (or password-like) field whose value must never be stored.
 * @param {ElementDesc | null | undefined} desc
 * @returns {boolean}
 */
export function isSensitiveField(desc) {
  if (!desc) return false;
  const a = desc.attrs ?? {};
  if ((a.type ?? "").toLowerCase() === "password") return true;
  if (desc.tag === "input" || desc.tag === "textarea") {
    return SENSITIVE_NAME.test(a.name ?? "") || SENSITIVE_NAME.test(a.id ?? "");
  }
  return false;
}

/**
 * Returns the value to store for a field: "[redacted]" for password fields, else the value
 * (trimmed to MAX_VALUE chars).
 * @param {string | undefined | null} value
 * @param {ElementDesc | null | undefined} desc
 * @returns {string}
 */
export function redact(value, desc) {
  if (isSensitiveField(desc)) return REDACTED;
  const v = String(value ?? "");
  return v.length > MAX_VALUE ? v.slice(0, MAX_VALUE) : v;
}

/* --------------------------------------------------------------------- selectors */

/**
 * The element a click is "about": the nearest ancestor-or-self that carries `data-field` or is
 * interactive (a, button, input, ...). Falls back to the raw target.
 * @param {ElementDesc} desc
 * @returns {ElementDesc}
 */
export function pickTarget(desc) {
  /** @type {ElementDesc | null | undefined} */
  let cur = desc;
  for (let depth = 0; cur && depth < 8; depth++) {
    if (cur.attrs?.["data-field"] || INTERACTIVE_TAGS.has(cur.tag)) return cur;
    cur = cur.parent;
  }
  return desc;
}

/**
 * Short CSS path (at most 4 segments), anchored at the first ancestor with an id.
 * @param {ElementDesc} desc
 * @returns {string}
 */
export function cssPath(desc) {
  /** @type {string[]} */
  const parts = [];
  /** @type {ElementDesc | null | undefined} */
  let cur = desc;
  while (cur && parts.length < 4 && cur.tag !== "html" && cur.tag !== "body") {
    const id = cur.attrs?.id;
    if (id) {
      parts.unshift(idSelector(id));
      break;
    }
    parts.unshift(cur.nth && cur.nth > 1 ? `${cur.tag}:nth-of-type(${cur.nth})` : cur.tag);
    cur = cur.parent;
  }
  return parts.join(" > ") || desc.tag;
}

/** @param {string} id */
function idSelector(id) {
  return /^[A-Za-z][\w-]*$/.test(id) ? `#${id}` : `[id="${cssAttrValue(id)}"]`;
}

/**
 * Stable selector for an element, in priority order:
 *   [data-field="…"] → tag[name="…"] → #id → a[href="…"] → short CSS path.
 * Clicks on a child (e.g. <span> inside <a>) resolve to the nearest meaningful ancestor first.
 * @param {ElementDesc | null | undefined} desc
 * @returns {string | undefined}
 */
export function selectorFor(desc) {
  if (!desc) return undefined;
  const t = pickTarget(desc);
  const a = t.attrs ?? {};
  if (a["data-field"]) return `[data-field="${cssAttrValue(a["data-field"])}"]`;
  if (a.name) return `${t.tag}[name="${cssAttrValue(a.name)}"]`;
  if (a.id) return idSelector(a.id);
  if (t.tag === "a" && a.href) return `a[href="${cssAttrValue(a.href)}"]`;
  return cssPath(t);
}

/**
 * Visible text for a click: the target's own text, else the promoted target's aria-label.
 * Never returns text for password fields.
 * @param {ElementDesc | null | undefined} desc
 * @returns {string | undefined}
 */
export function textFor(desc) {
  if (!desc || isSensitiveField(desc)) return undefined;
  const t = cleanText(desc.text);
  if (t) return t;
  const label = pickTarget(desc).attrs?.["aria-label"];
  return label ? cleanText(label) : undefined;
}

/* ------------------------------------------------------------------------- steps */

/**
 * Turn a raw capture from the content script into a Recording step.
 * @param {RawCapture} raw
 * @param {Date} [now]
 * @returns {Step}
 */
export function buildStep(raw, now = new Date()) {
  /** @type {StepDetail} */
  const detail = { event: raw.event, url: raw.url, title: cleanText(raw.title, 200) };
  const target = raw.target ?? null;
  if (raw.event !== "navigate") {
    const selector = selectorFor(target);
    if (selector) detail.selector = selector;
  }
  if (raw.event === "click") {
    const text = textFor(target);
    if (text) detail.text = text;
  }
  if (raw.event === "input" || raw.event === "change") {
    detail.value = redact(raw.value, target);
  }
  return { ts: now.toISOString(), kind: "dom", detail };
}

/**
 * A narration step (typed or dictated by the reviewer).
 * @param {string} text
 * @param {{ url?: string, title?: string } | null | undefined} page
 * @param {Date} [now]
 * @returns {Step}
 */
export function buildNarrationStep(text, page, now = new Date()) {
  return {
    ts: now.toISOString(),
    kind: "narration",
    detail: {
      event: "narration",
      text: String(text).trim(),
      url: page?.url ?? "",
      title: page?.title ?? "",
    },
  };
}

/**
 * Append a step, keeping the log tidy:
 *  - consecutive `input` steps on the same field+url collapse into the latest value;
 *  - a `navigate` to the same url as the immediately preceding navigate is dropped.
 * Returns a new array; does not mutate `steps`.
 * @param {Step[]} steps
 * @param {Step} step
 * @returns {Step[]}
 */
export function appendStep(steps, step) {
  const prev = steps[steps.length - 1];
  if (prev && prev.kind === "dom" && step.kind === "dom") {
    const p = prev.detail;
    const s = step.detail;
    if (p.event === "input" && s.event === "input" && p.selector === s.selector && p.url === s.url) {
      return [...steps.slice(0, -1), step];
    }
    if (p.event === "navigate" && s.event === "navigate" && p.url === s.url) {
      return steps;
    }
  }
  return [...steps, step];
}

/* ---------------------------------------------------------------------- sessions */

/**
 * @param {Date} [now]
 * @param {() => number} [rand]
 * @returns {string} e.g. "rec_20261109T031522Z_k3f9"
 */
export function newSessionId(now = new Date(), rand = Math.random) {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const suffix = Math.floor(rand() * 36 ** 4).toString(36).padStart(4, "0");
  return `rec_${stamp}_${suffix}`;
}

/**
 * @param {Date} [now]
 * @returns {Session}
 */
export function newSession(now = new Date()) {
  return { session_id: newSessionId(now), started_at: now.toISOString(), steps: [], last_page: null };
}

/**
 * Export shape (RecordingSchema): transcript = narration texts, in order.
 * @param {Session} session
 * @returns {{ session_id: string, started_at: string, steps: Step[], transcript: string[] }}
 */
export function toRecording(session) {
  const steps = session.steps.map((s) => ({ ts: s.ts, kind: s.kind, detail: { ...s.detail } }));
  const transcript = steps
    .filter((s) => s.kind === "narration" && typeof s.detail.text === "string" && s.detail.text.length > 0)
    .map((s) => /** @type {string} */ (s.detail.text));
  return { session_id: session.session_id, started_at: session.started_at, steps, transcript };
}

/**
 * @param {string} sessionId
 * @returns {string}
 */
export function exportFilename(sessionId) {
  return `recording-${sessionId}.json`;
}

/* ------------------------------------------------------------------- voice helpers */

/** Most page terms kept per session (the server trims to the speech model's limits). */
export const MAX_PAGE_TERMS = 300;

/**
 * Merge page terms (names, IDs, field labels seen on recorded pages) into a session's list:
 * cleaned, de-duplicated case-insensitively (first spelling wins), capped.
 * @param {string[] | undefined | null} existing
 * @param {unknown[] | undefined | null} incoming
 * @param {number} [cap]
 * @returns {string[]}
 */
export function mergeTerms(existing, incoming, cap = MAX_PAGE_TERMS) {
  const out = [...(existing ?? [])];
  const seen = new Set(out.map((t) => t.toLowerCase()));
  for (const raw of incoming ?? []) {
    if (out.length >= cap) break;
    if (typeof raw !== "string") continue;
    const t = cleanText(raw, 60);
    if (t.length < 2 || t.length > 50) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/**
 * Short label for a step, for compact UI chips: a data-field / name attribute, else the visible text,
 * else the last URL path segment.
 * @param {Step | undefined | null} step
 * @param {number} [max]
 * @returns {string}
 */
export function shortStepLabel(step, max = 22) {
  if (!step) return "";
  const d = step.detail ?? {};
  const attr = /(?:data-field|name)="([^"]+)"/.exec(d.selector ?? "");
  let label = attr ? attr[1] : d.text || d.value || "";
  if (!label && d.url) {
    try {
      const u = new URL(d.url);
      label = u.pathname.split("/").filter(Boolean).pop() ?? u.pathname;
    } catch {
      label = d.url;
    }
  }
  if (!label) label = d.event ?? step.kind;
  return cleanText(label, max);
}

/**
 * @typedef {{ text: string, start: number, end: number, confidence?: number }} Word
 * @typedef {{ id: string, text: string, start: number, end: number, words: Word[], step_refs: number[], low_confidence: string[] }} Utterance
 */

/** Below this confidence a word is underlined for review (matches lib/speech LOW_CONFIDENCE). */
export const LOW_CONFIDENCE = 0.6;

/**
 * A reviewer corrected one word: returns a new utterance list with that word's text replaced, its
 * confidence set to 1 (a person confirmed it), and the utterance text and low-confidence list rebuilt.
 * @param {Utterance[]} utterances
 * @param {number} u utterance index
 * @param {number} w word index
 * @param {string} text
 * @returns {Utterance[]}
 */
export function applyWordEdit(utterances, u, w, text) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  return utterances.map((utt, i) => {
    if (i !== u || !utt.words[w] || !t) return utt;
    const words = utt.words.map((word, j) => (j === w ? { ...word, text: t, confidence: 1 } : word));
    return {
      ...utt,
      words,
      text: words.map((x) => x.text).join(" "),
      low_confidence: words.filter((x) => typeof x.confidence === "number" && x.confidence < LOW_CONFIDENCE).map((x) => x.text),
    };
  });
}

/**
 * m:ss for a duration in seconds.
 * @param {number} s
 * @returns {string}
 */
export function clock(s) {
  const n = Math.max(0, Math.floor(Number(s) || 0));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}
