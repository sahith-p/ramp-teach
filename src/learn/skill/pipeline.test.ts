import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RecordingSchema, SkillVersionSchema, TraceEventSchema } from "@/contracts";
import { runCalc } from "@/calc";
import { invoicePathFor, loadPastInvoices, loadTimecards, loadVendor } from "@/lib/data";
import { fakeClient, message } from "./__fixtures__/fake-client";
import { buildStepsDoc, buildTranscriptDoc } from "./citations";
import { CHECKS_SYSTEM, RESULT_MARKER } from "./checks";
import { CRITIQUE_SYSTEM } from "./critique";
import { learnSkillWith, STAGE_NAMES, type StageEvent } from "./index";
import { segment } from "./segment";
import { SYNTH_SYSTEM } from "./synthesize";

const portal = RecordingSchema.parse(JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../extension/recordings/portal-HSG-1010.json"), "utf8")));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ramp-skill-test-"));
const readTrace = (f: string) => fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => TraceEventSchema.parse(JSON.parse(l)));

describe("learnSkill offline", () => {
  it("runs every stage without a model, labels them, and writes a draft package", async () => {
    const outDir = tmp();
    const traceFile = path.join(outDir, "trace.jsonl");
    const events: StageEvent[] = [];
    const skill = await learnSkillWith(portal, { offline: true, outDir, traceFile, onStage: (e) => events.push(e) });
    expect(SkillVersionSchema.parse(skill)).toBeTruthy();
    expect(skill).toMatchObject({ skill_id: "halcyon-invoice-review", version: 1, mode: "deterministic", status: "draft", anthropic_skill: null, eval_run_id: null, recordings: [portal.session_id] });
    expect(skill.stages.map((s) => s.name)).toEqual(STAGE_NAMES);
    expect(skill.stages.every((s) => s.mode === "deterministic" && s.model === null)).toBe(true);
    expect(skill.rules.length).toBeGreaterThan(3);
    expect(skill.rules.every((r) => r.citations.length > 0)).toBe(true);
    expect(skill.checks).toEqual([]);

    const pkg = path.join(outDir, "halcyon-invoice-review", "v1");
    for (const f of ["SKILL.md", "skill.json", ...STAGE_NAMES.map((s) => `stages/${s}.json`)]) expect(fs.existsSync(path.join(pkg, f))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(pkg, "stages", "checks.json"), "utf8"))).toMatchObject({ skipped: true, authoritative: "calc" });
    expect(JSON.parse(fs.readFileSync(path.join(pkg, "stages", "package.json"), "utf8")).upload_skipped).toMatch(/offline/);
    expect(fs.readFileSync(path.join(pkg, "SKILL.md"), "utf8")).toMatch(/^---\nname: halcyon-invoice-review\n/);

    expect(events.filter((e) => e.status === "running").map((e) => e.name)).toEqual(STAGE_NAMES);
    expect(events.find((e) => e.name === "checks" && e.status !== "running")!.status).toBe("skipped");
    const tr = readTrace(traceFile);
    expect(tr.every((e) => e.stage === "learn" && e.mode === "deterministic")).toBe(true);
    expect(tr.map((e) => e.step)).toContain("skill.synthesize");
  });

  it("numbers versions under the skill folder", async () => {
    const outDir = tmp();
    await learnSkillWith(portal, { offline: true, outDir, traceFile: null });
    const v2 = await learnSkillWith(portal, { offline: true, outDir, traceFile: null });
    expect(v2.version).toBe(2);
    expect(v2.package_dir.endsWith(path.join("halcyon-invoice-review", "v2"))).toBe(true);
  });

  it("persist:false learns into a temp dir", async () => {
    const s = await learnSkillWith(portal, { offline: true, persist: false, traceFile: null });
    expect(s.package_dir.startsWith(os.tmpdir())).toBe(true);
  });
});

/* ------------------------------ real path, fake client ------------------------------ */

const seg = segment(portal);
const tdoc = buildTranscriptDoc(seg);
const at = (doc: string, phrase: string, idx: number) => {
  const s = doc.indexOf(phrase);
  return { type: "char_location", cited_text: phrase, document_index: idx, document_title: null, start_char_index: s, end_char_index: s + phrase.length, file_id: null };
};

