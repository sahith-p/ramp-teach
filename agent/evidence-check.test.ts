import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EvidenceCheckReportSchema, type AgentEvidenceFact, type EvidenceBundle } from "@/contracts";
import { cropName, evidenceTargets, runEvidenceCheck, sameValue } from "./evidence-check";
import { FakeDriver } from "@/agent/test-fixtures/fake-driver";
import { startPortalStub } from "@/agent/test-fixtures/portal-stub";
import { PlaywrightDriver } from "./browser/playwright-driver";
import { loadTimecards } from "@/lib/data";

const ORIGIN = "http://localhost:3000";
let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "evcheck-"));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const bundle = (hours: number): EvidenceBundle => ({
  invoice_id: "HSG-1011",
  mode: "real",
  items: [
    {
      source: "fixture:/portal/employees/E-104?week=2026-10-18",
      kind: "timecard_hours",
      employee_id: "E-104",
      week_ending: "2026-10-18",
      value: hours,
      screenshot: null,
      captured_at: "t",
      mode: "real",
    },
    { source: "fixture:/portal/invoices/HSG-1011", kind: "invoice_view", employee_id: null, week_ending: null, value: "HSG-1011", screenshot: null, captured_at: "t", mode: "scripted" },
  ],
  timecards: [{ employee_id: "E-104", week_ending: "2026-10-18", approved_hours: hours, approved_by: "Dana Whitfield", status: "approved" }],
});

describe("evidence targets + comparison (pure)", () => {
  it("collects agent facts, then bundle hours/status/approved_by, without duplicates or rejected facts", () => {
    const facts: AgentEvidenceFact[] = [
      { source: "fixture:/portal/employees/E-104?week=2026-10-18", key: "approved_hours", value: 38, subject_ref: { employee_id: "E-104", week_ending: "2026-10-18" }, note: "" },
      { source: "fixture:/portal/invoices", key: "approved_hours", value: 1, subject_ref: { employee_id: "E-104", week_ending: "2026-10-18" }, note: "wrong page, rejected by the workflow" },
    ];
    const t = evidenceTargets(bundle(38), facts);
    expect(t.map((x) => [x.key, x.value])).toEqual([
      ["approved_hours", "38"],
      ["status", "approved"],
      ["approved_by", "Dana Whitfield"],
    ]);
    expect(t.every((x) => x.source === "fixture:/portal/employees/E-104?week=2026-10-18")).toBe(true);
  });

  it("compares numbers numerically and text case-insensitively", () => {
    expect(sameValue("38", "38")).toBe(true);
    expect(sameValue("38", "38.0")).toBe(true);
    expect(sameValue("38", "38 h")).toBe(true);
    expect(sameValue("38", "40")).toBe(false);
    expect(sameValue("approved", "Approved")).toBe(true);
    expect(sameValue("2026-10-18", "2026-10-18")).toBe(true);
    expect(cropName("approved_hours", { employee_id: "E-104", week_ending: "2026-10-18" })).toBe("approved_hours-E-104-2026-10-18.png");
  });
});

describe("runEvidenceCheck with the fake driver (outline fallback, no crops)", () => {
  it("marks match / mismatch / unavailable and writes the report", async () => {
    const d = new FakeDriver(ORIGIN);
    d.pages = { "/portal/employees/E-104?week=2026-10-18": 'Page: T\n- generic "37" [ref=ref_1] [data-field=approved_hours]\n- generic "approved" [ref=ref_2] [data-field=status]' };
    const runDir = path.join(tmp, "runs", "HSG-1011");
    const r = await runEvidenceCheck({ invoiceId: "HSG-1011", targets: evidenceTargets(bundle(38)), driver: d, baseUrl: ORIGIN, runDir, repoRoot: tmp });
    expect(r.checks.map((c) => [c.key, c.status, c.rechecked_value])).toEqual([
      ["approved_hours", "mismatch", "37"],
      ["status", "match", "approved"],
      ["approved_by", "unavailable", null],
    ]);
    expect(d.calls.filter((c) => c[0] === "navigate")).toHaveLength(1); // one visit per source page
    expect(EvidenceCheckReportSchema.parse(JSON.parse(fs.readFileSync(path.join(runDir, "evidence-check.json"), "utf8")))).toEqual(r);
  });
});

describe("runEvidenceCheck with Playwright against the TEST STUB portal", () => {
  let stub: Awaited<ReturnType<typeof startPortalStub>>;
  let driver: PlaywrightDriver;
  beforeAll(async () => {
    stub = await startPortalStub(0);
    driver = new PlaywrightDriver({ allowedOrigins: [stub.url], screenshotDir: null });
  }, 30_000);
  afterAll(async () => {
    await driver?.close();
    await stub?.close();
  });

  it("re-reads [data-field] values in the signed-in session, crops each field, and reports a redirect as unavailable", async () => {
    const tc = loadTimecards().find((t) => t.employee_id === "E-104" && t.week_ending === "2026-10-18")!; // portal backend value (test only)
    const runDir = path.join(tmp, "runs", "HSG-1011");
    // Not signed in yet: the portal redirects to the sign-in page ⇒ unavailable, never a guess.
    const before = await runEvidenceCheck({ invoiceId: "HSG-1011", targets: evidenceTargets(bundle(tc.approved_hours)), driver, baseUrl: stub.url, runDir, repoRoot: tmp, write: false });
    expect(before.checks.every((c) => c.status === "unavailable")).toBe(true);

    await driver.navigate(`${stub.url}/portal/login`);
    const user = (await driver.find("username"))[0];
    const pass = (await driver.find("password"))[0];
    await driver.formInput(user.ref, "ap.reviewer");
    await driver.formInput(pass.ref, "demo-only");
    await driver.click({ type: "ref", ref: (await driver.find("Sign in")).find((r) => r.role === "button")!.ref });

    const b = bundle(tc.approved_hours);
    b.timecards[0].approved_by = tc.approved_by;
    b.items.push({ ...b.items[0], source: "fixture:/portal/employees/E-101?week=2026-10-18", employee_id: "E-101", value: 999 });
    const r = await runEvidenceCheck({ invoiceId: "HSG-1011", targets: evidenceTargets(b), driver, baseUrl: stub.url, runDir, repoRoot: tmp });
    const by = (k: string, e: string) => r.checks.find((c) => c.key === k && c.subject.employee_id === e)!;
    expect(by("approved_hours", "E-104")).toMatchObject({ status: "match", rechecked_value: String(tc.approved_hours) });
    expect(by("status", "E-104")).toMatchObject({ status: "match" });
    expect(by("approved_by", "E-104")).toMatchObject({ status: "match" });
    expect(by("approved_hours", "E-101")).toMatchObject({ status: "mismatch", value: "999" });
    const crop = by("approved_hours", "E-104").screenshot!;
    expect(crop).toBe("runs/HSG-1011/evidence/approved_hours-E-104-2026-10-18.png");
    const png = fs.readFileSync(path.join(tmp, crop));
    expect(png.subarray(1, 4).toString()).toBe("PNG");
  }, 30_000);
});
