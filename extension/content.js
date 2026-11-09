// @ts-check
/**
 * Ramp Teach Recorder (demo) — content script (classic script; runs on localhost pages only).
 *
 * While recording is on (chrome.storage.local `recording`), captures:
 *   click · input/change (value; password fields ALWAYS "[redacted]") · submit · page load/navigation
 * and sends a raw capture { event, url, title, target, value } to the background, which builds the
 * Recording step with extension/lib/recording.js (selector + text + redaction live there).
 */
(() => {
  const w = /** @type {any} */ (window);
  if (w.__rampTeachRecorder) return; // guard against double injection (manifest + scripting)
  w.__rampTeachRecorder = true;

  const host = location.hostname;
  if (location.protocol !== "http:" || (host !== "localhost" && host !== "127.0.0.1")) return;

  const REDACTED = "[redacted]";
  const ATTRS = ["id", "name", "type", "data-field", "href", "role", "aria-label"];
  let recording = false;
  let lastUrl = location.href;

  /** @param {Element} el */
  function visibleText(el) {
    if (el instanceof HTMLInputElement) {
      if (["button", "submit", "reset"].includes(el.type)) return el.value;
      return "";
    }
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return "";
    const t = /** @type {HTMLElement} */ (el).innerText ?? el.textContent ?? "";
    return t.replace(/\s+/g, " ").trim().slice(0, 120);
  }

  /**
   * Plain descriptor of an element and a few ancestors (see ElementDesc in lib/recording.js).
   * @param {Element | null} el
   * @param {number} [depth]
   * @returns {any}
   */
  function describe(el, depth = 0) {
    if (!el || el.nodeType !== 1 || depth > 6) return null;
    /** @type {Record<string, string>} */
    const attrs = {};
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v != null) attrs[a] = v;
    }
    let nth = 1;
    for (let s = el.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === el.tagName) nth++;
    return {
      tag: el.tagName.toLowerCase(),
      attrs,
      text: depth === 0 ? visibleText(el) : undefined,
      nth,
      parent: describe(el.parentElement, depth + 1),
    };
  }

  /** @param {Element} el */
  function isPassword(el) {
    return el instanceof HTMLInputElement && el.type === "password";
  }

  /** @param {Record<string, unknown>} raw */
  function send(raw) {
    if (!recording) return;
    try {
      chrome.runtime.sendMessage({ type: "rt:capture", raw: { url: location.href, title: document.title, ...raw } }).catch(() => {});
    } catch {
      /* extension reloaded; this script is orphaned */
    }
  }

  function sendNavigate() {
    lastUrl = location.href;
    send({ event: "navigate" });
  }

  /* --- listeners (capture phase so page handlers can't swallow them) --- */

  document.addEventListener(
    "click",
    (e) => {
      const el = /** @type {Element} */ (e.target);
      if (el && el.nodeType === 1) send({ event: "click", target: describe(el) });
    },
    true,
  );

  /** @param {Event} e */
  function onValue(e) {
    const el = /** @type {HTMLInputElement} */ (e.target);
    if (!el || el.nodeType !== 1 || !("value" in el)) return;
    // Text-like fields report on `input` (coalesced in the background); toggles/selects on `change`.
    const toggle = el instanceof HTMLSelectElement || ["checkbox", "radio", "file"].includes(el.type);
    if ((e.type === "input" && toggle) || (e.type === "change" && !toggle)) return;
    let value = isPassword(el) ? REDACTED : String(el.value ?? "");
    if (el.type === "checkbox" || el.type === "radio") value = el.checked ? el.value || "on" : "";
    send({ event: e.type, target: describe(el), value });
  }
  document.addEventListener("input", onValue, true);
  document.addEventListener("change", onValue, true);

  document.addEventListener(
    "submit",
    (e) => {
      const el = /** @type {Element} */ (e.target);
      if (el && el.nodeType === 1) send({ event: "submit", target: describe(el) });
    },
    true,
  );

  /* Back/forward cache restores don't re-run content scripts. */
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) sendNavigate();
  });
  window.addEventListener("popstate", () => setTimeout(checkUrl, 50));
  window.addEventListener("hashchange", () => setTimeout(checkUrl, 50));

  /* Client-side (pushState) navigations, e.g. Next.js <Link>: poll the URL, wait a beat for the title. */
  function checkUrl() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(sendNavigate, 250);
    }
  }
  setInterval(checkUrl, 400);

  /* --- recording flag --- */

  chrome.storage.local.get("recording").then((got) => {
    recording = Boolean(got.recording);
    if (recording) sendNavigate(); // full page load while recording
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.recording) recording = Boolean(changes.recording.newValue);
  });
})();
