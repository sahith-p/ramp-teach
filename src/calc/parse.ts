/**
 * Labor-line parsing (deterministic — no LLM, no I/O).
 *
 * Frozen format (contracts/supporting.ts LABOR_LINE_REGEX):
 *   "Labor: <Employee Name> (<Role>) - week ending YYYY-MM-DD"
 * Anything that does not match is a non-labor charge.
 */
import { LABOR_LINE_REGEX, type Employee, type LineItem, type VendorProfile } from "@/contracts";

export interface ParsedLaborLine {
  name: string;
  role: string;
  week_ending: string;
}

/** Parse a line description. Returns null for non-labor lines. */
export function parseLaborLine(description: string): ParsedLaborLine | null {
  const m = LABOR_LINE_REGEX.exec(description);
  if (!m) return null;
  return { name: m[1].trim(), role: m[2].trim(), week_ending: m[3] };
}

export const isLaborLine = (description: string) => parseLaborLine(description) !== null;

/** Exact (trimmed, case-insensitive) name lookup in the vendor roster. */
export function findEmployee(vendor: VendorProfile, name: string): Employee | null {
  const key = name.trim().toLowerCase();
  return vendor.employees.find((e) => e.name.trim().toLowerCase() === key) ?? null;
}

export interface LaborLine extends ParsedLaborLine {
  /** 0-based index into invoice.line_items. */
  index: number;
  item: LineItem;
  /** Roster match by name; null when the name is not on the vendor roster. */
  employee: Employee | null;
}

/** All labor lines of an invoice, parsed and mapped to roster employees, in line order. */
export function laborLines(lineItems: LineItem[], vendor: VendorProfile): LaborLine[] {
  const out: LaborLine[] = [];
  lineItems.forEach((item, index) => {
    const parsed = parseLaborLine(item.description);
    if (parsed) out.push({ ...parsed, index, item, employee: findEmployee(vendor, parsed.name) });
  });
  return out;
}
