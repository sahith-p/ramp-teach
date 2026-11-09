/** Pure helpers shared by the receipt pages (no fs; safe for client and server). */
import { CHECK_NAMES, parseEvidencePointer, type CheckName } from "@/contracts";

/** Invoice ids we accept in URLs and API bodies. Blocks traversal into receipts/ or runs/. */
export const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export const isSafeId = (id: string) => SAFE_ID.test(id);

/** The id that renders samples/receipt.sample.json. */
export const SAMPLE_ID = "sample";

export const CHECK_LABELS: Record<CheckName, string> = {
  line_amounts_correct: "Line amounts correct",
  total_matches_line_items: "Total matches line items",
  rate_matches_contract: "Rate matches contract",
  no_duplicate_lines: "No duplicate lines",
  no_unknown_charges: "No unknown charges",
  hours_match_timecards: "Hours match timecards",
};

export function checkLabel(name: string): string {
  return (CHECK_NAMES as readonly string[]).includes(name) ? CHECK_LABELS[name as CheckName] : name;
}

/**
 * Where an evidence pointer links to: `fixture:/x` → `/x` on this app; data/rules/calc → the
 * read-only evidence viewer. Invalid pointers → null (rendered as "no valid evidence").
 */
export function evidenceHref(invoiceId: string, pointer: string): string | null {
  const parsed = parseEvidencePointer(pointer);
  if (!parsed) return null;
  if (parsed.kind === "fixture") return parsed.target;
  return `/receipts/${encodeURIComponent(invoiceId)}/evidence?p=${encodeURIComponent(pointer.trim())}`;
}

/** 0-based line index a pointer refers to, if any (`…#line_items[3]`, `calc:x#line-3`). */
export function lineIndexFromPointer(pointer: string): number | null {
  const parsed = parseEvidencePointer(pointer);
  if (!parsed?.fragment) return null;
  if (parsed.kind === "calc") return calcLineFragment(parsed.fragment);
  if (parsed.kind === "data") {
    const m = /^line_items\[(\d+)\]/.exec(parsed.fragment);
    return m ? Number(m[1]) : null;
  }
  return null;
}

/** `line-3`, `line_3`, `line3`, `line_items[3]` → 3. */
export function calcLineFragment(fragment: string): number | null {
  const m = /^line[-_]?(\d+)$/.exec(fragment) ?? /^line_items\[(\d+)\]$/.exec(fragment);
  return m ? Number(m[1]) : null;
}

export function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}
