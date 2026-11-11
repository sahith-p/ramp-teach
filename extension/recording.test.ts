import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { RecordingSchema } from "@/contracts";
import {
  MAX_PAGE_TERMS,
  REDACTED,
  appendStep,
  applyWordEdit,
  clock,
  mergeTerms,
  shortStepLabel,
  buildNarrationStep,
  buildStep,
  cleanText,
  cssPath,
  exportFilename,
  isAllowedUrl,
  isSensitiveField,
  newSession,
  newSessionId,
  redact,
  selectorFor,
  textFor,
  toRecording,
  type ElementDesc,
  type Session,
} from "./lib/recording.js";

const T0 = new Date("2026-11-09T03:00:00.000Z");
const URL_LOGIN = "http://localhost:3000/portal/login";
const URL_INV = "http://localhost:3000/portal/invoices/HSG-1010";

/** Tiny fake-element builder: el("a", { href: "/x" }, "text", parent). */
function el(tag: string, attrs: Record<string, string> = {}, text?: string, parent?: ElementDesc | null, nth = 1): ElementDesc {
  return { tag, attrs, text, nth, parent: parent ?? null };
}

const body = el("body");
const main = el("main", {}, undefined, body);

describe("isAllowedUrl", () => {
  it("allows only http localhost / 127.0.0.1", () => {
    expect(isAllowedUrl("http://localhost:3000/portal/login")).toBe(true);
    expect(isAllowedUrl("http://127.0.0.1:3013/")).toBe(true);
    expect(isAllowedUrl("https://localhost:3000/")).toBe(false);
    expect(isAllowedUrl("http://example.com/")).toBe(false);
    expect(isAllowedUrl("http://localhost.evil.com/")).toBe(false);
    expect(isAllowedUrl("chrome-extension://abc/sidepanel.html")).toBe(false);
    expect(isAllowedUrl("not a url")).toBe(false);
    expect(isAllowedUrl(undefined)).toBe(false);
  });
});

describe("selectorFor", () => {
  it("prefers [data-field]", () => {
    const span = el("span", { "data-field": "approved_hours", id: "hrs" }, "38", main);
    expect(selectorFor(span)).toBe('[data-field="approved_hours"]');
  });

  it("promotes a child click to the data-field ancestor", () => {
    const cell = el("div", { "data-field": "approved_hours" }, undefined, main);
    const strong = el("strong", {}, "38", cell);
    expect(selectorFor(strong)).toBe('[data-field="approved_hours"]');
  });

  it("uses name for form fields", () => {
    expect(selectorFor(el("input", { name: "username", type: "text", id: "u" }, "", main))).toBe('input[name="username"]');
  });

  it("uses id when no data-field/name", () => {
    expect(selectorFor(el("button", { id: "go" }, "Go", main))).toBe("#go");
    expect(selectorFor(el("button", { id: "1weird id" }, "Go", main))).toBe('[id="1weird id"]');
  });

  it("uses a[href] for links, including clicks on a child of the link", () => {
    const a = el("a", { href: "/portal/employees/E-104?week=2026-10-11" }, "View timecard", main);
    expect(selectorFor(a)).toBe('a[href="/portal/employees/E-104?week=2026-10-11"]');
    const inner = el("span", {}, "View timecard", a);
    expect(selectorFor(inner)).toBe('a[href="/portal/employees/E-104?week=2026-10-11"]');
  });

  it("escapes quotes in attribute values", () => {
    expect(selectorFor(el("a", { href: '/x?q="y"' }, "x", main))).toBe('a[href="/x?q=\\"y\\""]');
  });

  it("falls back to a short CSS path anchored at an id", () => {
    const table = el("table", { id: "lines" }, undefined, main);
    const tbody = el("tbody", {}, undefined, table);
    const tr = el("tr", {}, undefined, tbody, 3);
    const td = el("td", {}, "Labor", tr, 2);
    expect(selectorFor(td)).toBe("#lines > tbody > tr:nth-of-type(3) > td:nth-of-type(2)");
  });

  it("caps the CSS path at 4 segments and stops at body", () => {
    let cur: ElementDesc = body;
    for (const t of ["div", "section", "div", "ul", "li"]) cur = el(t, {}, undefined, cur);
    const p = el("p", {}, "x", cur, 2);
    expect(cssPath(p)).toBe("div > ul > li > p:nth-of-type(2)");
    expect(selectorFor(el("p", {}, "hi", body))).toBe("p");
  });

  it("returns undefined without a target", () => {
    expect(selectorFor(null)).toBeUndefined();
  });
});

