/**
 * Summarize runtime/usage.jsonl (token counts of every real Claude call) with a rough USD estimate.
 * Prices: Claude Opus 5.5 first-party list prices (USD per 1M tokens) — input 4.00, output 20.00,
 * cache read 0.20, cache write (5-min) ~5.00. Estimate only; the billing console is authoritative.
 *   npx tsx scripts/usage.ts
 */
import { readUsage, USAGE_FILE } from "@/lib/usage";

const PRICE = { input: 4.0, output: 20.0, cacheRead: 0.2, cacheWrite: 5.0 };

const rows = readUsage();
if (rows.length === 0) {
  console.log(`No usage recorded (${USAGE_FILE} missing or empty).`);
  process.exit(0);
}
const by = new Map<string, { calls: number; in: number; out: number; cr: number; cw: number }>();
for (const r of rows) {
  const k = r.purpose;
  const a = by.get(k) ?? { calls: 0, in: 0, out: 0, cr: 0, cw: 0 };
  a.calls++;
  a.in += r.input_tokens;
  a.out += r.output_tokens;
  a.cr += r.cache_read_input_tokens;
  a.cw += r.cache_creation_input_tokens;
  by.set(k, a);
}
const cost = (a: { in: number; out: number; cr: number; cw: number }) =>
  (a.in * PRICE.input + a.out * PRICE.output + a.cr * PRICE.cacheRead + a.cw * PRICE.cacheWrite) / 1e6;
let total = 0;
console.log("purpose            calls   input    output   cache_rd  cache_wr   est_usd");
for (const [k, a] of by) {
  const c = cost(a);
  total += c;
  console.log(
    `${k.padEnd(18)} ${String(a.calls).padStart(5)} ${String(a.in).padStart(8)} ${String(a.out).padStart(8)} ${String(a.cr).padStart(9)} ${String(a.cw).padStart(9)}  ${c.toFixed(3).padStart(8)}`,
  );
}
console.log(`TOTAL (recorded calls): ~$${total.toFixed(2)}  (${rows.length} calls, first ${rows[0].ts}, last ${rows[rows.length - 1].ts})`);
