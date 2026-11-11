#!/usr/bin/env node
/**
 * T-12 fixture smoke test (scripted Playwright, no AI). Needs the Next app running:
 *   npx next dev -p 3011   then   node components/fixtures/smoke.mjs http://localhost:3011
 * Writes a temporary receipts/HSG-1011.json (only if none exists) to exercise the attach endpoint,
 * then removes it and restores runtime/bills.json to its previous content (or deletes it).
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE = process.argv[2] ?? process.env.BASE_URL ?? "http://localhost:3011";
const ROOT = process.cwd();
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // 1. Redirect without cookie
  await page.goto(`${BASE}/portal/invoices`);
  check("no cookie → /portal/login", new URL(page.url()).pathname === "/portal/login", page.url());
  await page.goto(`${BASE}/portal/employees/E-104?week=2026-10-18`);
  check("no cookie on timecard → /portal/login", new URL(page.url()).pathname === "/portal/login");

  // 2. Bad creds
  await page.fill('input[name="username"]', "ap.reviewer");
  await page.fill('input[name="password"]', "wrong");
  await Promise.all([page.waitForURL(/error=1/), page.getByRole("button", { name: "Sign in" }).click()]);
  check("bad creds → ?error=1 with visible error", await page.getByTestId("login-error").isVisible());

  // 3. Login
  check("demo creds shown", (await page.textContent("body")).includes("demo-only"));
  check("demo label shown (footer)", (await page.getByTestId("demo-banner").textContent()).includes("Synthetic data"));
  check("vendor header shown", (await page.textContent("header")).includes("Halcyon Staffing"));
  await page.fill('input[name="username"]', "ap.reviewer");
  await page.fill('input[name="password"]', "demo-only");
  await Promise.all([page.waitForURL(/\/portal\/invoices$/), page.getByRole("button", { name: "Sign in" }).click()]);
  const cookies = await ctx.cookies();
  check("login → /portal/invoices + portal_session cookie", cookies.some((c) => c.name === "portal_session"));
  const invoiceLinks = await page.locator('a[href^="/portal/invoices/HSG-"]').count();
  check("invoice list has 11 invoices", invoiceLinks === 11, String(invoiceLinks));

  // 4. Invoice detail + View timecard
  await Promise.all([page.waitForURL(/HSG-1011$/), page.locator('a[href="/portal/invoices/HSG-1011"]').first().click()]);
  const tcLinks = page.getByRole("link", { name: "View timecard" });
  check("HSG-1011 has 5 View timecard links", (await tcLinks.count()) === 5, String(await tcLinks.count()));
  const samHref = await tcLinks.nth(3).getAttribute("href");
  check("Sam's link → /portal/employees/E-104?week=2026-10-18", samHref === "/portal/employees/E-104?week=2026-10-18", samHref);
  await Promise.all([page.waitForURL(/E-104\?week=2026-10-18/), tcLinks.nth(3).click()]);

  // 5. Timecard markers
  const f = async (k) => ((await page.locator(`[data-field="${k}"]`).first().textContent()) ?? "").trim();
  check("approved_hours = 38", (await f("approved_hours")) === "38", await f("approved_hours"));
  check("employee_name = Sam Okafor", (await f("employee_name")) === "Sam Okafor");
  check("employee_id/role/week/status/approved_by present",
    (await f("employee_id")) === "E-104" && (await f("role")) === "Data Analyst" &&
    (await f("week_ending")) === "2026-10-18" && (await f("status")) === "approved" && (await f("approved_by")).length > 0);

  // 6. Unknown week / employee
  await page.goto(`${BASE}/portal/employees/E-104?week=2025-01-05`);
  check("unknown week → No timecard found, no approved_hours",
    (await page.textContent("body")).includes("No timecard found") && (await page.locator('[data-field="approved_hours"]').count()) === 0);
  await page.goto(`${BASE}/portal/employees/E-999?week=2026-10-18`);
  check("unknown employee → No timecard found",
    (await page.textContent("body")).includes("No timecard found") && (await page.locator('[data-field="approved_hours"]').count()) === 0);
  await page.goto(`${BASE}/portal/employees`);
  check("roster lists 5 employees", (await page.locator('a[href^="/portal/employees/E-"]').count()) === 10);
  await page.goto(`${BASE}/portal/employees/E-104`);
  check("employee weeks link to ?week=", (await page.locator('a[href^="/portal/employees/E-104?week="]').count()) > 0);

  // 7. Bills
  await page.goto(`${BASE}/bills`);
  const billRows = await page.locator("tr[data-bill-id]").count();
  check("/bills lists 11 bills", billRows === 11, String(billRows));
  check("bill inbox demo label (footer)", (await page.getByTestId("demo-banner").textContent()).includes("Synthetic data"));

  // 8. Attach (temp receipt; state restored afterwards)
  const receiptFile = path.join(ROOT, "receipts", "HSG-1011.json");
  const billsState = path.join(ROOT, "runtime", "bills.json");
  const hadReceipt = fs.existsSync(receiptFile);
  const prevBills = fs.existsSync(billsState) ? fs.readFileSync(billsState, "utf8") : null;
  const createdReceiptsDir = !fs.existsSync(path.dirname(receiptFile));
  if (hadReceipt) {
    console.log("SKIP  attach flow: receipts/HSG-1011.json already exists (not overwriting)");
  } else {
    try {
      fs.mkdirSync(path.dirname(receiptFile), { recursive: true });
      fs.writeFileSync(receiptFile, JSON.stringify({
        invoice_id: "HSG-1011", vendor: "Halcyon Staffing Group", checks: [], recommendation: "dispute",
        reasons: ["smoke-test temp receipt"], mode: "mock", human_decision: null, decided_by: null, decided_at: null,
      }));
      const bad = await page.request.post(`${BASE}/api/bills/bill_HSG-1011/attach`, { data: { receipt_id: "rcpt_WRONG" } });
      check("attach with wrong receipt_id → 400", bad.status() === 400, String(bad.status()));
      await page.goto(`${BASE}/bills/bill_HSG-1011`);
      const btn = page.getByRole("button", { name: "Attach receipt" });
      check("Attach receipt button visible", await btn.isVisible());
      await Promise.all([page.waitForURL(/attached=1/), btn.click()]);
      check("attach via button → receipt_attached",
        (await page.locator('[data-field="receipt_id"]').textContent()).includes("rcpt_HSG-1011") &&
        (await page.locator("[data-bill-status]").first().getAttribute("data-bill-status")) === "receipt_attached");
      check("detail links to /receipts/HSG-1011", (await page.locator('a[href="/receipts/HSG-1011"]').count()) > 0);
      const again = await page.request.post(`${BASE}/api/bills/bill_HSG-1011/attach`, { data: { receipt_id: "rcpt_HSG-1011" } });
      check("second attach (JSON) → 409", again.status() === 409, String(again.status()));
      const unknown = await page.request.post(`${BASE}/api/bills/bill_NOPE/attach`, { data: { receipt_id: "rcpt_NOPE" } });
      check("unknown bill → 404", unknown.status() === 404, String(unknown.status()));
    } finally {
      fs.rmSync(receiptFile, { force: true });
      if (createdReceiptsDir) fs.rmSync(path.dirname(receiptFile), { recursive: true, force: true });
      if (prevBills === null) fs.rmSync(billsState, { force: true });
      else fs.writeFileSync(billsState, prevBills);
      console.log("state restored: temp receipt removed, runtime/bills.json restored");
    }
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
