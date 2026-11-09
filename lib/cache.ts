/**
 * Disk cache for model outputs (spending guardrail). Keyed by a SHA-256 of the request.
 * Lives under runtime/cache/ (gitignored). Set RAMP_TEACH_NO_CACHE=1 to bypass.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { P } from "./paths";

export const CACHE_DIR = path.join(P.runtime, "cache");

export function cacheKey(namespace: string, parts: unknown): string {
  const h = crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 24);
  return `${namespace}-${h}`;
}

export function readCache<T>(key: string): T | null {
  if (process.env.RAMP_TEACH_NO_CACHE === "1") return null;
  const f = path.join(CACHE_DIR, `${key}.json`);
  if (!fs.existsSync(f)) return null;
  try {
    return JSON.parse(fs.readFileSync(f, "utf8")) as T;
  } catch {
    return null;
  }
}

export function writeCache<T>(key: string, value: T): void {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(value, null, 2) + "\n");
}

/** Return the cached value for `key`, or compute, store, and return it. `hit` says which. */
export async function cached<T>(key: string, fn: () => Promise<T>): Promise<{ value: T; hit: boolean }> {
  const hitVal = readCache<T>(key);
  if (hitVal !== null) return { value: hitVal, hit: true };
  const value = await fn();
  writeCache(key, value);
  return { value, hit: false };
}
