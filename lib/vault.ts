/**
 * Credential vault (server-side only). The browser agent never sees a password: the harness's `sign_in` tool
 * (agent/browser/sign-in.ts) reads a credential from here and fills the portal's sign-in form itself, and the
 * scripted evidence path does the same.
 *
 * Lookup order for a portal id (e.g. "halcyon"):
 *   1. env   RAMP_TEACH_VAULT_<PORTAL>_USERNAME + RAMP_TEACH_VAULT_<PORTAL>_PASSWORD (both required)
 *   2. file  runtime/vault.json (gitignored): { "<portal>": { "username": "...", "password": "..." } }
 *   3. built-in default — ONLY for the local fixture portal "halcyon", whose demo credentials are public on its own
 *      sign-in page (synthetic data, not a secret). A real portal would have no default: configure it via env or
 *      runtime/vault.json.
 *
 * Never log or trace a password. `describeCredential` is the only shape meant for logs/traces.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { P } from "./paths";

export interface Portal {
  id: string;
  /** Human label for prompts and traces. */
  label: string;
  /** Sign-in page path on the fixture app's origin. */
  loginPath: string;
}

/** Portals the harness knows how to sign in to. */
export const PORTALS: Record<string, Portal> = {
  halcyon: { id: "halcyon", label: "Halcyon Staffing vendor portal (fixture)", loginPath: "/portal/login" },
};

export const portalIds = (): string[] => Object.keys(PORTALS);
export const getPortal = (portalId: string): Portal | null => PORTALS[portalId] ?? null;

export interface Credential {
  username: string;
  password: string;
  source: "env" | "file" | "default";
}

/** Public demo credentials of the LOCAL fixture portal (shown on its sign-in page). Not a secret. */
const FIXTURE_DEFAULTS: Record<string, { username: string; password: string }> = {
  halcyon: { username: "ap.reviewer", password: "demo-only" },
};

const VaultFileSchema = z.record(z.string(), z.object({ username: z.string().min(1), password: z.string().min(1) }));

export const vaultFile = () => path.join(P.runtime, "vault.json");

const envKey = (portalId: string, field: "USERNAME" | "PASSWORD") =>
  `RAMP_TEACH_VAULT_${portalId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_${field}`;

export interface VaultOptions {
  env?: Record<string, string | undefined>;
  file?: string;
  /** false ⇒ no built-in fixture default (tests). */
  allowDefault?: boolean;
}

/** The credential for a portal, or null when none is configured. */
export function getCredential(portalId: string, opts: VaultOptions = {}): Credential | null {
  const env = opts.env ?? process.env;
  const username = env[envKey(portalId, "USERNAME")];
  const password = env[envKey(portalId, "PASSWORD")];
  if (username && password) return { username, password, source: "env" };

  const file = opts.file ?? vaultFile();
  try {
    if (fs.existsSync(file)) {
      const parsed = VaultFileSchema.safeParse(JSON.parse(fs.readFileSync(file, "utf8")));
      const entry = parsed.success ? parsed.data[portalId] : undefined;
      if (entry) return { ...entry, source: "file" };
    }
  } catch {
    // Unreadable / malformed vault file: fall through (never echo its contents).
  }

  const def = opts.allowDefault === false ? undefined : FIXTURE_DEFAULTS[portalId];
  return def ? { ...def, source: "default" } : null;
}

/** Log/trace-safe description of a credential: never the password. */
export function describeCredential(portalId: string, c: Credential | null): { portal: string; username: string | null; source: string | null } {
  return { portal: portalId, username: c?.username ?? null, source: c?.source ?? null };
}
