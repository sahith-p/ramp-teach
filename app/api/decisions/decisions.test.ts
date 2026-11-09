import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BillSchema, DecisionRecordSchema, ReceiptSchema } from "@/contracts";
import sampleReceipt from "@/samples/receipt.sample.json";

let root: string;
const prevRoot = process.env.RAMP_TEACH_ROOT;

/** lib/paths reads RAMP_TEACH_ROOT at import time: set env, reset modules, then import. */
async function loadHandler() {
  vi.resetModules();
  process.env.RAMP_TEACH_ROOT = root;
  return import("./handler");
}

const seedBills = [
  { bill_id: "bill_HSG-1010", vendor: "Halcyon Staffing Group", amount: 15000, status: "approved", receipt_id: null },
  { bill_id: "bill_HSG-1011", vendor: "Halcyon Staffing Group", amount: 17696, status: "pending", receipt_id: null },
];

const readJson = (rel: string) => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
const decisionsLines = () => {
  const f = path.join(root, "receipts", "decisions.jsonl");
  return fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean) : [];
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ramp-teach-decisions-"));
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  fs.mkdirSync(path.join(root, "receipts"), { recursive: true });
  fs.writeFileSync(path.join(root, "data", "bills.json"), JSON.stringify(seedBills));
  fs.writeFileSync(path.join(root, "receipts", "HSG-1011.json"), JSON.stringify(sampleReceipt));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  if (prevRoot === undefined) delete process.env.RAMP_TEACH_ROOT;
  else process.env.RAMP_TEACH_ROOT = prevRoot;
});

describe("handleDecision", () => {
  it("approve: records decision, updates receipt human fields, marks bill approved", async () => {
    const { handleDecision } = await loadHandler();
    const now = new Date("2026-11-09T10:00:00.000Z");
    const res = handleDecision({ invoice_id: "HSG-1011", decision: "approve", decided_by: "  Dana AP  " }, () => now);
    expect(res.status).toBe(200);
    if (res.status !== 200) throw new Error("unreachable");

    expect(res.body.decision).toEqual({
      invoice_id: "HSG-1011",
      receipt_id: "rcpt_HSG-1011",
      bill_id: "bill_HSG-1011",
      decision: "approve",
      decided_by: "Dana AP",
      decided_at: now.toISOString(),
    });
    expect(res.body.bill).toEqual({ ...seedBills[1], status: "approved", receipt_id: "rcpt_HSG-1011" });

    const stored = ReceiptSchema.parse(readJson("receipts/HSG-1011.json"));
    expect(stored.human_decision).toBe("approve");
    expect(stored.decided_by).toBe("Dana AP");
    expect(stored.decided_at).toBe(now.toISOString());
    expect(stored.recommendation).toBe("dispute"); // agent's recommendation untouched

    const bills = (readJson("runtime/bills.json") as unknown[]).map((b) => BillSchema.parse(b));
    expect(bills.find((b) => b.bill_id === "bill_HSG-1011")).toMatchObject({ status: "approved", receipt_id: "rcpt_HSG-1011" });
    expect(bills.find((b) => b.bill_id === "bill_HSG-1010")).toMatchObject({ status: "approved", receipt_id: null });

    const lines = decisionsLines();
    expect(lines).toHaveLength(1);
    expect(DecisionRecordSchema.parse(JSON.parse(lines[0]))).toEqual(res.body.decision);
  });

  it("dispute: marks bill disputed and keeps the note", async () => {
    const { handleDecision } = await loadHandler();
    const res = handleDecision({ invoice_id: "HSG-1011", decision: "dispute", decided_by: "Dana AP", note: "Request credit memo" });
    expect(res.status).toBe(200);
    if (res.status !== 200) throw new Error("unreachable");
    expect(res.body.bill.status).toBe("disputed");
    expect(res.body.receipt.human_decision).toBe("dispute");
    expect(JSON.parse(decisionsLines()[0])).toMatchObject({ decision: "dispute", note: "Request credit memo" });
  });

  it.each([
    ["missing body", undefined],
    ["empty decided_by", { invoice_id: "HSG-1011", decision: "approve", decided_by: "   " }],
    ["bad decision", { invoice_id: "HSG-1011", decision: "pay", decided_by: "Dana" }],
    ["traversal id", { invoice_id: "../data/answer_key", decision: "approve", decided_by: "Dana" }],
    ["missing invoice_id", { decision: "approve", decided_by: "Dana" }],
  ])("400 on invalid input (%s), nothing written", async (_label, body) => {
    const { handleDecision } = await loadHandler();
    expect(handleDecision(body).status).toBe(400);
    expect(decisionsLines()).toHaveLength(0);
    expect(fs.existsSync(path.join(root, "runtime", "bills.json"))).toBe(false);
  });

  it("404 when no receipt exists", async () => {
    const { handleDecision } = await loadHandler();
    const res = handleDecision({ invoice_id: "HSG-1010", decision: "approve", decided_by: "Dana" });
    expect(res.status).toBe(404);
    expect(decisionsLines()).toHaveLength(0);
  });

  it("404 (no partial writes) when the bill does not exist", async () => {
    fs.writeFileSync(path.join(root, "receipts", "HSG-2000.json"), JSON.stringify({ ...sampleReceipt, invoice_id: "HSG-2000" }));
    const { handleDecision } = await loadHandler();
    const res = handleDecision({ invoice_id: "HSG-2000", decision: "approve", decided_by: "Dana" });
    expect(res.status).toBe(404);
    expect(decisionsLines()).toHaveLength(0);
    expect(readJson("receipts/HSG-2000.json").human_decision).toBeNull();
  });

  it("409 on a second decision; first decision stands", async () => {
    const { handleDecision } = await loadHandler();
    expect(handleDecision({ invoice_id: "HSG-1011", decision: "dispute", decided_by: "Dana" }).status).toBe(200);
    const again = handleDecision({ invoice_id: "HSG-1011", decision: "approve", decided_by: "Eve" });
    expect(again.status).toBe(409);
    expect(decisionsLines()).toHaveLength(1);
    expect(readJson("receipts/HSG-1011.json")).toMatchObject({ human_decision: "dispute", decided_by: "Dana" });
    expect(readJson("runtime/bills.json")[1]).toMatchObject({ status: "disputed" });
  });
});

