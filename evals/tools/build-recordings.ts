/**
 * Builds the committed skill-eval recordings (evals/recordings/*.json) and cases (evals/cases/*.json).
 *
 * Every variant is HAND-AUTHORED from the primary capture (extension/recordings/portal-HSG-1010.json): the DOM steps
 * are the capture's own steps (some dropped, per variant), the narration text below is written by hand, and the
 * word-timed `speech` transcript is generated here (provider "simulated", mode "scripted": no audio, no speech model).
 * Gold answers are written by hand from what each recording says and shows.
 *
 *   npx tsx evals/tools/build-recordings.ts          rewrite the files
 *   npx tsx evals/tools/build-recordings.ts --check  exit 1 if a committed file differs from what this builds
 *
 * Never reads data/answer_key.json.
 */
import fs from "node:fs";
import path from "node:path";
import {
  RecordingSchema,
  SkillEvalCaseSchema,
  type CheckName,
  type Recording,
  type RecordingStep,
  type SpeechTranscript,
  type Utterance,
} from "@/contracts";
import { ROOT } from "@/lib/paths";

const PRIMARY = "extension/recordings/portal-HSG-1010.json";

/* ------------------------------ gold building blocks ------------------------------ */

const G = {
  rate: "Every labor line's hourly rate must equal the contract rate card rate for the employee's role.",
  duplicate: "No employee may be billed more than once for the same week.",
  charges: "Every non-labor charge must be on the contract's allowed list and must not exceed its cap.",
  lineAmounts: "Each line amount must equal quantity times unit rate.",
  total: "The invoice total must equal the sum of the line amounts.",
  hours:
    "For each labor line, compare the billed hours with the approved hours on that employee's portal timecard for the week; billed hours must not exceed approved hours.",
} as const;

const GOLD_CHECK: Record<keyof typeof G, CheckName> = {
  rate: "rate_matches_contract",
  duplicate: "no_duplicate_lines",
  charges: "no_unknown_charges",
  lineAmounts: "line_amounts_correct",
  total: "total_matches_line_items",
  hours: "hours_match_timecards",
};

const DECISION = "If any check fails, recommend dispute and ask the vendor for a credit memo; otherwise recommend approve.";

const PAGES_ALL = [
  "/portal/login",
  "/portal/invoices",
  "/portal/invoices/<invoice_id>",
  "/portal/employees/<employee_id>?week=<week_ending>",
];
const FIELDS_ALL = ["username", "password", "approved_hours"];

/* ------------------------------ variant scripts ------------------------------ */

/** ["dom", i] = the i-th DOM step of the primary capture; ["say", text] = a narration (hand-written). */
type Beat = ["dom", number] | ["say", string];

/** Primary-capture DOM indices (dom-only order): 0 nav login, 1-2 inputs, 3 click Sign in, 4 submit, 5 nav invoices,
 *  6 click HSG-1010, 7 nav invoice, then per employee k=0..3: click View timecard (8+4k), nav timecard (9+4k),
 *  click approved_hours (10+4k), nav back to invoice (11+4k). */
const LOGIN: Beat[] = [["dom", 1], ["dom", 2], ["dom", 3], ["dom", 4], ["dom", 5]];
const OPEN_INVOICE: Beat[] = [["dom", 6], ["dom", 7]];
const EMP = ["Maya Chen", "Jordan Alvarez", "Priya Natarajan", "Sam Okafor"];
const HRS = [40, 38, 40, 36];
const timecard = (k: number, said: string | null): Beat[] => {
  const b: Beat[] = [["dom", 8 + 4 * k], ["dom", 9 + 4 * k], ["dom", 10 + 4 * k]];
  if (said) b.push(["say", said]);
  b.push(["dom", 11 + 4 * k]);
  return b;
};
const primaryTimecardLine = (k: number) =>
  `${EMP[k]}'s approved timecard for week ending 2026-10-11 shows ${HRS[k]} hours. Billed hours must not exceed approved hours.`;

