/**
 * Harness-side portal sign-in from the credential vault (lib/vault.ts). Used by the browser loop's custom
 * `sign_in` tool (the model asks for a portal by id; it never sees or types the password) and by the
 * scripted evidence path. The password goes only into the driver's form fill: it is never returned, traced
 * or put in an error message.
 */
import type { BrowserDriver } from "@/contracts";
import { getCredential as vaultGetCredential, getPortal, type Credential } from "@/lib/vault";

export interface SignInOptions {
  /** Fixture app origin, e.g. http://localhost:3000. */
  baseUrl: string;
  portal: string;
  /** Override for tests. */
  getCredential?: (portalId: string) => Credential | null;
}

export type SignInResult =
  | { ok: true; portal: string; username: string; source: Credential["source"]; landed: string; alreadySignedIn: boolean }
  | { ok: false; portal: string; error: string };

export async function signInToPortal(driver: BrowserDriver, opts: SignInOptions): Promise<SignInResult> {
  const { portal } = opts;
  const p = getPortal(portal);
  if (!p) return { ok: false, portal, error: `Unknown portal "${portal}".` };
  const cred = (opts.getCredential ?? vaultGetCredential)(portal);
  if (!cred) return { ok: false, portal, error: `No credential in the vault for portal "${portal}".` };
  const redact = (s: string) => (cred.password ? s.split(cred.password).join("[redacted]") : s);
  try {
    const base = opts.baseUrl.replace(/\/+$/, "");
    await driver.navigate(`${base}${p.loginPath}`);
    const at = new URL(await driver.currentUrl()).pathname;
    if (at !== p.loginPath) {
      return { ok: true, portal, username: cred.username, source: cred.source, landed: at, alreadySignedIn: true };
    }
    const user = (await driver.find("username")).find((r) => r.role.startsWith("textbox") && !r.role.includes("password"));
    const pass = (await driver.find("password")).find((r) => r.role.includes("password"));
    const submit = (await driver.find("Sign in")).find((r) => r.role === "button");
    if (!user || !pass || !submit) return { ok: false, portal, error: `Sign-in form fields not found on ${p.loginPath}.` };
    await driver.formInput(user.ref, cred.username);
    await driver.formInput(pass.ref, cred.password);
    await driver.click({ type: "ref", ref: submit.ref });
    const landed = new URL(await driver.currentUrl()).pathname;
    if (landed === p.loginPath) return { ok: false, portal, error: "Still on the sign-in page after submitting (credential rejected?)." };
    return { ok: true, portal, username: cred.username, source: cred.source, landed, alreadySignedIn: false };
  } catch (e) {
    return { ok: false, portal, error: redact(`Sign-in failed: ${e instanceof Error ? e.message : String(e)}`).slice(0, 300) };
  }
}
