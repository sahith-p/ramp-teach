import type { BillStatus, CheckResult, Recommendation } from "@/contracts";
import { Badge } from "@/components/ui/Badge";

export function ResultBadge({ result }: { result: CheckResult }) {
  const tone = result === "pass" ? "pass" : result === "fail" ? "fail" : "warn";
  const label = result === "pass" ? "Pass" : result === "fail" ? "Fail" : "Unverified";
  return <Badge tone={tone}>{label}</Badge>;
}

export const RECOMMENDATION_WORD: Record<Recommendation, string> = {
  approve: "Approve",
  dispute: "Dispute",
  review: "Review",
};

export function DecisionBadge({ decision }: { decision: "approve" | "dispute" | null }) {
  if (!decision) return <Badge>Awaiting decision</Badge>;
  return <Badge tone={decision === "approve" ? "pass" : "fail"}>{decision === "approve" ? "Approved" : "Disputed"}</Badge>;
}

export function BillStatusBadge({ status }: { status: BillStatus }) {
  const tone = status === "approved" ? "pass" : status === "disputed" ? "fail" : "neutral";
  const label = { pending: "Pending", receipt_attached: "Receipt attached", approved: "Approved", disputed: "Disputed" }[status];
  return <Badge tone={tone}>{label}</Badge>;
}
