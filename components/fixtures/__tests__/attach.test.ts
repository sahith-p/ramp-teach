/**
 * attachReceiptToBill against a temp repo root (RAMP_TEACH_ROOT), so the real runtime/ and
 * receipts/ are never touched.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Receipt } from "@/contracts";

const repoRoot = path.resolve(__dirname, "../../..");
let tmp: string;
let attach: typeof import("../attach");
let bills: typeof import("@/lib/store/bills");

const receipt = (invoiceId: string, human: Receipt["human_decision"] = null): Receipt => ({
  invoice_id: invoiceId,
  vendor: "Halcyon Staffing Group",
  checks: [],
  recommendation: "dispute",
  reasons: ["test receipt"],
  mode: "mock",
  human_decision: human,
  decided_by: human ? "test.human" : null,
  decided_at: human ? "2026-11-09T00:00:00Z" : null,
});

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fixture-attach-"));
  fs.mkdirSync(path.join(tmp, "data"), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, "data", "bills.json"), path.join(tmp, "data", "bills.json"));
  fs.mkdirSync(path.join(tmp, "receipts"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "receipts", "HSG-1011.json"), JSON.stringify(receipt("HSG-1011")));
  fs.writeFileSync(path.join(tmp, "receipts", "HSG-1010.json"), JSON.stringify(receipt("HSG-1010", "approve")));
  vi.stubEnv("RAMP_TEACH_ROOT", tmp);
  vi.resetModules();
  attach = await import("../attach");
  bills = await import("@/lib/store/bills");
});

afterAll(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("attachReceiptToBill", () => {
  it("404s an unknown bill", () => {
    expect(attach.attachReceiptToBill("bill_NOPE", "rcpt_NOPE")).toMatchObject({ ok: false, status: 404 });
  });

  it("400s a missing or mismatched receipt_id", () => {
    expect(attach.attachReceiptToBill("bill_HSG-1011", undefined)).toMatchObject({ ok: false, status: 400 });
    expect(attach.attachReceiptToBill("bill_HSG-1011", "rcpt_HSG-1001")).toMatchObject({ ok: false, status: 400 });
  });

  it("404s when no receipt file exists", () => {
    expect(attach.attachReceiptToBill("bill_HSG-1009", "rcpt_HSG-1009")).toMatchObject({ ok: false, status: 404 });
  });

  it("attaches, sets receipt_attached, and 409s a second attach", () => {
    const r = attach.attachReceiptToBill("bill_HSG-1011", "rcpt_HSG-1011");
    expect(r).toMatchObject({ ok: true, bill: { receipt_id: "rcpt_HSG-1011", status: "receipt_attached" } });
    expect(bills.getBill("bill_HSG-1011")?.receipt_id).toBe("rcpt_HSG-1011");
    expect(attach.attachReceiptToBill("bill_HSG-1011", "rcpt_HSG-1011")).toMatchObject({ ok: false, status: 409 });
    expect(fs.existsSync(path.join(tmp, "runtime", "bills.json"))).toBe(true);
  });

  it("reflects an existing human decision in the bill status", () => {
    expect(attach.attachReceiptToBill("bill_HSG-1010", "rcpt_HSG-1010")).toMatchObject({
      ok: true,
      bill: { status: "approved" },
    });
  });
});
