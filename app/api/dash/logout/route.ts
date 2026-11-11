export async function POST() {
  return new Response(null, {
    status: 303,
    headers: { Location: "/login", "Set-Cookie": "dash_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax" },
  });
}
