import type { DecisionRecord, Invoice, Receipt, SkillRule } from "@/contracts";
import type { ActivityStep, DashBill } from "@/lib/dash";
import type { RunView } from "../teach/server";

export interface BillData {
  bill: DashBill;
  invoice: Invoice | null;
  receipt: Receipt | null;
  activity: { steps: ActivityStep[]; url: string | null };
}

export type BillTabKey = "overview" | "review" | "evidence" | "activity";

export interface BillPageProps {
  billId: string;
  tab: BillTabKey;
  user: string;
  initial: BillData;
  run: RunView;
  /** Rules of the workflow that handled (or would handle) this bill, for "the rule it supports". */
  rules: SkillRule[];
  /** skill_id → title, for the routing card. */
  titles: Record<string, string>;
  decisions: DecisionRecord[];
}

/** Run page of an invoice under Workflows > Runs. */
export const runHref = (workflowId: string, invoiceId: string) => `/bills/workflows/${encodeURIComponent(workflowId)}/runs/${encodeURIComponent(invoiceId)}`;
export const runFileUrl = (invoiceId: string, rel: string) => `/api/runs/${encodeURIComponent(invoiceId)}/file?path=${encodeURIComponent(rel)}`;
