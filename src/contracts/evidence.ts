/**
 * FROZEN: evidence pointer grammar. Every receipt check's `evidence` must be one pointer:
 *
 *   data/<path>[#fragment]          a committed file under data/   e.g. data/vendor.json#rate_card.Senior Recruiter
 *   rules/<path>[#fragment]         a committed file under rules/  e.g. rules/workflow_spec.json#rules[2]
 *   calc:<check_name>[#<fragment>]  a check in runs/<invoice_id>/calc.json  e.g. calc:rate_matches_contract#line-2
 *   fixture:/<path>[?query]         a page on the localhost fixture app  e.g. fixture:/portal/employees/E-103?week=2026-10-18
 *
 * Anything else (empty string, a live URL, free text) is NOT evidence, and any check without
 * valid evidence forces the receipt recommendation to "review".
 */
import { CHECK_NAMES } from "./supporting";

export type EvidenceKind = "data" | "rules" | "calc" | "fixture";

export interface ParsedEvidence {
  kind: EvidenceKind;
  /** data/rules: repo-relative file path. calc: check name. fixture: path incl. query. */
  target: string;
  fragment: string | null;
}

export function parseEvidencePointer(pointer: string): ParsedEvidence | null {
  if (typeof pointer !== "string") return null;
  const p = pointer.trim();
  if (!p) return null;
  // Whitespace is only allowed inside the #fragment (e.g. "#rate_card.Senior Recruiter").
  const splitFrag = (s: string): [string, string | null] => {
    const i = s.indexOf("#");
    return i === -1 ? [s, null] : [s.slice(0, i), s.slice(i + 1) || null];
  };
  if (p.startsWith("data/") || p.startsWith("rules/")) {
    const [target, fragment] = splitFrag(p);
    if (target.includes("..") || /\s/.test(target) || target.endsWith("/")) return null;
    return { kind: p.startsWith("data/") ? "data" : "rules", target, fragment };
  }
  if (p.startsWith("calc:")) {
    const [target, fragment] = splitFrag(p.slice(5));
    if (!(CHECK_NAMES as readonly string[]).includes(target)) return null;
    return { kind: "calc", target, fragment };
  }
  if (p.startsWith("fixture:/")) {
    const target = p.slice(8);
    if (target.startsWith("//") || /\s/.test(target)) return null;
    return { kind: "fixture", target, fragment: null };
  }
  return null;
}

export function isValidEvidencePointer(pointer: string): boolean {
  return parseEvidencePointer(pointer) !== null;
}
