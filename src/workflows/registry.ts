/**
 * Workflow registry: the one place workflows are wired into the generic engine (agent/engine.ts).
 * Tonight there is exactly one workflow.
 */
import type { WorkflowDefinition } from "@/contracts";
import { invoiceReviewWorkflow } from "./invoice-review";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const workflows: Record<string, WorkflowDefinition<any>> = {
  "invoice-review": invoiceReviewWorkflow,
};

export const DEFAULT_WORKFLOW = "invoice-review";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getWorkflow(id: string = DEFAULT_WORKFLOW): WorkflowDefinition<any> {
  const def = workflows[id];
  if (!def) throw new Error(`Unknown workflow "${id}" (known: ${Object.keys(workflows).join(", ")})`);
  return def;
}