describe("redaction", () => {
  const pw = el("input", { name: "password", type: "password" }, "", main);
  const pwOddName = el("input", { name: "field7", type: "password" }, "", main);
  const pwLikeName = el("input", { name: "user_passcode", type: "text" }, "", main);
  const user = el("input", { name: "username", type: "text" }, "", main);

  it("detects password fields by type, and password-like names as a precaution", () => {
    expect(isSensitiveField(pw)).toBe(true);
    expect(isSensitiveField(pwOddName)).toBe(true);
    expect(isSensitiveField(pwLikeName)).toBe(true);
    expect(isSensitiveField(user)).toBe(false);
    expect(isSensitiveField(el("a", { href: "/password-reset" }, "Forgot password?", main))).toBe(false);
  });

  it("always redacts password values, keeps other values", () => {
    expect(redact("demo-only", pw)).toBe(REDACTED);
    expect(redact("demo-only", pwOddName)).toBe(REDACTED);
    expect(redact("ap.reviewer", user)).toBe("ap.reviewer");
  });

  it("buildStep redacts password input/change values even if the content script sent plaintext", () => {
    for (const event of ["input", "change"] as const) {
      const step = buildStep({ event, url: URL_LOGIN, title: "Login", target: pw, value: "demo-only" }, T0);
      expect(step.detail.value).toBe(REDACTED);
      expect(JSON.stringify(step)).not.toContain("demo-only");
    }
  });

  it("never records text for a click on a password field", () => {
    expect(textFor({ ...pw, text: "secret" })).toBeUndefined();
  });
});

describe("buildStep", () => {
  it("click: selector + visible text trimmed to 120 chars", () => {
    const long = "View timecard ".repeat(20);
    const step = buildStep(
      { event: "click", url: URL_INV, title: "Invoice HSG-1010", target: el("a", { href: "/portal/employees/E-101?week=2026-10-11" }, long, main) },
      T0,
    );
    expect(step).toMatchObject({
      ts: "2026-11-09T03:00:00.000Z",
      kind: "dom",
      detail: { event: "click", url: URL_INV, title: "Invoice HSG-1010", selector: 'a[href="/portal/employees/E-101?week=2026-10-11"]' },
    });
    expect(step.detail.text!.length).toBeLessThanOrEqual(120);
    expect(step.detail.text!.startsWith("View timecard View")).toBe(true);
  });

  it("input: selector + value, no text", () => {
    const step = buildStep({ event: "input", url: URL_LOGIN, title: "Login", target: el("input", { name: "username" }, "", main), value: "ap.reviewer" }, T0);
    expect(step.detail).toEqual({ event: "input", url: URL_LOGIN, title: "Login", selector: 'input[name="username"]', value: "ap.reviewer" });
  });

  it("submit: form selector; navigate: url + title only", () => {
    const submit = buildStep({ event: "submit", url: URL_LOGIN, title: "Login", target: el("form", { action: "/api/portal/login" }, "", main) }, T0);
    expect(submit.detail).toEqual({ event: "submit", url: URL_LOGIN, title: "Login", selector: "main > form" });
    const nav = buildStep({ event: "navigate", url: URL_INV, title: "  Invoice\n HSG-1010 " }, T0);
    expect(nav.detail).toEqual({ event: "navigate", url: URL_INV, title: "Invoice HSG-1010" });
  });

  it("narration step", () => {
    const n = buildNarrationStep("  Rate must match the contract rate card. ", { url: URL_INV, title: "Invoice" }, T0);
    expect(n).toEqual({ ts: T0.toISOString(), kind: "narration", detail: { event: "narration", text: "Rate must match the contract rate card.", url: URL_INV, title: "Invoice" } });
  });
});