interface Variant {
  id: string;
  variant: string;
  description: string;
  beats: Beat[];
  gold: { rules: (keyof typeof G)[]; pages: string[]; fields: string[] };
  consistency_group: string | null;
  /** Word-level speech-to-text errors planted in speech.words / transcript: clean phrase -> heard phrase. */
  noise?: [string, string][];
  /** Override the clean reference text per narration (stt-noise writes numbers as spoken words). */
  spoken?: (text: string) => string;
}

const ALL_RULES: (keyof typeof G)[] = ["rate", "duplicate", "charges", "lineAmounts", "total", "hours"];

const variants: Variant[] = [
  {
    id: "baseline",
    variant: "baseline",
    description: "The primary capture's narration verbatim (rules said, timecards opened and approved hours clicked).",
    beats: [
      ["dom", 0],
      ["say", "I'm verifying invoice HSG-1010 against the vendor timecard portal. First I sign in."],
      ...LOGIN,
      [
        "say",
        "Rules I apply: every labor rate must equal the contract rate card; no employee may be billed twice for the same week; non-labor charges must be on the allowed list and under their cap; line amounts and the total must tie.",
      ],
      ...OPEN_INVOICE,
      ["say", "Now I open each employee's timecard for that week and compare billed hours to approved hours."],
      ...[0, 1, 2, 3].flatMap((k) => timecard(k, primaryTimecardLine(k))),
      ["say", "If any check fails I recommend dispute and ask the vendor for a credit memo; otherwise approve."],
      ["say", "Open question: is overtime above 40 hours a week billable at 1.5 times the rate?"],
    ],
    gold: { rules: ALL_RULES, pages: PAGES_ALL, fields: FIELDS_ALL },
    consistency_group: "pair-1",
  },
  {
    id: "paraphrase",
    variant: "consistency-paraphrase",
    description:
      "Same review as baseline in different, casual words (consistency pair with baseline). Same clicks.",
    beats: [
      ["dom", 0],
      ["say", "Okay, this is the Halcyon invoice, HSG-1010. I log into their portal first."],
      ...LOGIN,
      [
        "say",
        "What I look for: the hourly rate on each person has to be what the rate card in our contract says. Nobody gets billed two times for one week. Anything that isn't labor needs to be a charge the contract allows, and it can't go over the limit. And the math has to work, each line and the grand total.",
      ],
      ...OPEN_INVOICE,
      ["say", "Then for every person on the invoice I pull up their timecard for that week."],
      ...timecard(0, "Maya's approved for 40. You can't bill more hours than were approved."),
      ...timecard(1, "Jordan, 38 approved."),
      ...timecard(2, "Priya, 40."),
      ...timecard(3, "Sam is approved for 36."),
      ["say", "If something's wrong anywhere, I dispute it and ask them for a credit memo. If it's all clean, I approve."],
      ["say", "One thing I'm not sure about: do they get to bill overtime past 40 hours at time and a half?"],
    ],
    gold: { rules: ALL_RULES, pages: PAGES_ALL, fields: FIELDS_ALL },
    consistency_group: "pair-1",
  },
  {
    id: "reordered",
    variant: "reordered",
    description:
      "Baseline rules and clicks, narration in a different order: decision rule first, hours rule before the rate card rules, rate card rules last.",
    beats: [
      ["dom", 0],
      [
        "say",
        "Whenever a check fails on one of these I recommend dispute and ask the vendor for a credit memo; when everything passes I approve. Let me sign in.",
      ],
      ...LOGIN,
      ["say", "I'll do the timecards first: billed hours must not exceed the approved hours on each timecard."],
      ...OPEN_INVOICE,
      ...[0, 1, 2, 3].flatMap((k) =>
        timecard(k, `${EMP[k]} is approved for ${HRS[k]} hours for week ending 2026-10-11.`),
      ),
      [
        "say",
        "Now the invoice itself. Line amounts and the total must tie. Non-labor charges must be on the allowed list and under their cap. No employee may be billed twice for the same week. And every labor rate must equal the contract rate card.",
      ],
      ["say", "Open question: is overtime above 40 hours a week billable at 1.5 times the rate?"],
    ],
    gold: { rules: ALL_RULES, pages: PAGES_ALL, fields: FIELDS_ALL },
    consistency_group: null,
  },
  {
    id: "shown-not-said",
    variant: "shown-not-said",
    description:
      "The reviewer opens each timecard and clicks the approved hours, but never says what the hours are compared with (the cap is shown, never spoken).",
    beats: [
      ["dom", 0],
      ["say", "I'm verifying invoice HSG-1010 against the vendor timecard portal. First I sign in."],
      ...LOGIN,
      [
        "say",
        "Rules I apply: every labor rate must equal the contract rate card; no employee may be billed twice for the same week; non-labor charges must be on the allowed list and under their cap; line amounts and the total must tie.",
      ],
      ...OPEN_INVOICE,
      ["say", "Next, the timecards."],
      ...timecard(0, null),
      ...timecard(1, null),
      ...timecard(2, null),
      ...timecard(3, null),
      ["say", "If any check fails I recommend dispute and ask the vendor for a credit memo; otherwise approve."],
    ],
    gold: { rules: ALL_RULES, pages: PAGES_ALL, fields: FIELDS_ALL },
    consistency_group: null,
  },
  {
    id: "said-not-shown",
    variant: "said-not-shown",
    description:
      "The reviewer states the hours rule but never opens a timecard (no timecard page, no approved-hours click).",
    beats: [
      ["dom", 0],
      ["say", "I'm verifying invoice HSG-1010 against the vendor timecard portal. First I sign in."],
      ...LOGIN,
      [
        "say",
        "Rules I apply: every labor rate must equal the contract rate card; no employee may be billed twice for the same week; non-labor charges must be on the allowed list and under their cap; line amounts and the total must tie.",
      ],
      ...OPEN_INVOICE,
      [
        "say",
        "Billed hours must not exceed the approved hours on each employee's timecard for that week. I'm not opening the timecards in this recording.",
      ],
      ["say", "If any check fails I recommend dispute and ask the vendor for a credit memo; otherwise approve."],
    ],
    gold: {
      rules: ALL_RULES,
      pages: ["/portal/login", "/portal/invoices", "/portal/invoices/<invoice_id>"],
      fields: ["username", "password"],
    },
    consistency_group: null,
  },
  {
    id: "filler",
    variant: "filler-talk",
    description:
      "Baseline rules buried in filler and small talk, including remarks that sound like rules but are not (overtime grumbling, timing habits).",
    beats: [
      ["dom", 0],
      ["say", "Okay, um, so. Morning. Coffee first, then this. Let me, uh, sign into the portal, it's always slow."],
      ...LOGIN,
      ["say", "Right. I usually do these on Monday mornings, just habit."],
      [
        "say",
        "So, the rules. Every labor rate must equal the contract rate card. Um, no employee may be billed twice for the same week. Non-labor charges must be on the allowed list and under their cap. And line amounts and the total must tie.",
      ],
      ...OPEN_INVOICE,
      ["say", "This vendor is honestly kind of chatty on email. Anyway. Timecards."],
      ...timecard(0, "Maya, 40 approved. Billed hours must not exceed approved hours."),
      ...timecard(1, "Jordan, 38. Hmm, the page took forever."),
      ...timecard(2, "Priya, 40. Last quarter they had a lot of overtime, I didn't love it."),
      ...timecard(3, "Sam, 36. Okay."),
      ["say", "If any check fails I recommend dispute and ask the vendor for a credit memo; otherwise approve. Done, more coffee."],
    ],
    gold: { rules: ALL_RULES, pages: PAGES_ALL, fields: FIELDS_ALL },
    consistency_group: null,
  },
  {
    id: "step-skipped",
    variant: "step-skipped",
    description:
      "The reviewer skips the arithmetic tie-out: line amounts and the total are never mentioned or checked. A correct skill must not add them.",
    beats: [
      ["dom", 0],
      ["say", "I'm verifying invoice HSG-1010 against the vendor timecard portal. First I sign in."],
      ...LOGIN,
      [
        "say",
        "Rules I apply: every labor rate must equal the contract rate card; no employee may be billed twice for the same week; non-labor charges must be on the allowed list and under their cap.",
      ],
      ...OPEN_INVOICE,
      ["say", "Now I open each employee's timecard for that week and compare billed hours to approved hours."],
      ...[0, 1, 2, 3].flatMap((k) => timecard(k, primaryTimecardLine(k))),
      ["say", "If any check fails I recommend dispute and ask the vendor for a credit memo; otherwise approve."],
    ],
    gold: { rules: ["rate", "duplicate", "charges", "hours"], pages: PAGES_ALL, fields: FIELDS_ALL },
    consistency_group: null,
  },
  {
    id: "stt-noise",
    variant: "stt-noise",
    description:
      "Baseline review with planted speech-to-text errors in speech.words and the transcript (e.g. 'forty' heard as 'for tea', misspelled names). Rules must come out clean.",
    beats: [
      ["dom", 0],
      ["say", "I'm verifying invoice HSG-1010 against the vendor timecard portal. First I sign in."],
      ...LOGIN,
      [
        "say",
        "Rules I apply: every labor rate must equal the contract rate card; no employee may be billed twice for the same week; non-labor charges must be on the allowed list and under their cap; line amounts and the total must tie.",
      ],
      ...OPEN_INVOICE,
      ["say", "Now I open each employee's timecard for that week and compare billed hours to approved hours."],
      ...[0, 1, 2, 3].flatMap((k) =>
        timecard(
          k,
          `${EMP[k]}'s approved timecard shows ${["forty", "thirty eight", "forty", "thirty six"][k]} hours. Billed hours must not exceed approved hours.`,
        ),
      ),
      ["say", "If any check fails I recommend dispute and ask the vendor for a credit memo; otherwise approve."],
    ],
    gold: { rules: ALL_RULES, pages: PAGES_ALL, fields: FIELDS_ALL },
    consistency_group: null,
    noise: [
      ["HSG-1010", "HSG 10 10"],
      ["rate card", "rate cart"],
      ["billed twice", "build twice"],
      ["Maya Chen's", "Maya Chan's"],
      ["Jordan Alvarez's", "Jordan Alvarus"],
      ["Priya Natarajan's", "Pria Natara john's"],
      ["Sam Okafor's", "Sam Oh Kafor's"],
      ["forty hours", "for tea hours"],
    ],
  },
];

