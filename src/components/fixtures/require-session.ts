import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PORTAL_COOKIE, isValidSession } from "./session";

/** Auth gate for every /portal/* page except /portal/login. Redirects without a valid cookie. */
export async function requirePortalSession(): Promise<void> {
  const jar = await cookies();
  if (!isValidSession(jar.get(PORTAL_COOKIE)?.value)) redirect("/portal/login");
}
