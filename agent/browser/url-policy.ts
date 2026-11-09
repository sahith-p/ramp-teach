/**
 * Browser URL policy (safety boundary). The agent's browser may reach ONLY localhost fixture pages:
 * http(s)://localhost:<port> or http(s)://127.0.0.1:<port>, further narrowed to `allowedOrigins`
 * when given. Pure functions — used by the Playwright driver (navigation + request routing) and by
 * the Anthropic toolset's urlPolicy.
 */

export const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

export class UrlRefusedError extends Error {
  constructor(public url: string, reason: string) {
    super(`Navigation refused: ${reason}. Only localhost fixture pages are allowed.`);
    this.name = "UrlRefusedError";
  }
}

/** True when `raw` is an absolute http(s) URL on localhost / 127.0.0.1. */
export function isLocalUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return (u.protocol === "http:" || u.protocol === "https:") && LOCAL_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

/** Normalize an origin string ("http://localhost:3000/" → "http://localhost:3000"). */
export function normalizeOrigin(o: string): string {
  try {
    return new URL(o).origin;
  } catch {
    return o.replace(/\/+$/, "");
  }
}

/**
 * Resolve `raw` (absolute, or relative to `base`) and check it. Returns the absolute URL or throws
 * UrlRefusedError. `allowedOrigins` empty ⇒ any localhost origin is allowed.
 */
export function checkUrl(raw: string, opts: { base?: string | null; allowedOrigins?: string[] } = {}): string {
  let u: URL;
  try {
    u = opts.base ? new URL(raw, opts.base) : new URL(raw);
  } catch {
    throw new UrlRefusedError(raw, "not a valid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new UrlRefusedError(raw, `scheme ${u.protocol} is not allowed`);
  if (!LOCAL_HOSTS.has(u.hostname)) throw new UrlRefusedError(raw, `host ${u.hostname} is not localhost`);
  const allowed = (opts.allowedOrigins ?? []).map(normalizeOrigin);
  if (allowed.length > 0 && !allowed.includes(u.origin)) {
    throw new UrlRefusedError(raw, `origin ${u.origin} is not one of the allowed fixture origins (${allowed.join(", ")})`);
  }
  return u.toString();
}

/** fixture:/path?query pointer for a local URL (contracts/evidence.ts grammar), or null if not local. */
export function fixturePointerFor(raw: string): string | null {
  if (!isLocalUrl(raw)) return null;
  const u = new URL(raw);
  return `fixture:${u.pathname}${u.search}`;
}