/* --------------------------------- building --------------------------------- */

const KEYTERMS = [
  "HSG-1010",
  "Halcyon",
  "Maya Chen",
  "Jordan Alvarez",
  "Priya Natarajan",
  "Sam Okafor",
  "rate card",
  "timecard",
  "approved hours",
  "credit memo",
];

const SEC_PER_WORD = 0.32;

function words(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/** Apply planted errors phrase by phrase (case-sensitive, every occurrence). Returns heard text + the heard words that are errors. */
function applyNoise(text: string, noise: [string, string][] | undefined): { heard: string; bad: Set<string> } {
  let heard = text;
  const bad = new Set<string>();
  for (const [clean, wrong] of noise ?? []) {
    if (clean === wrong || !heard.includes(clean)) continue;
    heard = heard.split(clean).join(wrong);
    const cw = new Set(words(clean));
    for (const w of words(wrong)) if (!cw.has(w)) bad.add(w);
  }
  return { heard, bad };
}

function build(v: Variant, primary: Recording) {
  const dom = primary.steps.filter((s) => s.kind === "dom");
  const t0 = Date.parse(primary.started_at);
  let t = 0.017; // seconds from start
  const steps: RecordingStep[] = [];
  const utterances: Utterance[] = [];
  const reference: string[] = [];
  let url = dom[0].detail.url ?? "";
  let title = dom[0].detail.title ?? "";
  const iso = (s: number) => new Date(t0 + Math.round(s * 1000)).toISOString();

  for (const beat of v.beats) {
    if (beat[0] === "dom") {
      const src = dom[beat[1]];
      if (!src) throw new Error(`${v.id}: no DOM step ${beat[1]} in the primary capture`);
      steps.push({ ts: iso(t), kind: "dom", detail: { ...src.detail } });
      if (src.detail.event === "navigate") {
        url = src.detail.url ?? url;
        title = src.detail.title ?? title;
      }
      t += 0.65;
      continue;
    }
    const clean = beat[1];
    const { heard, bad } = applyNoise(clean, v.noise);
    reference.push(clean);
    const ws = words(heard);
    const start = t;
    const speechWords = ws.map((w, i) => {
      const s = Number((start + i * SEC_PER_WORD).toFixed(3));
      return {
        text: w,
        start: s,
        end: Number((s + SEC_PER_WORD * 0.85).toFixed(3)),
        confidence: bad.has(w) ? 0.41 : 0.97,
      };
    });
    const end = Number((start + ws.length * SEC_PER_WORD).toFixed(3));
    const stepIndex = steps.length;
    steps.push({ ts: iso(start), kind: "narration", detail: { event: "narration", url, title, text: heard } });
    // speech <-> click alignment: dom steps (not navigations) on the same page right before this utterance.
    const refs: number[] = [];
    for (let i = stepIndex - 1; i >= 0; i--) {
      const s = steps[i];
      if (s.kind === "narration") break;
      if (s.detail.event === "navigate") {
        if (s.detail.url !== url) break;
        continue;
      }
      if (s.detail.url === url) refs.unshift(i);
    }
    utterances.push({
      id: `u${utterances.length + 1}`,
      text: heard,
      start: Number(start.toFixed(3)),
      end,
      words: speechWords,
      step_refs: refs,
      low_confidence: [...new Set(speechWords.filter((w) => bad.has(w.text)).map((w) => w.text))],
    });
    t = end + 0.45;
  }

  const speech: SpeechTranscript = {
    provider: "simulated",
    model: null,
    mode: "scripted",
    language: "en",
    keyterms: KEYTERMS,
    utterances,
    request_id: null,
  };
  const recording = {
    session_id: `rec_eval_${v.id.replace(/-/g, "_")}`,
    started_at: primary.started_at,
    steps,
    transcript: utterances.map((u) => u.text),
    speech,
    provenance: {
      capture: "hand_authored_fixture",
      operator: "synthetic",
      derived_from: PRIMARY,
      variant: v.variant,
      note: `Hand-authored variant of the primary capture (${PRIMARY}): DOM steps copied from it, narration written by hand, speech word timings generated by evals/tools/build-recordings.ts (no audio, no speech model).`,
    },
  };
  RecordingSchema.parse(recording);

  const goldRules = v.gold.rules.map((k) => G[k]);
  const evalCase = {
    id: v.id,
    variant: v.variant,
    recording_path: `evals/recordings/${v.id}.json`,
    reference_transcript: reference.join(" "),
    gold: { rules: goldRules, pages: v.gold.pages, fields: v.gold.fields, decision_rule: DECISION },
    // ---- extra fields (read by lib/evals/cases.ts; ignored by SkillEvalCaseSchema) ----
    description: v.description,
    gold_checks: v.gold.rules.map((k) => GOLD_CHECK[k]),
    consistency_group: v.consistency_group,
    provenance: {
      kind: "hand_authored_variant",
      derived_from: PRIMARY,
      note: "Hand-authored variant of the primary capture. Gold rules, pages and fields written by hand from what this recording says and shows. Not a real voice capture.",
    },
  };
  SkillEvalCaseSchema.parse(evalCase);
  return { recording, evalCase };
}

function main() {
  const check = process.argv.includes("--check");
  const primary = RecordingSchema.parse(JSON.parse(fs.readFileSync(path.join(ROOT, PRIMARY), "utf8")));
  let diffs = 0;
  for (const v of variants) {
    const { recording, evalCase } = build(v, primary);
    for (const [file, data] of [
      [path.join(ROOT, "evals", "recordings", `${v.id}.json`), recording],
      [path.join(ROOT, "evals", "cases", `${v.id}.json`), evalCase],
    ] as const) {
      const text = JSON.stringify(data, null, 2) + "\n";
      if (check) {
        if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== text) {
          console.log(`differs: ${path.relative(ROOT, file)}`);
          diffs++;
        }
      } else {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
        console.log(`wrote ${path.relative(ROOT, file)}`);
      }
    }
  }
  if (check && diffs) process.exit(1);
}

main();
