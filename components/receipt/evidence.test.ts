import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveEvidence, resolveFragment, safeRepoFile } from "./evidence";
import { evidenceHref, lineIndexFromPointer } from "./format";
import calcSample from "@/samples/calc.sample.json";

let root: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ramp-teach-evidence-"));
  const w = (rel: string, v: unknown) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), JSON.stringify(v));
  };
  w("data/vendor.json", {
    contract: { rate_card: [{ role: "Sourcer", bill_rate: 70 }, { role: "Senior Recruiter", bill_rate: 95 }] },
  });
  w("data/invoices/new/HSG-1011.json", { line_items: [{ amount: 1 }, { amount: 2 }, { amount: 3 }], total: 6 });
  w("data/answer_key.json", { secret: true });
  w("rules/workflow_spec.json", { rules: ["Rate must equal the contract rate card."] });
  w("runs/HSG-1011/calc.json", calcSample);
  w("runs/HSG-1012/calc.json", calcSample);
  w("secret.json", { outside: true });
  fs.symlinkSync(path.join(root, "secret.json"), path.join(root, "data", "link.json"));
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("resolveFragment", () => {
  const doc = { line_items: [{ a: 1 }, { a: 2 }, { a: 3 }], contract: { rate_card: [{ role: "Senior Recruiter", bill_rate: 95 }] } };
  it("handles indices, nested keys and array lookup by string field", () => {
    expect(resolveFragment(doc, "line_items[2]")).toEqual({ found: true, value: { a: 3 } });
    expect(resolveFragment(doc, "contract.rate_card.Senior Recruiter")).toEqual({ found: true, value: { role: "Senior Recruiter", bill_rate: 95 } });
    expect(resolveFragment(doc, "contract.rate_card.Senior Recruiter.bill_rate").value).toBe(95);
    expect(resolveFragment(doc, "line_items[9]").found).toBe(false);
    expect(resolveFragment(doc, "nope").found).toBe(false);
  });
});

describe("safeRepoFile", () => {
  it("allows files in the allowed dirs only", () => {
    expect(safeRepoFile("data/vendor.json", ["data"], root)).toBe(path.join(root, "data/vendor.json"));
    expect(() => safeRepoFile("data/../secret.json", ["data"], root)).toThrow();
    expect(() => safeRepoFile("rules/workflow_spec.json", ["data"], root)).toThrow();
    expect(() => safeRepoFile("/etc/passwd", ["data"], root)).toThrow();
    expect(() => safeRepoFile("data/link.json", ["data"], root)).toThrow(/outside/);
    expect(() => safeRepoFile("runs/HSG-1012/calc.json", ["runs/HSG-1011"], root)).toThrow();
  });
  it("blocks the answer key explicitly", () => {
    expect(() => safeRepoFile("data/answer_key.json", ["data"], root)).toThrow(/answer key/);
    expect(() => safeRepoFile("data/sub/ANSWER_KEY.json", ["data"], root)).toThrow(/answer key/);
  });
});

describe("resolveEvidence", () => {
  it("data pointer with array-lookup fragment", () => {
    const v = resolveEvidence("HSG-1011", "data/vendor.json#contract.rate_card.Senior Recruiter", root);
    expect(v).toMatchObject({ kind: "file", missing: false, fragmentFound: true, fragmentValue: { bill_rate: 95 } });
  });
  it("data pointer with index fragment and rules pointer", () => {
    expect(resolveEvidence("HSG-1011", "data/invoices/new/HSG-1011.json#line_items[2]", root)).toMatchObject({ fragmentValue: { amount: 3 } });
    expect(resolveEvidence("HSG-1011", "rules/workflow_spec.json#rules[0]", root)).toMatchObject({
      kind: "file",
      fragmentValue: "Rate must equal the contract rate card.",
    });
  });
  it("missing file is reported, not thrown", () => {
    expect(resolveEvidence("HSG-1011", "data/timecards.json", root)).toMatchObject({ kind: "file", missing: true });
  });
  it("calc pointer reads runs/<invoice>/calc.json and parses line fragment", () => {
    const v = resolveEvidence("HSG-1011", "calc:no_duplicate_lines#line-3", root);
    expect(v).toMatchObject({ kind: "calc", file: "runs/HSG-1011/calc.json", highlightLine: 3, missing: false });
    if (v.kind === "calc") expect(v.output?.result).toBe("fail");
    expect(resolveEvidence("HSG-9999", "calc:no_duplicate_lines", root)).toMatchObject({ kind: "calc", missing: true });
  });
  it("sample calc reads samples/calc.sample.json", () => {
    const v = resolveEvidence("sample", "calc:rate_matches_contract", path.resolve(__dirname, "..", ".."));
    expect(v).toMatchObject({ kind: "calc", sample: true, missing: false });
  });
  it("fixture pointer becomes a link", () => {
    expect(resolveEvidence("HSG-1011", "fixture:/portal/employees/E-104?week=2026-10-18", root)).toEqual({
      kind: "fixture",
      pointer: "fixture:/portal/employees/E-104?week=2026-10-18",
      href: "/portal/employees/E-104?week=2026-10-18",
    });
  });
  it("rejects the answer key, traversal, bad ids and invalid pointers", () => {
    expect(resolveEvidence("HSG-1011", "data/answer_key.json", root)).toMatchObject({ kind: "error" });
    expect(resolveEvidence("HSG-1011", "data/../secret.json", root)).toMatchObject({ kind: "error" });
    expect(resolveEvidence("HSG-1011", "data/link.json", root)).toMatchObject({ kind: "error" });
    expect(resolveEvidence("../x", "calc:no_duplicate_lines", root)).toMatchObject({ kind: "error" });
    expect(resolveEvidence("HSG-1011", "https://example.com", root)).toMatchObject({ kind: "error" });
    expect(resolveEvidence("HSG-1011", "", root)).toMatchObject({ kind: "error" });
  });
});

describe("format helpers", () => {
  it("evidenceHref maps pointer kinds to links", () => {
    expect(evidenceHref("HSG-1011", "fixture:/portal/employees/E-104?week=2026-10-18")).toBe("/portal/employees/E-104?week=2026-10-18");
    expect(evidenceHref("HSG-1011", "calc:no_duplicate_lines#line-3")).toBe(
      "/receipts/HSG-1011/evidence?p=calc%3Ano_duplicate_lines%23line-3",
    );
    expect(evidenceHref("HSG-1011", "free text")).toBeNull();
  });
  it("lineIndexFromPointer", () => {
    expect(lineIndexFromPointer("data/invoices/new/HSG-1011.json#line_items[4]")).toBe(4);
    expect(lineIndexFromPointer("calc:no_duplicate_lines#line-3")).toBe(3);
    expect(lineIndexFromPointer("data/vendor.json#contract.rate_card.Sourcer")).toBeNull();
  });
});
