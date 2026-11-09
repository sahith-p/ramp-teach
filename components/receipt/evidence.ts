/**
 * Server-only evidence resolution for the read-only evidence viewer.
 *
 * STRICT path safety: only JSON files under data/, rules/, or runs/<invoice_id>/ are ever read;
 * `..`, absolute paths, backslashes and symlink escapes are rejected; data/answer_key.json (and any
 * file named like an answer key) is blocked explicitly — it is tests/demo-only.
 */
import fs from "node:fs";
import path from "node:path";
import {
  CalcReportSchema,
  parseEvidencePointer,
  type CalcCheckOutput,
  type CheckName,
} from "@/contracts";
import { ROOT } from "@/lib/paths";
import { calcLineFragment, isSafeId, SAMPLE_ID } from "./format";

export type EvidenceView =
  | { kind: "error"; pointer: string; message: string }
  | { kind: "fixture"; pointer: string; href: string }
  | {
      kind: "file";
      pointer: string;
      file: string; // repo-relative
      fragment: string | null;
      missing: boolean;
      content: unknown;
      fragmentFound: boolean;
      fragmentValue: unknown;
    }
  | {
      kind: "calc";
      pointer: string;
      file: string; // repo-relative
      check: CheckName;
      fragment: string | null;
      missing: boolean;
      sample: boolean;
      output: CalcCheckOutput | null;
      computedAt: string | null;
      highlightLine: number | null;
    };

export class UnsafePathError extends Error {}

const isAnswerKey = (rel: string) => /answer_key/i.test(path.basename(rel)) || /answer_key/i.test(rel);

/**
 * Resolve a repo-relative path to an absolute one, enforcing that it stays inside one of
 * `allowedDirs` (repo-relative, e.g. "data", "rules", "runs/HSG-1011"). Throws UnsafePathError.
 */
export function safeRepoFile(rel: string, allowedDirs: string[], root: string = ROOT): string {
  if (typeof rel !== "string" || !rel || rel.includes("\0") || rel.includes("\\")) {
    throw new UnsafePathError("Invalid path.");
  }
  if (path.isAbsolute(rel) || rel.split("/").some((seg) => seg === ".." || seg === ".")) {
    throw new UnsafePathError("Path traversal is not allowed.");
  }
  if (isAnswerKey(rel)) throw new UnsafePathError("The answer key is never shown (tests and demo only).");
  if (!rel.endsWith(".json")) throw new UnsafePathError("Only .json evidence files can be viewed.");

  const absRoot = path.resolve(root);
  const abs = path.resolve(absRoot, rel);
  const inside = (p: string, base: string) => p.startsWith(base + path.sep);
  const allowedAbs = allowedDirs.map((d) => path.resolve(absRoot, d));
  if (!allowedAbs.some((base) => inside(abs, base))) {
    throw new UnsafePathError("Evidence may only come from data/, rules/, or this invoice's runs/ folder.");
  }
  // Symlink escape check: the real path must also stay inside an allowed (real) directory.
  if (fs.existsSync(abs)) {
    const real = fs.realpathSync(abs);
    const realRoot = fs.realpathSync(absRoot);
    const allowedReal = allowedDirs
      .map((d) => path.resolve(realRoot, d))
      .map((d) => (fs.existsSync(d) ? fs.realpathSync(d) : d));
    if (!allowedReal.some((base) => inside(real, base)) || isAnswerKey(path.relative(realRoot, real))) {
      throw new UnsafePathError("Evidence file resolves outside the allowed folders.");
    }
  }
  return abs;
}

/**
 * Resolve a fragment like `line_items[2]`, `contract.rate_card.Senior Recruiter`, `rules[0]`.
 * Array steps accept a numeric index or a string matched against the elements' string fields
 * (e.g. rate_card entry whose `role` is "Senior Recruiter").
 */
