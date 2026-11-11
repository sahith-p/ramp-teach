import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { invoicePathFor, loadPastInvoices, loadTimecards, loadVendor } from "@/lib/data";
import { fakeClient, message } from "./__fixtures__/fake-client";
import { buildRunner, compareWithCalc, RESULT_MARKER, runInSandbox, sandboxRowsFromContent, writeCheckScripts } from "./checks";

const hasPython = (() => {
  try {
    execFileSync("python3", ["--version"]);
    return true;
  } catch {
    return false;
  }
})();

const LINE_OK = `
def check(invoice, vendor, timecards):
    bad = [i for i, li in enumerate(invoice["line_items"]) if abs(round(li["quantity"] * li["unit_rate"], 2) - round(li["amount"], 2)) > 0.005]
    return {"result": "fail" if bad else "pass", "failing_lines": bad}
`;
const TOTAL_OK = `
def check(invoice, vendor, timecards):
    s = round(sum(li["amount"] for li in invoice["line_items"]), 2)
    return {"result": "pass" if abs(s - round(invoice["total"], 2)) < 0.005 else "fail", "failing_lines": []}
`;
const TOTAL_WRONG = `
def check(invoice, vendor, timecards):
    return {"result": "pass", "failing_lines": []}
`;

const invoices = loadPastInvoices().map((invoice) => ({ invoice, path: invoicePathFor(invoice.invoice_id)! }));
const vendor = loadVendor();
const timecards = loadTimecards();

/** Run the runner the way the sandbox would (locally, for the test). */
function runLocally(runner: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ramp-runner-"));
  const f = path.join(dir, "ramp_skill_checks.py");
  fs.writeFileSync(f, runner);
  return execFileSync("python3", ["-I", f], { encoding: "utf8" });
}

const bashResult = (stdout: string) => ({
  type: "bash_code_execution_tool_result",
  tool_use_id: "srvtoolu_1",
  content: { type: "bash_code_execution_result", stdout, stderr: "", return_code: 0, content: [] },
});

describe("checks stage", () => {
  it.skipIf(!hasPython)("runner executes Claude-written scripts and agrees with calc/ when they are right", () => {
    const runner = buildRunner({ invoices: invoices.map((i) => i.invoice), vendor, timecards, scripts: [{ check: "line_amounts_correct", code: LINE_OK }, { check: "total_matches_line_items", code: TOTAL_OK }] });
    const rows = sandboxRowsFromContent([bashResult(runLocally(runner))])!;
    expect(rows).toHaveLength(invoices.length * 2);
    const agreement = compareWithCalc(
      rows,
      [
        { check: "line_amounts_correct", rule_ids: ["r4"], file: "checks/line_amounts_correct.py" },
        { check: "total_matches_line_items", rule_ids: ["r4"], file: null },
      ],
      invoices,
      vendor,
      timecards,
    );
    for (const a of agreement) {
      expect(a.disagreements).toEqual([]);
      expect(a.agreement).toBe(1);
      expect(a.invoices).toBe(invoices.length);
    }
  });

  it.skipIf(!hasPython)("records disagreements and script errors per invoice", () => {
    const runner = buildRunner({ invoices: invoices.map((i) => i.invoice), vendor, timecards, scripts: [{ check: "total_matches_line_items", code: TOTAL_WRONG }, { check: "no_unknown_charges", code: "def check(:" }] });
    const rows = sandboxRowsFromContent([bashResult(runLocally(runner))])!;
    const [total, unknown] = compareWithCalc(
      rows,
      [
        { check: "total_matches_line_items", rule_ids: [], file: null },
        { check: "no_unknown_charges", rule_ids: [], file: null },
      ],
      invoices,
      vendor,
      timecards,
    );
    expect(unknown.agree).toBe(0);
    expect(unknown.disagreements[0].sandbox).toMatch(/^error: load/);
    // "always pass" disagrees exactly where calc finds a total mismatch.
    expect(total.agree + total.disagreements.length).toBe(invoices.length);
    for (const d of total.disagreements) expect(d.calc).toBe("fail");
  });

  it("finds the result line in bash output, ignores other blocks", () => {
    expect(sandboxRowsFromContent([{ type: "text", text: "done" }])).toBeNull();
    expect(sandboxRowsFromContent([bashResult(`noise\n${RESULT_MARKER}[{"check":"x","invoice_id":"A","result":"pass","failing_lines":[]}]\n`)])).toEqual([
      { check: "x", invoice_id: "A", result: "pass", failing_lines: [] },
    ]);
  });

  it.skipIf(!hasPython)("runInSandbox uploads the runner, attaches it with container_upload, handles pause_turn, deletes the file", async () => {
    let turn = 0;
    const client = fakeClient({
      create: (params) => {
        turn++;
        if (turn === 1) return message({ stop_reason: "pause_turn", content: [{ type: "server_tool_use", id: "s1", name: "bash_code_execution", input: { command: "find" } }], container: { id: "cntr_1" } });
        const runner = client.uploaded[0].text;
        expect(params.container).toBe("cntr_1");
        return message({ content: [bashResult(runLocally(runner)), { type: "text", text: "done" }], container: { id: "cntr_1" } });
      },
    });
    const runner = buildRunner({ invoices: invoices.slice(0, 2).map((i) => i.invoice), vendor, timecards, scripts: [{ check: "line_amounts_correct", code: LINE_OK }] });
    const out = await runInSandbox(client, runner, { noCache: true });
    expect(out.rows).toHaveLength(2);
    expect(out.metas).toHaveLength(2);
    expect(out.container_id).toBe("cntr_1");
    expect(client.uploaded[0].name).toBe("ramp_skill_checks.py");
    expect(client.deleted).toEqual([out.file_id]);
    const first = client.calls.find((c) => c.method === "beta.messages.create")!.params as any;
    expect(first.tools).toEqual([{ type: "code_execution_20260521", name: "code_execution" }]);
    expect(first.messages[0].content[1]).toEqual({ type: "container_upload", file_id: out.file_id });
    // The paused turn is sent back as the assistant message.
    const second = (client.calls.filter((c) => c.method === "beta.messages.create")[1].params as any).messages;
    expect(second[1].role).toBe("assistant");
  });

  it("runInSandbox fails clearly when no result line comes back, and still deletes the file", async () => {
    const client = fakeClient({ create: () => message({ content: [{ type: "text", text: "I could not run it" }] }) });
    await expect(runInSandbox(client, "print(1)", { noCache: true })).rejects.toThrow(/no results/);
    expect(client.deleted).toHaveLength(1);
  });

  it("writeCheckScripts keeps one script per check name", async () => {
    const client = fakeClient({
      parse: () =>
        message({
          parsed_output: {
            scripts: [
              { check: "line_amounts_correct", rule_ids: ["r4"], code: LINE_OK },
              { check: "line_amounts_correct", rule_ids: ["r4"], code: "x" },
              { check: "hours_match_timecards", rule_ids: ["r6"], code: "y" },
            ],
          },
        }),
    });
    const r = await writeCheckScripts(client, [{ id: "r4", text: "Line amounts must tie.", kind: "check", source: "said", citations: [] }], { noCache: true });
    expect(r.api.scripts.map((s) => s.check)).toEqual(["line_amounts_correct", "hours_match_timecards"]);
    expect((client.calls[0].params as any).output_config.format.type).toBe("json_schema");
  });
});
