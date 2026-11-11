import { NextResponse } from "next/server";
import { PORTAL_COOKIE } from "@/components/fixtures/session";

export async function POST() {
  const res = new NextResponse(null, { status: 303, headers: { Location: "/portal/login" } });
  res.cookies.set(PORTAL_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