export function resolveFragment(doc: unknown, fragment: string): { found: boolean; value: unknown } {
  const tokens: (string | number)[] = [];
  const re = /\[(\d+)\]|([^.[\]/]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fragment))) tokens.push(m[1] !== undefined ? Number(m[1]) : m[2].trim());
  if (tokens.length === 0) return { found: false, value: undefined };

  let cur: unknown = doc;
  for (const tok of tokens) {
    if (Array.isArray(cur)) {
      if (typeof tok === "number" || /^\d+$/.test(tok)) {
        const i = Number(tok);
        if (i >= cur.length) return { found: false, value: undefined };
        cur = cur[i];
        continue;
      }
      const match = (ci: boolean) =>
        cur instanceof Array
          ? cur.find(
              (el) =>
                el !== null &&
                typeof el === "object" &&
                Object.values(el as Record<string, unknown>).some(
                  (v) => typeof v === "string" && (ci ? v.toLowerCase() === tok.toLowerCase() : v === tok),
                ),
            )
          : undefined;
      const hit = match(false) ?? match(true);
      if (hit === undefined) return { found: false, value: undefined };
      cur = hit;
    } else if (cur !== null && typeof cur === "object") {
      const key = String(tok);
      if (!Object.prototype.hasOwnProperty.call(cur, key)) return { found: false, value: undefined };
      cur = (cur as Record<string, unknown>)[key];
    } else {
      return { found: false, value: undefined };
    }
  }
  return { found: true, value: cur };
}

function readJsonFile(abs: string): { missing: boolean; content: unknown } {
  if (!fs.existsSync(abs)) return { missing: true, content: null };
  return { missing: false, content: JSON.parse(fs.readFileSync(abs, "utf8")) };
}

export function resolveEvidence(invoiceId: string, pointer: string, root: string = ROOT): EvidenceView {
  const p = (pointer ?? "").trim();
  if (!isSafeId(invoiceId)) return { kind: "error", pointer: p, message: "Invalid invoice id." };
  const parsed = parseEvidencePointer(p);
  if (!parsed) return { kind: "error", pointer: p, message: "Not a valid evidence pointer (see contracts/evidence.ts)." };

  try {
    if (parsed.kind === "fixture") return { kind: "fixture", pointer: p, href: parsed.target };

    if (parsed.kind === "data" || parsed.kind === "rules") {
      const abs = safeRepoFile(parsed.target, [parsed.kind], root);
      const { missing, content } = readJsonFile(abs);
      const frag = parsed.fragment && !missing ? resolveFragment(content, parsed.fragment) : { found: false, value: undefined };
      return {
        kind: "file",
        pointer: p,
        file: parsed.target,
        fragment: parsed.fragment,
        missing,
        content,
        fragmentFound: frag.found,
        fragmentValue: frag.value,
      };
    }

    // calc:<check>[#line-N] → runs/<invoiceId>/calc.json (the sample reads samples/calc.sample.json).
    const sample = invoiceId === SAMPLE_ID;
    const rel = sample ? "samples/calc.sample.json" : `runs/${invoiceId}/calc.json`;
    const abs = sample ? path.resolve(root, rel) : safeRepoFile(rel, [`runs/${invoiceId}`], root);
    const { missing, content } = readJsonFile(abs);
    const report = missing ? null : CalcReportSchema.safeParse(content);
    if (report && !report.success) {
      return { kind: "error", pointer: p, message: `${rel} does not match the CalcReport contract.` };
    }
    const check = parsed.target as CheckName;
    return {
      kind: "calc",
      pointer: p,
      file: rel,
      check,
      fragment: parsed.fragment,
      missing,
      sample,
      output: report?.data.checks.find((c) => c.check === check) ?? null,
      computedAt: report?.data.computed_at ?? null,
      highlightLine: parsed.fragment ? calcLineFragment(parsed.fragment) : null,
    };
  } catch (e) {
    if (e instanceof UnsafePathError) return { kind: "error", pointer: p, message: e.message };
    if (e instanceof SyntaxError) return { kind: "error", pointer: p, message: "Evidence file is not valid JSON." };
    throw e;
  }
}