const synthOut = {
  title: "Halcyon Staffing invoice review",
  vendor: "Not stated in recording",
  rules: [
    { text: "Every labor rate must equal the contract rate card.", kind: "check", source: "said", citations: [{ utterance_id: "u2", quote: "every labor rate must equal the contract rate card", step_index: null }] },
    { text: "Line amounts and the total must tie.", kind: "check", source: "said", citations: [{ utterance_id: "u2", quote: "line amounts and the total must tie", step_index: null }] },
    { text: "Billed hours must not exceed approved hours.", kind: "check", source: "said", citations: [{ utterance_id: "u4", quote: "Billed hours must not exceed approved hours", step_index: 13 }] },
    { text: "Overtime is paid at double rate.", kind: "check", source: "said", citations: [] },
    { text: "If any check fails, recommend dispute and ask for a credit memo; otherwise approve.", kind: "decision", source: "said", citations: [{ utterance_id: "u8", quote: "If any check fails I recommend dispute and ask the vendor for a credit memo; otherwise approve", step_index: null }] },
  ],
  portal_map: [{ page: "/portal/employees/<employee_id>?week=<YYYY-MM-DD>", fields: [{ name: "approved_hours", selector: '[data-field="approved_hours"]' }] }],
  open_questions: ["Is overtime above 40 hours a week billable at 1.5 times the rate?"],
};

const SCRIPT = `def check(invoice, vendor, timecards):\n    return {"result": "pass", "failing_lines": []}\n`;

/** Sandbox stub: answers what calc/ answers (so agreement is 1). */
function sandboxStdout(): string {
  const vendor = loadVendor();
  const timecards = loadTimecards();
  const rows = loadPastInvoices().flatMap((invoice) => {
    const rep = runCalc({ invoice, vendor, timecards, invoicePath: invoicePathFor(invoice.invoice_id)! });
    return ["line_amounts_correct", "total_matches_line_items"].map((check) => {
      const c = rep.checks.find((x) => x.check === check)!;
      const lines = [...new Set(c.findings.map((f) => f.line_index).filter((x) => x !== null))].sort();
      return { check, invoice_id: invoice.invoice_id, result: c.result, failing_lines: lines };
    });
  });
  return `${RESULT_MARKER}${JSON.stringify(rows)}\n`;
}

function realClient(opts: { failSynth?: boolean } = {}) {
  return fakeClient({
    create: (params) => {
      if (params.tools) {
        return message({ content: [{ type: "bash_code_execution_tool_result", tool_use_id: "s1", content: { type: "bash_code_execution_result", stdout: sandboxStdout(), stderr: "", return_code: 0, content: [] } }], container: { id: "cntr_9" } });
      }
      return message({
        content: [
          { type: "text", text: "- Rates must match the rate card: ", citations: null },
          { type: "text", text: "every labor rate must equal the contract rate card", citations: [at(tdoc.text, "every labor rate must equal the contract rate card", 0)] },
          { type: "text", text: "\n- Decide dispute or approve.", citations: [at(tdoc.text, "otherwise approve", 0)] },
        ],
      });
    },
    parse: (params) => {
      const sys = params.system as string;
      if (sys === SYNTH_SYSTEM) {
        if (opts.failSynth) return message({ stop_reason: "refusal", stop_details: { category: null } });
        return message({ parsed_output: synthOut });
      }
      if (sys === CRITIQUE_SYSTEM) return message({ parsed_output: { verdicts: [{ rule_id: "r1", verdict: "supported", reason: "u2" }], gaps: ["What if a timecard is missing?"] } });
      if (sys === CHECKS_SYSTEM)
        return message({
          parsed_output: {
            scripts: [
              { check: "line_amounts_correct", rule_ids: ["r2"], code: SCRIPT },
              { check: "total_matches_line_items", rule_ids: ["r2"], code: SCRIPT },
            ],
          },
        });
      throw new Error("unexpected parse call");
    },
  });
}

