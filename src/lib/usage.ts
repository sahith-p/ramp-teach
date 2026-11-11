/**
 * API usage ledger (spending guardrail). Every real Claude call appends one line to
 * runtime/usage.jsonl with token counts — never prompts, outputs, or credentials.
 * `npx tsx scripts/usage.ts` summarizes it with a rough USD estimate.
 */
import fs from "node:fs";
import path from "node:path";
import { P } from "./paths";

export const USAGE_FILE = path.join(P.runtime, "usage.jsonl");

export interface UsageRecord {
  ts: string;
  purpose: string; // "learn" | "browser-turn" | "synthesis" | ...
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  /** Anthropic's request id (response header) and message id: lets anyone match a line to the API's own logs. */
  request_id?: string | null;
  message_id?: string | null;
}

/** Accepts the SDK's `usage` object (or anything shaped like it). Never throws. */
export function recordUsage(purpose: string, model: string, usage: unknown, ids?: { request_id?: string | null; message_id?: string | null }): void {
  if (process.env.VITEST) return; // unit tests use fake clients; keep the ledger to real calls
  try {
    const u = (usage ?? {}) as Record<string, unknown>;
    const n = (k: string) => (typeof u[k] === "number" ? (u[k] as number) : 0);
    const rec: UsageRecord = {
      ts: new Date().toISOString(),
      purpose,
      model,
      input_tokens: n("input_tokens"),
      output_tokens: n("output_tokens"),
      cache_read_input_tokens: n("cache_read_input_tokens"),
      cache_creation_input_tokens: n("cache_creation_input_tokens"),
      request_id: ids?.request_id ?? null,
      message_id: ids?.message_id ?? null,
    };
    fs.mkdirSync(path.dirname(USAGE_FILE), { recursive: true });
    fs.appendFileSync(USAGE_FILE, JSON.stringify(rec) + "\n");
  } catch {
    /* usage accounting must never break a run */
  }
}

export function readUsage(): UsageRecord[] {
  if (!fs.existsSync(USAGE_FILE)) return [];
  return fs
    .readFileSync(USAGE_FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as UsageRecord);
}
