/**
 * C4 coverage (code, deterministic). Compares the skill's portal_map with the pages the recording visited and the
 * fields it clicked or typed into.
 *   score = (gold pages found in portal_map + gold fields found in portal_map) / (gold pages + gold fields)
 * Gold pages/fields are hand-written in the case; `observedInRecording` derives the same from the recording so a test
 * keeps the two in agreement. portal_map pages the recording never visited are reported as inventions (notes).
 */
import type { PortalPage, Recording } from "@/contracts";
import { fieldFromSelector, normalizeField, normalizePage } from "./text";

export interface CoverageGrade {
  score: number;
  notes: string[];
}

/** Pages visited (normalized) and fields interacted with, straight from the recording's DOM steps. */
export function observedInRecording(rec: Recording): { pages: string[]; fields: string[] } {
  const pages = new Set<string>();
  const fields = new Set<string>();
  for (const s of rec.steps) {
    if (s.kind !== "dom") continue;
    if (s.detail.url) pages.add(normalizePage(s.detail.url));
    if (s.detail.event === "click" || s.detail.event === "input" || s.detail.event === "change") {
      const f = fieldFromSelector(s.detail.selector);
      if (f) fields.add(f);
    }
  }
  return { pages: [...pages], fields: [...fields] };
}

function mapFields(map: PortalPage[]): Set<string> {
  const out = new Set<string>();
  for (const p of map) {
    for (const f of p.fields) {
      out.add(normalizeField(f.name));
      const fromSel = fieldFromSelector(f.selector);
      if (fromSel) out.add(fromSel);
    }
  }
  return out;
}

export function gradeCoverage(
  portalMap: PortalPage[],
  gold: { pages: string[]; fields: string[] },
  rec: Recording,
): CoverageGrade {
  const notes: string[] = [];
  const mapPages = new Set(portalMap.map((p) => normalizePage(p.page)));
  const fields = mapFields(portalMap);
  let found = 0;
  for (const g of gold.pages) {
    if (mapPages.has(normalizePage(g))) found++;
    else notes.push(`MISSING page ${g}`);
  }
  for (const g of gold.fields) {
    if (fields.has(normalizeField(g))) found++;
    else notes.push(`MISSING field ${g}`);
  }
  const visited = new Set(observedInRecording(rec).pages);
  for (const p of portalMap) {
    if (!visited.has(normalizePage(p.page))) notes.push(`INVENTED page ${p.page} (never visited in the recording)`);
  }
  const total = gold.pages.length + gold.fields.length;
  if (total === 0) return { score: 1, notes: ["No gold pages or fields."] };
  if (found === total) notes.unshift(`All ${gold.pages.length} pages and ${gold.fields.length} fields are in the portal map.`);
  return { score: found / total, notes };
}
