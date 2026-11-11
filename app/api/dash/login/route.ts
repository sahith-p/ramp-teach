/** Demo sign-in for the bill-pay dashboard: any email + password works; sets a session cookie. */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const email = String(form?.get("email") ?? "").trim();
  const password = String(form?.get("password") ?? "");
  const nextRaw = String(form?.get("next") ?? "/bills");
  const next = /^\/(bills|agents)(\/[A-Za-z0-9_\-/]*)?$/.test(nextRaw) ? nextRaw : "/bills";
  if (!email || !password) {
    return new Response(null, { status: 303, headers: { Location: "/login?error=1" } });
  }
  return new Response(null, {
    status: 303,
    headers: {
      Location: next,
      "Set-Cookie": `dash_session=${encodeURIComponent(email)}; Path=/; HttpOnly; SameSite=Lax`,
    },
  });
}