describe("appendStep", () => {
  const user = el("input", { name: "username" }, "", main);
  it("coalesces consecutive inputs on the same field", () => {
    let steps = appendStep([], buildStep({ event: "input", url: URL_LOGIN, target: user, value: "a" }, T0));
    steps = appendStep(steps, buildStep({ event: "input", url: URL_LOGIN, target: user, value: "ap" }, T0));
    steps = appendStep(steps, buildStep({ event: "input", url: URL_LOGIN, target: user, value: "ap.reviewer" }, T0));
    expect(steps).toHaveLength(1);
    expect(steps[0].detail.value).toBe("ap.reviewer");
  });
  it("drops a repeated navigate to the same url, keeps distinct ones", () => {
    let steps = appendStep([], buildStep({ event: "navigate", url: URL_LOGIN }, T0));
    steps = appendStep(steps, buildStep({ event: "navigate", url: URL_LOGIN }, T0));
    steps = appendStep(steps, buildStep({ event: "navigate", url: URL_INV }, T0));
    expect(steps.map((s) => s.detail.url)).toEqual([URL_LOGIN, URL_INV]);
  });
  it("does not mutate the input array", () => {
    const a: ReturnType<typeof appendStep> = [];
    appendStep(a, buildStep({ event: "navigate", url: URL_LOGIN }, T0));
    expect(a).toHaveLength(0);
  });
});

describe("toRecording", () => {
  function sampleSession(): Session {
    const s = newSession(T0);
    const pw = el("input", { name: "password", type: "password" }, "", main);
    const raw = [
      buildStep({ event: "navigate", url: URL_LOGIN, title: "Login" }, T0),
      buildStep({ event: "input", url: URL_LOGIN, title: "Login", target: el("input", { name: "username" }, "", main), value: "ap.reviewer" }, T0),
      buildStep({ event: "input", url: URL_LOGIN, title: "Login", target: pw, value: "demo-only" }, T0),
      buildStep({ event: "click", url: URL_LOGIN, title: "Login", target: el("button", { type: "submit" }, "Sign in", el("form", {}, undefined, main)) }, T0),
      buildNarrationStep("Billed hours must not exceed approved timecard hours.", { url: URL_INV, title: "Invoice" }, T0),
      buildStep({ event: "navigate", url: URL_INV, title: "Invoice HSG-1010" }, T0),
      buildNarrationStep("Open question: is overtime above 40h billable at 1.5x?", { url: URL_INV, title: "Invoice" }, T0),
    ];
    s.steps = raw.reduce(appendStep, s.steps);
    return s;
  }

  it("matches RecordingSchema exactly and builds the transcript from narration, in order", () => {
    const rec = toRecording(sampleSession());
    const parsed = RecordingSchema.parse(rec);
    expect(parsed.session_id).toMatch(/^rec_20261109T030000Z_[0-9a-z]{4}$/);
    expect(parsed.started_at).toBe(T0.toISOString());
    expect(parsed.steps).toHaveLength(7);
    expect(parsed.transcript).toEqual([
      "Billed hours must not exceed approved timecard hours.",
      "Open question: is overtime above 40h billable at 1.5x?",
    ]);
    expect(Object.keys(rec).sort()).toEqual(["session_id", "started_at", "steps", "transcript"]);
  });

  it("never contains the plaintext password", () => {
    const json = JSON.stringify(toRecording(sampleSession()));
    expect(json).not.toContain("demo-only");
    expect(json).toContain(REDACTED);
  });

  it("drops internal session fields (last_page)", () => {
    const s = sampleSession();
    s.last_page = { url: URL_INV, title: "x" };
    expect(toRecording(s)).not.toHaveProperty("last_page");
  });
});

describe("ids and misc", () => {
  it("session id and export filename", () => {
    expect(newSessionId(T0, () => 0)).toBe("rec_20261109T030000Z_0000");
    expect(exportFilename("rec_x")).toBe("recording-rec_x.json");
  });
  it("cleanText collapses whitespace", () => {
    expect(cleanText("  a \n\t b  ")).toBe("a b");
    expect(cleanText("x".repeat(200)).length).toBe(120);
  });
});

