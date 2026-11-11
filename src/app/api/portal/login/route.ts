import { NextResponse, type NextRequest } from "next/server";
import { PORTAL_COOKIE, PORTAL_SESSION_VALUE, checkCredentials } from "@/components/fixtures/session";

/**
 * Form POST from /portal/login (JSON also accepted). 303 to /portal/invoices with cookie
 * `portal_session`, or 303 to /portal/login?error=1. Relative Location headers keep the redirect
 * on whichever localhost origin served the form.
 */
export async function POST(req: NextRequest) {
  let username: unknown = null;
  let password: unknown = null;
  try {
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const body = (await req.json()) as Record<string, unknown>;
      username = body.username;
      password = body.password;
    } else {
      const form = await req.formData();
      username = form.get("username");
      password = form.get("password");
    }
  } catch {
    // malformed body: treated as bad credentials below
  }

  if (!checkCredentials(username, password)) {
    return new NextResponse(null, { status: 303, headers: { Location: "/portal/login?error=1" } });
  }
  const res = new NextResponse(null, { status: 303, headers: { Location: "/portal/invoices" } });
  res.cookies.set(PORTAL_COOKIE, PORTAL_SESSION_VALUE, { httpOnly: true, sameSite: "lax", path: "/" });
  return res;
}
