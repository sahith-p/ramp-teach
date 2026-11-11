import { cookies } from "next/headers";
import { TopBar } from "./BillPayHeader";
import { Sidebar } from "./Sidebar";

/** Signed-in demo user when nobody signed in through /login (the demo opens straight into the app). */
export const DEMO_USER = "alex@northwind.test";

export async function currentUser(): Promise<string> {
  const session = (await cookies()).get("dash_session")?.value;
  return session ? decodeURIComponent(session) : DEMO_USER;
}

/** Ramp app shell (signed in): sidebar + top bar. */
export async function Shell({ children }: { active?: "bills"; next?: string; children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <div className="font-ramp flex min-h-screen bg-white">
      <Sidebar active="bills" />
      <div className="min-w-0 flex-1">
        <TopBar user={user} />
        <main className="px-14 pt-6">{children}</main>
      </div>
    </div>
  );
}