describe("learnSkill real path (fake Anthropic client)", () => {
  it("runs all six stages, records request ids, compares checks with calc/, and uploads", async () => {
    const outDir = tmp();
    const traceFile = path.join(outDir, "trace.jsonl");
    const client = realClient();
    const skill = await learnSkillWith(portal, { client, outDir, traceFile, noCache: true });

    expect(skill.mode).toBe("real");
    expect(Object.fromEntries(skill.stages.map((s) => [s.name, s.mode]))).toEqual({
      segment: "deterministic",
      claims: "real",
      synthesize: "real",
      critique: "real",
      checks: "real",
      package: "deterministic",
    });
    for (const s of skill.stages.filter((x) => x.mode === "real")) {
      expect(s.model).toBe("claude-opus-5-5");
      expect(s.request_id).toMatch(/^req_fake_/);
      expect(s.usage).toMatchObject({ input_tokens: 100, cache_hit: false });
    }
    // Uncited rule dropped by critique; gap added as open question.
    expect(skill.rules.map((r) => r.text)).not.toContain("Overtime is paid at double rate.");
    expect(skill.rules.map((r) => r.id)).toEqual(["r1", "r2", "r3", "r4"]);
    expect(skill.open_questions).toContain("What if a timecard is missing?");
    expect(skill.rules[2].citations[0]).toMatchObject({ utterance_id: "u4", step_index: 13, selector: '[data-field="approved_hours"]' });

    const pkg = path.join(outDir, "halcyon-invoice-review", "v1");
    const claims = JSON.parse(fs.readFileSync(path.join(pkg, "stages", "claims.json"), "utf8"));
    expect(claims.claims[0].citations[0]).toMatchObject({ utterance_id: "u2", quote: "every labor rate must equal the contract rate card" });
    expect(claims.claims[1].citations[0].utterance_id).toBe("u8");

    const checks = JSON.parse(fs.readFileSync(path.join(pkg, "stages", "checks.json"), "utf8"));
    expect(checks.authoritative).toBe("calc");
    expect(checks.sandbox).toMatchObject({ tool: "code_execution_20260521", container_id: "cntr_9" });
    expect(checks.agreement.map((a: { check: string; agreement: number }) => [a.check, a.agreement])).toEqual([
      ["line_amounts_correct", 1],
      ["total_matches_line_items", 1],
    ]);
    expect(skill.checks.map((c) => c.name)).toEqual(["line_amounts_correct", "total_matches_line_items"]);
    expect(fs.readFileSync(path.join(pkg, "checks", "line_amounts_correct.py"), "utf8")).toContain("calc/ is authoritative");
    expect(client.deleted).toHaveLength(1); // the sandbox runner file

    expect(skill.anthropic_skill).toEqual({ id: "skill_fake_1", version: "skv_fake_1" });
    expect(client.calls.find((c) => c.method === "skills.create")).toBeTruthy();
    const md = fs.readFileSync(path.join(pkg, "SKILL.md"), "utf8");
    expect(md).toContain("`checks/line_amounts_correct.py`");

    const tr = readTrace(traceFile);
    expect(tr.find((e) => e.step === "skill.claims")!.mode).toBe("real");
    expect(tr.find((e) => e.step === "skill.claims")!.detail.request_id).toMatch(/^req_fake_/);

    // Second version uploads as a new version of the same Anthropic skill.
    const v2 = await learnSkillWith(portal, { client, outDir, traceFile: null, noCache: true, checks: false });
    expect(v2.anthropic_skill).toEqual({ id: "skill_fake_1", version: "skv_fake_2" });
    expect(v2.stages.find((s) => s.name === "checks")!.mode).toBe("deterministic");
  });

  it("falls back to the deterministic distiller when synthesis is refused, and labels it", async () => {
    const outDir = tmp();
    const skill = await learnSkillWith(portal, { client: realClient({ failSynth: true }), outDir, traceFile: null, noCache: true, checks: false, persist: true });
    expect(skill.mode).toBe("deterministic");
    const modes = Object.fromEntries(skill.stages.map((s) => [s.name, s.mode]));
    expect(modes).toMatchObject({ claims: "real", synthesize: "deterministic", critique: "deterministic" });
    const synth = JSON.parse(fs.readFileSync(path.join(outDir, "halcyon-invoice-review", "v1", "stages", "synthesize.json"), "utf8"));
    expect(synth.fallback_reason).toMatch(/declined/);
  });

  it("does not upload when not persisted", async () => {
    const client = realClient();
    const s = await learnSkillWith(portal, { client, persist: false, traceFile: null, noCache: true, checks: false });
    expect(s.anthropic_skill).toBeNull();
    expect(client.calls.some((c) => c.method.startsWith("skills."))).toBe(false);
  });
});
