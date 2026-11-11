/**
 * C5 replay_agreement (code, deterministic; calc/ only, no LLM).
 *
 * The skill's rules are mapped to CHECK_NAMES (judge or keyword mapping, plus the skill's own checks list). calc/ runs
 * ONLY those checks on every past invoice; the skill's decision rule (dispute on any failure, else approve) gives a
 * predicted outcome. The target is the past outcome a reviewer following THIS recording would have reached:
 * an invoice is "dispute" when data/corrections.json records a correction on it whose check is one of the case's
 * gold checks, else "approve". With all six gold checks this equals the past bill status in data/bills.json.
 * An invoice agrees when the decision matches and, for disputes, the corrected check is among the failing checks
 * (caught for the right reason).
 *
 * Timecards come from data/timecards.json (the portal's backend data) because the replay does not drive a browser;
 * this is the eval harness, not the agent. Never reads data/answer_key.json.
 */
import type { Bill, CheckName, Correction, Invoice, Timecard, VendorProfile } from "@/contracts";
import { CHECKS } from "@/calc";

export interface ReplayWorld {
  pastInvoices: { invoice: Invoice; path: string }[];
  vendor: VendorProfile;
  timecards: Timecard[];
  corrections: Correction[];
  bills: Bill[];
}

export interface ReplayGrade {
  score: number;
  notes: string[];
  /** Per-invoice detail for the dashboard. */
  rows: { invoice_id: string; predicted: "approve" | "dispute"; target: "approve" | "dispute"; failing: CheckName[]; agree: boolean }[];
}

export async function loadReplayWorld(): Promise<ReplayWorld> {
  const { loadPastInvoices, loadVendor, loadTimecards, loadCorrections, loadBillsSeed, invoicePathFor } = await import(
    "@/lib/data"
  );
  return {
    pastInvoices: loadPastInvoices().map((invoice) => ({
      invoice,
      path: invoicePathFor(invoice.invoice_id) ?? `data/invoices/past/${invoice.invoice_id}.json`,
    })),
    vendor: loadVendor(),
    timecards: loadTimecards(),
    corrections: loadCorrections(),
    bills: loadBillsSeed(),
  };
}

export function gradeReplay(skillChecks: CheckName[], goldChecks: CheckName[], world: ReplayWorld): ReplayGrade {
  const notes: string[] = [];
  const rows: ReplayGrade["rows"] = [];
  const gold = new Set(goldChecks);
  const checks = [...new Set(skillChecks)];
  if (world.pastInvoices.length === 0) return { score: 0, notes: ["No past invoices to replay."], rows };

  for (const { invoice, path } of world.pastInvoices) {
    const input = { invoice, vendor: world.vendor, timecards: world.timecards, invoicePath: path };
    const failing = checks.filter((c) => CHECKS[c](input).result === "fail");
    const predicted = failing.length > 0 ? "dispute" : "approve";
    const relevant = world.corrections.filter((c) => c.invoice_id === invoice.invoice_id && gold.has(c.check));
    const target = relevant.length > 0 ? "dispute" : "approve";
    const rightReason = relevant.every((c) => failing.includes(c.check));
    const agree = predicted === target && (target === "approve" || rightReason);
    rows.push({ invoice_id: invoice.invoice_id, predicted, target, failing, agree });
    if (!agree) {
      if (predicted !== target) {
        notes.push(
          target === "dispute"
            ? `DISAGREE ${invoice.invoice_id}: past reviewer disputed (${relevant.map((c) => `${c.correction_id} ${c.check}`).join(", ")}); the skill's checks all pass`
            : `DISAGREE ${invoice.invoice_id}: past outcome approve; the skill would dispute (${failing.join(", ")} fail)`,
        );
      } else {
        notes.push(
          `DISAGREE ${invoice.invoice_id}: both dispute, but for the wrong reason (corrected: ${relevant.map((c) => c.check).join(", ")}; failing: ${failing.join(", ")})`,
        );
      }
    }
  }
  const agreeN = rows.filter((r) => r.agree).length;
  notes.unshift(
    `Skill checks replayed: ${checks.length ? checks.join(", ") : "none"}. Agreed with ${agreeN}/${rows.length} past outcomes.`,
  );
  const missingGold = goldChecks.filter((c) => !checks.includes(c));
  if (missingGold.length) notes.push(`The skill has no rule for: ${missingGold.join(", ")}`);
  const extra = checks.filter((c) => !gold.has(c));
  if (extra.length) notes.push(`The skill checks more than the recording shows: ${extra.join(", ")}`);
  // Raw past bill status, for reference (equals the target when all six checks are gold).
  const billDisagree = rows.filter((r) => {
    const b = world.bills.find((x) => x.bill_id === `bill_${r.invoice_id}`);
    return b && (b.status === "disputed" ? "dispute" : "approve") !== r.predicted;
  });
  if (billDisagree.length)
    notes.push(`Versus the raw past bill status: ${rows.length - billDisagree.length}/${rows.length} agree.`);
  return { score: agreeN / rows.length, notes, rows };
}
