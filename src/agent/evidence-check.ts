/**
 * D4 evidence check — deterministic, no model. After the browser run, every recorded fact is re-read
 * from its source page by plain Playwright code:
 *
 *   navigate(source) → read [data-field=<key>] → compare with the recorded value → crop the element
 *
 * Output: runs/<id>/evidence-check.json (EvidenceCheckReport) and crops at
 * runs/<id>/evidence/<key>-<subject>.png. A page that redirects elsewhere (e.g. the sign-in page)
 * or has no such field is "unavailable", never a guess.
 *
 * Generic: works from the EvidenceBundle + agent facts; it knows nothing about invoices.
 */
import fs from "node:fs";
import path from "node:path";
import {
  EvidenceCheckReportSchema,
  type AgentEvidenceFact,
  type BrowserDriver,
  type EvidenceBundle,
  type EvidenceCheck,
  type EvidenceCheckReport,
} from "@/contracts";
import { parseDataFields } from "./browser/outline";

/** What one check re-reads. */
export interface EvidenceTarget {
  key: string;
  subject: Record<string, string>;
  source: string; // fixture:/path?query
  value: string;
}

/** Optional driver extra (PlaywrightDriver.readField). */
interface FieldReader {
  readField(field: string, cropPath?: string | null): Promise<{ text: string; cropPath: string | null } | null>;
}
const canReadField = (d: unknown): d is FieldReader => typeof (d as Partial<FieldReader> | null)?.readField === "function";

/** Evidence kinds whose value is the page's [data-field=<key>]. */
const KIND_KEY: Record<string, string> = { timecard_hours: "approved_hours" };

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

/** Build the list of facts to re-check: agent facts first, then bundle items and timecard fields not already covered. */
export function evidenceTargets(evidence: EvidenceBundle | null, facts: AgentEvidenceFact[] = []): EvidenceTarget[] {
  const out: EvidenceTarget[] = [];
  const seen = new Set<string>();
  const add = (t: EvidenceTarget) => {
    if (!t.source.startsWith("fixture:/") || !/^[A-Za-z0-9_-]{1,64}$/.test(t.key) || t.value === "") return;
    const k = `${t.source}|${t.key}|${JSON.stringify(Object.entries(t.subject).sort())}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(t);
  };
  const keptSources = new Set((evidence?.items ?? []).map((i) => i.source));
  for (const f of facts) {
    if (evidence && !keptSources.has(f.source)) continue; // facts the workflow rejected are not evidence
    add({ key: f.key, subject: { ...f.subject_ref }, source: f.source, value: str(f.value) });
  }
  for (const i of evidence?.items ?? []) {
    const key = KIND_KEY[i.kind];
    if (!key || i.value === null) continue;
    const subject: Record<string, string> = {};
    if (i.employee_id) subject.employee_id = i.employee_id;
    if (i.week_ending) subject.week_ending = i.week_ending;
    add({ key, subject, source: i.source, value: str(i.value) });
    const tc = evidence?.timecards.find((t) => t.employee_id === i.employee_id && t.week_ending === i.week_ending);
    if (tc) {
      add({ key: "status", subject, source: i.source, value: tc.status });
      if (tc.approved_by && !tc.approved_by.startsWith("(")) add({ key: "approved_by", subject, source: i.source, value: tc.approved_by });
    }
  }
  return out;
}

/** Same value? Numbers compare numerically ("38" = "38.0"), text case-insensitively after trimming. */
export function sameValue(recorded: string, onPage: string): boolean {
  const a = recorded.trim();
  const b = onPage.trim();
  const na = Number(a.replace(/,/g, ""));
  // A numeric recorded value compares with the leading number on the page ("38" vs "38 h").
  if (a !== "" && Number.isFinite(na) && /^-?[\d,]*\.?\d/.test(b)) {
    const nb = parseFloat(b.replace(/,/g, ""));
    return Number.isFinite(nb) && Math.abs(na - nb) < 1e-9;
  }
  return a.toLowerCase() === b.toLowerCase();
}

const slug = (s: string) => s.replace(/[^A-Za-z0-9_]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "x";
export const cropName = (key: string, subject: Record<string, string>) =>
  `${slug(key)}-${slug(Object.values(subject).join("-") || "page")}.png`;

export interface EvidenceCheckOptions {
  invoiceId: string;
  targets: EvidenceTarget[];
  driver: BrowserDriver;
  /** Local fixture origin, e.g. http://localhost:3000 (the driver enforces the localhost policy again). */
  baseUrl: string;
  /** runs/<id>/ — crops go to <runDir>/evidence/, the report to <runDir>/evidence-check.json. */
  runDir: string;
  /** Screenshot paths in the report are relative to this (repo root). */
  repoRoot: string;
  /** Write the report file (default true). */
  write?: boolean;
}

export async function runEvidenceCheck(o: EvidenceCheckOptions): Promise<EvidenceCheckReport> {
  const base = o.baseUrl.replace(/\/+$/, "");
  const cropDir = path.join(o.runDir, "evidence");
  const checks: EvidenceCheck[] = [];
  const bySource = new Map<string, EvidenceTarget[]>();
  for (const t of o.targets) bySource.set(t.source, [...(bySource.get(t.source) ?? []), t]);

  for (const [source, targets] of bySource) {
    const rel = source.slice("fixture:".length);
    let reachable = false;
    let outline: Record<string, string> | null = null;
    try {
      await o.driver.navigate(`${base}${rel}`);
      const want = new URL(rel, "http://x");
      const got = new URL(await o.driver.currentUrl());
      reachable = got.pathname === want.pathname && got.search === want.search;
    } catch {
      reachable = false;
    }
    for (const t of targets) {
      let rechecked: string | null = null;
      let shot: string | null = null;
      if (reachable) {
        try {
          if (canReadField(o.driver)) {
            const abs = path.join(cropDir, cropName(t.key, t.subject));
            const r = await o.driver.readField(t.key, abs);
            if (r) {
              rechecked = r.text;
              shot = r.cropPath ? path.relative(o.repoRoot, r.cropPath).split(path.sep).join("/") : null;
            }
          } else {
            outline ??= parseDataFields(await o.driver.readPage({ filter: "all" }));
            rechecked = outline[t.key] ?? null;
          }
        } catch {
          rechecked = null;
        }
      }
      checks.push({
        key: t.key,
        subject: t.subject,
        source,
        value: t.value,
        rechecked_value: rechecked,
        status: rechecked === null ? "unavailable" : sameValue(t.value, rechecked) ? "match" : "mismatch",
        screenshot: shot,
      });
    }
  }

  const report = EvidenceCheckReportSchema.parse({
    invoice_id: o.invoiceId,
    checked_at: new Date().toISOString(),
    mode: "deterministic",
    checks,
  });
  if (o.write !== false) {
    fs.mkdirSync(o.runDir, { recursive: true });
    fs.writeFileSync(path.join(o.runDir, "evidence-check.json"), JSON.stringify(report, null, 2) + "\n");
  }
  return report;
}

export function summarizeEvidenceCheck(r: EvidenceCheckReport) {
  const count = (s: EvidenceCheck["status"]) => r.checks.filter((c) => c.status === s).length;
  return { checks: r.checks.length, match: count("match"), mismatch: count("mismatch"), unavailable: count("unavailable") };
}
