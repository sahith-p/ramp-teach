/** Text helpers shared by the skill-eval graders. Pure functions, no I/O. */

/** Lowercase, unify quotes/dashes, drop punctuation that is not inside a token, collapse whitespace. */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[^a-z0-9'\-.]+/g, " ") // keep ' - . for now (I'm, HSG-1010, 1.5)
    .replace(/(^|\s)['\-.]+|['\-.]+(?=\s|$)/g, " ") // strip ' - . at token edges
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(s: string): string[] {
  const n = normalizeText(s);
  return n ? n.split(" ") : [];
}

/** Word-level edit distance with the operation counts (for WER). */
export function wordEditOps(ref: string[], hyp: string[]): { sub: number; del: number; ins: number; distance: number } {
  const n = ref.length;
  const m = hyp.length;
  // dp[i][j] = [cost, sub, del, ins]
  let prev: [number, number, number, number][] = Array.from({ length: m + 1 }, (_, j) => [j, 0, 0, j]);
  for (let i = 1; i <= n; i++) {
    const cur: [number, number, number, number][] = [[i, 0, i, 0]];
    for (let j = 1; j <= m; j++) {
      if (ref[i - 1] === hyp[j - 1]) {
        cur.push([...prev[j - 1]] as [number, number, number, number]);
        continue;
      }
      const s = prev[j - 1];
      const d = prev[j];
      const a = cur[j - 1];
      const best = Math.min(s[0], d[0], a[0]);
      if (best === s[0]) cur.push([s[0] + 1, s[1] + 1, s[2], s[3]]);
      else if (best === d[0]) cur.push([d[0] + 1, d[1], d[2] + 1, d[3]]);
      else cur.push([a[0] + 1, a[1], a[2], a[3] + 1]);
    }
    prev = cur;
  }
  const [distance, sub, del, ins] = prev[m];
  return { sub, del, ins, distance };
}

/** Count non-overlapping occurrences of a token sequence inside another. */
export function countPhrase(haystack: string[], needle: string[]): number {
  if (needle.length === 0) return 0;
  let count = 0;
  for (let i = 0; i + needle.length <= haystack.length; ) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      count++;
      i += needle.length;
    } else i++;
  }
  return count;
}

/** True when `quote` (normalized) appears inside `text` (normalized). Empty quotes never match. */
export function containsQuote(text: string, quote: string): boolean {
  const q = normalizeText(quote);
  if (!q) return false;
  return ` ${normalizeText(text)} `.includes(` ${q} `); // whole-word match only
}

/**
 * Normalize a portal page (URL or path pattern) so concrete visits and learned patterns compare:
 *   "http://localhost:3000/portal/employees/E-101?week=2026-10-11" -> "/portal/employees/<*>?week=<*>"
 *   "/portal/employees/<employee_id>?week=<YYYY-MM-DD>"            -> "/portal/employees/<*>?week=<*>"
 *   "/portal/invoices/HSG-1010"                                     -> "/portal/invoices/<*>"
 */
export function normalizePage(page: string): string {
  let p = page.trim();
  p = p.replace(/^[a-z]+:\/\/[^/]+/i, ""); // drop origin
  p = p.replace(/\{[^}]*\}|:[a-z_]+(?=\/|\?|$)/gi, "<*>"); // {id} and :id placeholder styles
  const [rawPath, rawQuery] = p.split("?");
  const seg = (s: string) =>
    /^<[^>]*>$/.test(s) || /^[A-Z]{1,5}-\d+$/i.test(s) || /^\d{4}-\d{2}-\d{2}$/.test(s) || /^\d+$/.test(s) ? "<*>" : s.toLowerCase();
  const pathPart =
    "/" +
    rawPath
      .split("/")
      .filter(Boolean)
      .map(seg)
      .join("/");
  if (!rawQuery) return pathPart;
  const keys = rawQuery
    .split("&")
    .filter(Boolean)
    .map((kv) => kv.split("=")[0].toLowerCase())
    .sort();
  return `${pathPart}?${keys.map((k) => `${k}=<*>`).join("&")}`;
}

/** Normalize a field name: "Approved hours", "approved_hours", "approvedHours" -> "approved_hours". */
export function normalizeField(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Field name a recorded selector points at, if it names one (data-field, name, id). */
export function fieldFromSelector(selector: string | undefined | null): string | null {
  if (!selector) return null;
  const m =
    /\[data-field=["']?([^"'\]]+)["']?\]/.exec(selector) ??
    /\[name=["']?([^"'\]]+)["']?\]/.exec(selector) ??
    /#([A-Za-z][\w-]*)/.exec(selector);
  return m ? normalizeField(m[1]) : null;
}

export const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
export const round = (x: number, d = 4): number => Number(x.toFixed(d));