describe("committed artifacts", () => {
  const root = path.resolve(__dirname);
  it("manifest is MV3, localhost-only", () => {
    const m = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
    expect(m.manifest_version).toBe(3);
    expect(m.name).toBe("Ramp Teach Recorder (demo)");
    expect(m.host_permissions).toEqual(["http://localhost/*", "http://127.0.0.1/*"]);
    expect(m.content_scripts[0].matches).toEqual(["http://localhost/*", "http://127.0.0.1/*"]);
    expect(m.side_panel.default_path).toBe("sidepanel.html");
    for (const p of ["storage", "sidePanel", "activeTab", "scripting", "downloads", "tabs"]) expect(m.permissions).toContain(p);
  });

  const smoke = path.join(root, "recordings", "smoke.json");
  it.skipIf(!fs.existsSync(smoke))("recordings/smoke.json (captured by the real extension) validates", () => {
    const rec = RecordingSchema.parse(JSON.parse(fs.readFileSync(smoke, "utf8")));
    expect(rec.steps.length).toBeGreaterThan(5);
    expect(rec.transcript.length).toBeGreaterThan(0);
    const raw = fs.readFileSync(smoke, "utf8");
    expect(raw).not.toContain("demo-only");
    expect(rec.steps.some((s) => s.detail.value === REDACTED)).toBe(true);
    expect(rec.steps.some((s) => s.detail.selector === '[data-field="approved_hours"]' || s.detail.event === "navigate")).toBe(true);
  });
});

describe("voice helpers", () => {
  it("mergeTerms de-duplicates case-insensitively, drops junk and caps", () => {
    expect(mergeTerms(["HSG-1010"], ["hsg-1010", "Maya Chen", "x", 42, "  Approved   hours "])).toEqual(["HSG-1010", "Maya Chen", "Approved hours"]);
    expect(mergeTerms([], Array.from({ length: 500 }, (_, i) => `Term ${i}`)).length).toBe(MAX_PAGE_TERMS);
  });

  it("shortStepLabel prefers data-field / name, then text, then the URL's last segment", () => {
    const step = (detail: Record<string, string>) => ({ ts: T0.toISOString(), kind: "dom" as const, detail });
    expect(shortStepLabel(step({ event: "click", selector: '[data-field="approved_hours"]', text: "40" }))).toBe("approved_hours");
    expect(shortStepLabel(step({ event: "click", selector: "a > span", text: "View timecard" }))).toBe("View timecard");
    expect(shortStepLabel(step({ event: "navigate", url: URL_INV }))).toBe("HSG-1010");
  });

  it("applyWordEdit replaces one word, marks it confirmed and rebuilds the utterance", () => {
    const utts = [
      {
        id: "u1",
        text: "Sem is approved for 36.",
        start: 0,
        end: 2,
        step_refs: [3],
        low_confidence: ["Sem", "36."],
        words: [
          { text: "Sem", start: 0, end: 0.3, confidence: 0.3 },
          { text: "is", start: 0.3, end: 0.4, confidence: 0.99 },
          { text: "approved", start: 0.4, end: 0.9, confidence: 0.95 },
          { text: "for", start: 0.9, end: 1.0, confidence: 0.99 },
          { text: "36.", start: 1.0, end: 2, confidence: 0.45 },
        ],
      },
    ];
    const out = applyWordEdit(utts, 0, 0, " Sam ");
    expect(out[0].text).toBe("Sam is approved for 36.");
    expect(out[0].words[0]).toMatchObject({ text: "Sam", confidence: 1, start: 0 });
    expect(out[0].low_confidence).toEqual(["36."]);
    expect(out[0].step_refs).toEqual([3]);
    expect(utts[0].words[0].text).toBe("Sem"); // input not mutated
    expect(applyWordEdit(utts, 0, 0, "   ")[0]).toBe(utts[0]); // empty edit is ignored
  });

  it("clock formats m:ss", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(74.9)).toBe("1:14");
  });

  it("the side panel keeps the controls the film and the record:session driver use, and never says 'Simulated'", () => {
    const html = fs.readFileSync(path.join(__dirname, "sidepanel.html"), "utf8");
    for (const id of ["btn-start", "btn-stop", "btn-mic", "btn-send", "btn-export", "btn-clear", "btn-narrate", "narration", "status-text", "message", "steps", "step-count", "viz", "transcript"]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).not.toMatch(/simulat/i);
    // No user-facing string in the panel script mentions it either (the data value "simulated" is fine).
    const literals = fs.readFileSync(path.join(__dirname, "sidepanel.js"), "utf8").match(/"[^"\n]*"|`[^`\n]*`/g) ?? [];
    expect(literals.filter((s) => /simulat/i.test(s) && s !== '"simulated"')).toEqual([]);
  });
});
