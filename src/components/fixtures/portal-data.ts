/**
 * Pure helpers for the fixture vendor timecard portal (T-12). No fs, no Next imports, so they
 * are unit-testable. Pages load data via lib/data.ts and pass it in.
 */
import { LABOR_LINE_REGEX, type Employee, type Invoice, type LineItem, type Timecard, type VendorProfile } from "@/contracts";

export interface ParsedLaborLine {
  employeeName: string;
  role: string;
  weekEnding: string;
}

/** Parse a frozen-format labor line. Returns null for non-labor charges. */
export function parseLaborLine(description: string): ParsedLaborLine | null {
  const m = LABOR_LINE_REGEX.exec(description);
  if (!m) return null;
  return { employeeName: m[1], role: m[2], weekEnding: m[3] };
}

/** Map an employee name (as written on an invoice line) to the vendor roster entry. */
export function findEmployeeByName(vendor: VendorProfile, name: string): Employee | null {
  const want = name.trim().toLowerCase();
  return vendor.employees.find((e) => e.name.trim().toLowerCase() === want) ?? null;
}

export function findEmployeeById(vendor: VendorProfile, employeeId: string): Employee | null {
  return vendor.employees.find((e) => e.employee_id === employeeId) ?? null;
}

export interface PortalLine {
  index: number; // 0-based index into invoice.line_items
  item: LineItem;
  labor: ParsedLaborLine | null;
  employee: Employee | null;
  /** `/portal/employees/<id>?week=<date>` for labor lines whose employee is on the roster. */
  timecardHref: string | null;
}

export const timecardHref = (employeeId: string, week: string) =>
  `/portal/employees/${encodeURIComponent(employeeId)}?week=${encodeURIComponent(week)}`;

export function portalLines(invoice: Invoice, vendor: VendorProfile): PortalLine[] {
  return invoice.line_items.map((item, index) => {
    const labor = parseLaborLine(item.description);
    const employee = labor ? findEmployeeByName(vendor, labor.employeeName) : null;
    return {
      index,
      item,
      labor,
      employee,
      timecardHref: labor && employee ? timecardHref(employee.employee_id, labor.weekEnding) : null,
    };
  });
}

/** Week ending of an invoice: from its first labor line, else issue_date - 1 day. */
export function invoiceWeekEnding(invoice: Invoice): string {
  for (const li of invoice.line_items) {
    const p = parseLaborLine(li.description);
    if (p) return p.weekEnding;
  }
  const d = new Date(`${invoice.issue_date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function findTimecard(timecards: Timecard[], employeeId: string, week: string): Timecard | null {
  return timecards.find((t) => t.employee_id === employeeId && t.week_ending === week) ?? null;
}

/** That employee's timecards, newest week first. */
export function timecardsForEmployee(timecards: Timecard[], employeeId: string): Timecard[] {
  return timecards
    .filter((t) => t.employee_id === employeeId)
    .sort((a, b) => b.week_ending.localeCompare(a.week_ending));
}

/** First value of a Next searchParams entry. */
export function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