describe("POST /api/decisions route", () => {
  it("returns 400 for non-JSON and 200 with {decision, receipt, bill} for a valid body", async () => {
    vi.resetModules();
    process.env.RAMP_TEACH_ROOT = root;
    const { POST } = await import("./route");
    const bad = await POST(new Request("http://localhost/api/decisions", { method: "POST", body: "nope" }));
    expect(bad.status).toBe(400);
    const ok = await POST(
      new Request("http://localhost/api/decisions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invoice_id: "HSG-1011", decision: "approve", decided_by: "Dana" }),
      }),
    );
    expect(ok.status).toBe(200);
    const json = await ok.json();
    expect(Object.keys(json).sort()).toEqual(["bill", "decision", "receipt"]);
  });
});

describe("GET /api/receipts/[invoiceId]", () => {
  it("returns the receipt, 404 when missing, 400 on unsafe id", async () => {
    vi.resetModules();
    process.env.RAMP_TEACH_ROOT = root;
    const { GET } = await import("../receipts/[invoiceId]/route");
    const req = new Request("http://localhost/api/receipts/x");
    const ok = await GET(req, { params: Promise.resolve({ invoiceId: "HSG-1011" }) });
    expect(ok.status).toBe(200);
    expect((await ok.json()).invoice_id).toBe("HSG-1011");
    expect((await GET(req, { params: Promise.resolve({ invoiceId: "HSG-9999" }) })).status).toBe(404);
    expect((await GET(req, { params: Promise.resolve({ invoiceId: "..%2Fx" }) })).status).toBe(400);
  });
});
