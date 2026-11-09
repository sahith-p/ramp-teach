import { describe, expect, it } from "vitest";
import { loadAllInvoices, loadInvoice, loadTimecards, loadVendor } from "@/lib/data";
import {
  findEmployeeByName,
  findTimecard,
  invoiceWeekEnding,
  parseLaborLine,
  portalLines,
  timecardsForEmployee,
} from "../portal-data";
import { checkCredentials, isValidSession, PORTAL_SESSION_VALUE } from "../session";

describe("portal-data", () => {
  const vendor = loadVendor();
  const timecards = loadTimecards();

  it("parses labor lines and ignores non-labor charges", () => {
    expect(parseLaborLine("Labor: Sam Okafor (Data Analyst) - week ending 2026-10-18")).toEqual({
      employeeName: "Sam Okafor",
      role: "Data Analyst",
      weekEnding: "2026-10-18",
    });
    expect(parseLaborLine("Background check fee")).toBeNull();
  });

  it("maps invoice employee names to roster ids", () => {
    expect(findEmployeeByName(vendor, "Sam Okafor")?.employee_id).toBe("E-104");
    expect(findEmployeeByName(vendor, "Nobody Here")).toBeNull();
  });

  it("builds View timecard links for every HSG-1011 labor line", () => {
    const inv = loadInvoice("HSG-1011")!;
    const lines = portalLines(inv, vendor);
    const hrefs = lines.map((l) => l.timecardHref);
    expect(hrefs).toEqual([
      "/portal/employees/E-101?week=2026-10-18",
      "/portal/employees/E-102?week=2026-10-18",
      "/portal/employees/E-103?week=2026-10-18",
      "/portal/employees/E-104?week=2026-10-18",
      "/portal/employees/E-103?week=2026-10-18",
      null, // Background check fee
    ]);
    expect(invoiceWeekEnding(inv)).toBe("2026-10-18");
  });

  it("every labor line on every invoice resolves to a roster employee", () => {
    for (const inv of loadAllInvoices()) {
      for (const l of portalLines(inv, vendor)) {
        if (l.labor) expect(l.employee, `${inv.invoice_id} line ${l.index}`).not.toBeNull();
      }
    }
  });

  it("finds Sam Okafor's approved 38h timecard for 2026-10-18 and nothing for unknown weeks", () => {
    expect(findTimecard(timecards, "E-104", "2026-10-18")?.approved_hours).toBe(38);
    expect(findTimecard(timecards, "E-104", "2025-01-05")).toBeNull();
    const weeks = timecardsForEmployee(timecards, "E-104").map((t) => t.week_ending);
    expect(weeks).toEqual([...weeks].sort().reverse());
  });

  it("checks demo credentials and session token", () => {
    expect(checkCredentials("ap.reviewer", "demo-only")).toBe(true);
    expect(checkCredentials("ap.reviewer", "wrong")).toBe(false);
    expect(checkCredentials(null, null)).toBe(false);
    expect(isValidSession(PORTAL_SESSION_VALUE)).toBe(true);
    expect(isValidSession(undefined)).toBe(false);
    expect(isValidSession("forged")).toBe(false);
  });
});
