/**
 * Receipt post-pass (generic; no workflow or calc imports). Runs on every receipt the engine writes,
 * whatever produced it (real synthesis or deterministic mock):
 *
 *  1. The calc path is authoritative: every calc check appears on the receipt, and a receipt check whose
 *     result contradicts calc's deterministic result is overridden to calc's result (noted in reasons).
 *  2. Every check must carry ONE valid evidence pointer (contracts/evidence.ts) that resolves to something
 *     real: data/ and rules/ files exist; calc:<check> is in calc.json; fixture:/ pages were visited or
 *     read by the scripted path. Any check without valid evidence forces recommendation "review".
 *  3. "approve" is only allowed when every check passes; a failing check floors it at "dispute",
 *     an unverified one at "review".
 *  4. human_decision / decided_by / decided_at are always null — only POST /api/decisions sets them.
 */
import fs from "node:fs";
import path from "node:path";
import { parseEvidencePointer, type CalcReport, type Receipt, type ReceiptCheck } from "@/contracts";

export interface EnforceContext {
  calc: CalcReport;
  /** fixture:/path?query pointers of pages actually visited/read during this run. */
  visitedFixtures: Iterable<string>;
  /** Repo root for data/ and rules/ resolution. */
  repoRoot: string;
  /** Override for tests. */
  fileExists?: (repoRelative: string) => boolean;
}

export interface EnforceResult {
  receipt: Receipt;
  /** One line per change the post-pass made (also appended to receipt.reasons). */
  notes: string[];
  invalidEvidence: string[];
  overridden: string[];
}

const normFixture = (p: string) => {
  try {
    return decodeURIComponent(p.trim());
  } catch {
    return p.trim();
  }
};

/** Why a pointer does not resolve, or null when it is valid and resolves. */
export function evidenceProblem(pointer: string, ctx: EnforceContext): string | null {
  const parsed = parseEvidencePointer(pointer);
  if (!parsed) return `"${pointer}" is not a valid evidence pointer`;
  switch (parsed.kind) {
    case "data":
    case "rules": {
      const exists =
        ctx.fileExists?.(parsed.target) ??
        (() => {
          const abs = path.resolve(ctx.repoRoot, parsed.target);
          return abs.startsWith(path.resolve(ctx.repoRoot) + path.sep) && fs.existsSync(abs) && fs.statSync(abs).isFile();
        })();
      return exists ? null : `${parsed.target} does not exist`;
    }
    case "calc":
      return ctx.calc.checks.some((c) => c.check === parsed.target) ? null : `calc.json has no check ${parsed.target}`;
    case "fixture": {
      const visited = new Set([...ctx.visitedFixtures].map(normFixture));
      return visited.has(normFixture(pointer)) ? null : `fixture page ${parsed.target} was not visited in this run`;
    }
  }
}

export function enforceReceipt(input: Receipt, ctx: EnforceContext): EnforceResult {
  const notes: string[] = [];
  const invalidEvidence: string[] = [];
  const overridden: string[] = [];
  const byName = new Map<string, ReceiptCheck>();
  for (const c of input.checks) if (!byName.has(c.name)) byName.set(c.name, { ...c });

  const checks: ReceiptCheck[] = [];
  for (const cc of ctx.calc.checks) {
    const existing = byName.get(cc.check);
    if (!existing) {
      const f = cc.findings[0];
      checks.push({
        name: cc.check,
        expected: f?.expected ?? "",
        actual: f?.actual ?? cc.summary,
        result: cc.result,
        evidence: `calc:${cc.check}`,
      });
      notes.push(`Check ${cc.check} was missing from the synthesized receipt; added from the deterministic calc (${cc.result}).`);
      overridden.push(cc.check);
    } else {
      if (existing.result !== cc.result) {
        notes.push(
          `Check ${cc.check}: receipt said "${existing.result}" but the deterministic calc says "${cc.result}"; calc result used (calc is authoritative).`,
        );
        overridden.push(cc.check);
        existing.result = cc.result;
      }
      checks.push(existing);
    }
    byName.delete(cc.check);
  }
  checks.push(...byName.values()); // checks calc does not know about (kept; still need evidence)

  for (const c of checks) {
    const problem = evidenceProblem(c.evidence, ctx);
    if (problem) {
      invalidEvidence.push(c.name);
      notes.push(`Check ${c.name} has no valid evidence (${problem}); recommendation forced to review.`);
    }
  }

  const anyFail = checks.some((c) => c.result === "fail");
  const anyUnverified = checks.some((c) => c.result === "unverified");
  let recommendation = input.recommendation;
  if (invalidEvidence.length > 0) {
    recommendation = "review";
  } else if (recommendation === "approve" && (anyFail || anyUnverified)) {
    recommendation = anyFail ? "dispute" : "review";
    notes.push(`Recommendation "approve" is not allowed with ${anyFail ? "failing" : "unverified"} checks; changed to ${recommendation}.`);
  }
  if (recommendation !== input.recommendation && invalidEvidence.length > 0) {
    notes.push(`Recommendation changed from ${input.recommendation} to review.`);
  }

  const receipt: Receipt = {
    ...input,
    checks,
    recommendation,
    reasons: [...input.reasons, ...notes],
    human_decision: null,
    decided_by: null,
    decided_at: null,
  };
  return { receipt, notes, invalidEvidence, overridden };
}
