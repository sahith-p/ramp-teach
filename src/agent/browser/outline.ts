/**
 * Page outline + ref stamping, evaluated inside the page by the Playwright driver.
 *
 * Refs: every element the outline or `find` reports gets a `data-agent-ref="ref_N"` attribute
 * (N from a per-document counter), so a ref stays valid on that tab until the page navigates.
 *
 * Outline line format (one element per line, indented by nesting):
 *   - <role> "<name>" [ref=ref_N] [data-field=<field>] [href=<path>] [value="<v>"]
 * Elements carrying a `data-field` attribute are always included with their full text, so the
 * scripted evidence path can read the pinned portal markers (docs/lane-spec.md §2) through the
 * provider-neutral BrowserDriver.readPage() — see parseDataFields().
 *
 * The in-page code is a plain JS string (not a TS function) so tsx/esbuild helpers never leak
 * into page.evaluate.
 */

export interface OutlineOptions {
  filter: "interactive" | "all";
  depth: number | null;
  ref: string | null;
  maxChars: number;
}

export interface FindOptions {
  query: string;
  limit: number;
}

const COMMON = String.raw`
  var w = window;
  if (typeof w.__agentRefSeq !== "number") w.__agentRefSeq = 0;
  var INTERACTIVE = 'a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=tab],[role=menuitem],[contenteditable=true]';
  function clean(s, n) { s = (s || "").replace(/\s+/g, " ").trim(); return n && s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function visible(el) {
    if (!(el instanceof Element)) return false;
    if (el.closest('[hidden],[aria-hidden="true"]')) return false;
    var st = getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden") return false;
    return el.getClientRects().length > 0;
  }
  function isInteractive(el) { return el.matches(INTERACTIVE); }
  function roleOf(el) {
    var r = el.getAttribute("role"); if (r) return r;
    var t = el.tagName.toLowerCase();
    if (t === "a") return "link";
    if (t === "button" || t === "summary") return "button";
    if (t === "select") return "combobox";
    if (t === "textarea") return "textbox";
    if (t === "input") {
      var ty = (el.getAttribute("type") || "text").toLowerCase();
      if (ty === "checkbox" || ty === "radio") return ty;
      if (ty === "submit" || ty === "button" || ty === "reset") return "button";
      if (ty === "password") return "textbox (password)";
      return "textbox";
    }
    if (/^h[1-6]$/.test(t)) return "heading";
    var map = { table: "table", thead: "rowgroup", tbody: "rowgroup", tr: "row", td: "cell", th: "columnheader", img: "img",
      label: "label", li: "listitem", ul: "list", ol: "list", nav: "navigation", main: "main", form: "form", p: "paragraph",
      header: "banner", footer: "contentinfo", section: "region", dt: "term", dd: "definition", strong: "strong", em: "emphasis" };
    return map[t] || "generic";
  }
  function labelFor(el) {
    if (el.id) { var l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l) return clean(l.innerText, 80); }
    var p = el.closest("label"); if (p) return clean(p.innerText, 80);
    return "";
  }
  function directText(el) {
    var s = ""; for (var i = 0; i < el.childNodes.length; i++) { var c = el.childNodes[i]; if (c.nodeType === 3) s += c.textContent; }
    return clean(s, 160);
  }
  function nameOf(el) {
    var a = el.getAttribute("aria-label"); if (a) return clean(a, 120);
    var t = el.tagName.toLowerCase();
    if (t === "input" || t === "select" || t === "textarea") {
      var ty = (el.getAttribute("type") || "").toLowerCase();
      if (ty === "submit" || ty === "button") return clean(el.value || "Submit", 80);
      return labelFor(el) || clean(el.getAttribute("placeholder") || el.getAttribute("name") || "", 80);
    }
    if (t === "img") return clean(el.getAttribute("alt") || "", 80);
    if (el.hasAttribute("data-field") || isInteractive(el) || /^h[1-6]$/.test(t) || t === "td" || t === "th" || t === "label") return clean(el.innerText, 160);
    return directText(el);
  }
  function refOf(el) {
    var r = el.getAttribute("data-agent-ref");
    if (!r) { w.__agentRefSeq += 1; r = "ref_" + w.__agentRefSeq; el.setAttribute("data-agent-ref", r); }
    return r;
  }
  function describe(el) {
    var parts = ["- " + roleOf(el)];
    var n = nameOf(el); parts.push(JSON.stringify(n));
    parts.push("[ref=" + refOf(el) + "]");
    var f = el.getAttribute("data-field"); if (f) parts.push("[data-field=" + f + "]");
    var t = el.tagName.toLowerCase();
    if (t === "a") { var h = el.getAttribute("href"); if (h) parts.push("[href=" + h + "]"); }
    if (t === "input" || t === "textarea" || t === "select") {
      var ty = (el.getAttribute("type") || "").toLowerCase();
      if (el.getAttribute("name")) parts.push("[name=" + el.getAttribute("name") + "]");
      if (ty === "password") parts.push(el.value ? "[value=(hidden, filled)]" : "[value=(empty)]");
      else if (ty === "checkbox" || ty === "radio") parts.push(el.checked ? "[checked]" : "[unchecked]");
      else if (ty !== "submit" && ty !== "button") parts.push("[value=" + JSON.stringify(clean(el.value, 80)) + "]");
    }
    return parts.join(" ");
  }
  function include(el, filter) {
    if (el.hasAttribute("data-field") || isInteractive(el)) return true;
    if (filter === "interactive") return false;
    var t = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(t) || t === "td" || t === "th" || t === "label" || t === "img") return nameOf(el) !== "";
    return directText(el) !== "";
  }
`;

