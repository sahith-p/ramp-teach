/**
 * LEARN definition for the invoice-review workflow (owned by learn-builder, T-20).
 * Shape of WorkflowDefinition.learn (contracts/engine.ts). Wired into the engine by
 * workflows/invoice-review/index.ts (agent lane) and learn/cli.ts.
 *
 * Invoice-specific knowledge lives HERE (distillHints, field hints, vendor pattern); the generic
 * extraction logic lives in learn/deterministic.ts so the engine stays reusable.
 */
import {
  WorkflowSpecSchema,
  type Recording,
  type RecordingProvenance,
  type WorkflowDefinition,
  type WorkflowSpec,
} from "@/contracts";
import {
  extractOpenQuestions,
  extractProofSources,
  extractRules,
  firstMatch,
  narrations,
} from "@/learn/deterministic";

/** Domain hints appended to the distiller prompt (real mode). Never contains answers or planted errors. */
export const distillHints = `Domain: accounts-payable review of service (staffing) invoices.
The demonstrator is an AP specialist verifying one vendor invoice before it is paid. Labor lines read
"Labor: <Employee Name> (<Role>) - week ending YYYY-MM-DD" with quantity = hours and unit_rate = hourly bill rate;
any other line is a non-labor charge.

What the spec is used for: an agent will re-run this review on NEW invoices from the same vendor. A deterministic
calculator runs six checks (line amount = hours x rate; line amounts sum to the invoice total; labor rate equals the
contract rate card for the role; no employee billed twice for the same week; every non-labor charge is on the
contract's allowed list and within its cap; billed hours <= approved timecard hours for that employee and week).
A browser agent gathers approved timecard hours from the vendor portal pages the demonstrator visited.

Guidance:
- vendor: the vendor's name exactly as the demonstrator says or as a captured page shows it. If the recording never
  states it, return exactly "Not stated in recording". Never guess or infer a vendor name.
- rules: one self-contained, checkable sentence per rule, carrying the concrete values the demonstrator stated
  (rates per role, allowed charges and caps). Phrase them so each maps onto one of the six checks above. Also
  include the decision rule (what happens when any check fails) and any interim policy stated alongside an open
  question (prefix it "Until resolved:"). Do not state facts about the specific invoice being reviewed
  (e.g. "Maya billed 40 hours") as rules.
- proof_sources: one entry per place evidence is read. app = the application name (from page titles);
  location = a URL path template on the local fixture app with placeholders, e.g. "/portal/invoices/<invoice_id>",
  "/portal/employees/<employee_id>?week=<YYYY-MM-DD>"; fields = the field names read there (timecard pages expose
  data-field markers such as approved_hours). Skip the login page. If the rules rely on the vendor contract (rate
  card, allowed charges), include it as app "Vendor contract", location "data/vendor.json#contract".
- open_questions: questions the demonstrator left unresolved, one per entry, in plain words.`;

/** Fields known to live at fixture locations (docs/lane-spec.md §2), merged after the observed ones. */
const FIELD_HINTS: Record<string, string[]> = {
  "/portal/invoices": ["invoice_id", "week_ending", "total"],
  "/portal/invoices/<invoice_id>": ["line_items.description", "line_items.quantity", "line_items.unit_rate", "line_items.amount", "total"],
  "/portal/employees/<employee_id>?week=<YYYY-MM-DD>": [
    "approved_hours",
    "employee_id",
    "employee_name",
    "role",
    "week_ending",
    "status",
    "approved_by",
  ],
};

const VENDOR_PATTERN = /\bverifying\s+(?!invoice\b)(.+?)\s+invoice\b/i;
export const VENDOR_NOT_STATED = "Not stated in recording";
const CONTRACT_MENTION = /\b(rate card|contract|allowed list|allowed charges?)\b/i;

/**
 * Deterministic (no-LLM) distillation: Recording -> WorkflowSpec. Mode label: deterministic.
 * Proof sources from DOM steps (URL templates, page titles, data-field markers), rules and open
 * questions from narration, plus the vendor contract when the narration relies on it.
 */
export function deterministicDistill(recording: Recording): WorkflowSpec {
  const vendor = firstMatch(recording, VENDOR_PATTERN) ?? VENDOR_NOT_STATED;
  const proof_sources = extractProofSources(recording, { fieldHints: FIELD_HINTS });
  if (narrations(recording).some((t) => CONTRACT_MENTION.test(t))) {
    proof_sources.push({ app: "Vendor contract", location: "data/vendor.json#contract", fields: ["rate_card", "allowed_charges"] });
  }
  return WorkflowSpecSchema.parse({
    vendor,
    proof_sources,
    rules: extractRules(recording),
    open_questions: extractOpenQuestions(recording),
  });
}

/**
 * LEARN inputs, in priority order. RECORD → LEARN is connected through the PRIMARY entry: the Recording
 * the MV3 extension captured on the real fixture portal. The seeded sample stays as a labeled FALLBACK
 * fixture only (used when the capture is missing, and by unit tests); it is never renamed or copied over.
 */
export const invoiceReviewRecordings: { path: string; provenance: Omit<RecordingProvenance, "session_id"> }[] = [
  {
    path: "extension/recordings/portal-HSG-1010.json",
    provenance: {
      capture: "mv3_extension",
      operator: "scripted_playwright",
      role: "primary",
      note:
        "Captured by the unpacked Ramp Teach Recorder (MV3 extension: content script + side panel) on the real fixture " +
        "portal at http://localhost:3000, reviewing past invoice HSG-1010. The session was PERFORMED by a scripted " +
        "Playwright operator (extension/scripts/record-session.ts), not a human: its clicks and narration lines are " +
        "fixed in that script. A genuinely human-recorded session is still outstanding.",
    },
  },
  {
    path: "data/recording.sample.json",
    provenance: {
      capture: "hand_authored_fixture",
      operator: "synthetic",
      role: "fallback_fixture",
      note:
        "Seeded sample written by the data lane (T-10) before the extension existed, so LEARN never blocked on RECORD. " +
        "Fallback fixture only: used when the extension capture is missing, and by unit tests.",
    },
  },
];

export const invoiceReviewLearn: WorkflowDefinition["learn"] = {
  recordingPath: invoiceReviewRecordings[0].path,
  specPath: "rules/workflow_spec.json",
  distillHints,
  deterministicDistill,
};
