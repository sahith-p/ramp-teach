/**
 * learnSkill (contracts/pillars.ts LearnSkillFn): Recording -> SkillVersion for the invoice-review workflow.
 * Wires the workflow's config (skill id, hints, past invoices + timecards + vendor contract for the checks stage)
 * into the generic learner in ./pipeline.ts. Never reads data/answer_key.json.
 *
 *   await learnSkill(recording)                       real when a key is present, labeled offline otherwise
 *   await learnSkill(recording, { offline: true })    deterministic, no API call
 *   await learnSkill(recording, { persist: false })   learn into a temp dir (evals), no upload
 */
import type { LearnSkillFn, LearnSkillOptions, Recording, SkillVersion } from "@/contracts";
import { invoicePathFor, loadPastInvoices, loadTimecards, loadVendor } from "@/lib/data";
import { invoiceReviewSkill } from "@/workflows/invoice-review/learn";
import { runSkillLearner, type LearnSkillRunOptions, type SkillLearnConfig } from "./pipeline";

export const invoiceReviewSkillConfig: SkillLearnConfig = {
  ...invoiceReviewSkill,
  checkData: () => ({
    invoices: loadPastInvoices().map((invoice) => ({ invoice, path: invoicePathFor(invoice.invoice_id) ?? `data/invoices/past/${invoice.invoice_id}.json` })),
    vendor: loadVendor(),
    // All seeded timecards stand in for the portal evidence (the same data the portal pages show).
    timecards: loadTimecards(),
  }),
};

/** learnSkill with the extra (non-contract) knobs: client, trace file, stage callback. */
export function learnSkillWith(recording: Recording, opts: Omit<LearnSkillRunOptions, "config"> & { config?: SkillLearnConfig } = {}): Promise<SkillVersion> {
  return runSkillLearner(recording, { ...opts, config: opts.config ?? invoiceReviewSkillConfig });
}

export const learnSkill: LearnSkillFn = (recording: Recording, opts?: LearnSkillOptions) => learnSkillWith(recording, opts ?? {});

export { runSkillLearner, STAGE_NAMES, type SkillLearnConfig, type LearnSkillRunOptions, type StageEvent } from "./pipeline";