export const OUTLINE_SCRIPT = String.raw`(function (opts) {
  ${COMMON}
  var root = document.body;
  if (opts.ref) {
    root = document.querySelector('[data-agent-ref="' + opts.ref + '"]');
    if (!root) return { error: "Unknown ref " + opts.ref + " on this tab (refs reset when the page navigates); call read_page or find again." };
  }
  if (!root) return { text: "(empty page)" };
  var lines = [];
  var total = 0; var truncated = false;
  function walk(el, depth) {
    if (truncated) return;
    if (!visible(el)) return;
    var inc = include(el, opts.filter);
    var nextDepth = depth;
    if (inc) {
      if (opts.depth == null || depth < opts.depth) {
        var line = "  ".repeat(depth) + describe(el);
        total += line.length + 1;
        if (total > opts.maxChars) { truncated = true; return; }
        lines.push(line);
      }
      nextDepth = depth + 1;
    }
    var t = el.tagName.toLowerCase();
    if (t === "select" || t === "script" || t === "style" || t === "svg") return;
    for (var i = 0; i < el.children.length; i++) walk(el.children[i], nextDepth);
  }
  walk(root, 0);
  var head = "Page: " + document.title + " — " + location.pathname + location.search;
  if (truncated) lines.push("… (outline truncated; use read_page with ref=<ref> to expand a region, or find)");
  return { text: head + "\n" + lines.join("\n") };
})`;

export const FIND_SCRIPT = String.raw`(function (opts) {
  ${COMMON}
  var STOP = { the: 1, a: 1, an: 1, of: 1, for: 1, to: 1, on: 1, in: 1, and: 1, or: 1, with: 1, field: 0, element: 1 };
  var toks = clean(opts.query, 200).toLowerCase().split(/[^a-z0-9_.\-@]+/).filter(function (t) { return t && !STOP[t]; });
  if (!toks.length) return [];
  var all = document.body ? document.body.querySelectorAll("*") : [];
  var out = [];
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    if (!include(el, "all") || !visible(el)) continue;
    var hay = [roleOf(el), el.tagName.toLowerCase(), nameOf(el), el.getAttribute("data-field") || "", el.getAttribute("name") || "",
      el.getAttribute("placeholder") || "", el.getAttribute("type") || "", el.getAttribute("href") || ""].join(" ").toLowerCase();
    var score = 0;
    for (var j = 0; j < toks.length; j++) if (hay.indexOf(toks[j]) !== -1) score++;
    if (score > 0) out.push({ el: el, score: score + (isInteractive(el) || el.hasAttribute("data-field") ? 0.5 : 0) });
  }
  out.sort(function (a, b) { return b.score - a.score; });
  return out.slice(0, opts.limit).map(function (o) {
    return { ref: refOf(o.el), role: roleOf(o.el), name: nameOf(o.el), field: o.el.getAttribute("data-field") || null, href: o.el.getAttribute("href") || null };
  });
})`;

/** Parse `[data-field=<f>]` lines of a readPage outline into { field: text }. First occurrence wins. */
export function parseDataFields(outline: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of outline.split("\n")) {
    const m = /^\s*- .*? ("(?:[^"\\]|\\.)*") \[ref=ref_\d+\] \[data-field=([A-Za-z0-9_\-]+)\]/.exec(line);
    if (!m) continue;
    const field = m[2];
    if (field in out) continue;
    try {
      out[field] = JSON.parse(m[1]) as string;
    } catch {
      /* ignore malformed line */
    }
  }
  return out;
}
