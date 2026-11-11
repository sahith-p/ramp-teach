import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { TopBar } from "./BillPayHeader";
import { Sidebar } from "./Sidebar";

/** Ramp app shell (signed in): sidebar + top bar. */
export async function Shell({ active, next, children }: { active: "bills" | "teach"; next: string; children: React.ReactNode }) {
  const session = (await cookies()).get("dash_session")?.value;
  if (!session) redirect(`/login?next=${encodeURIComponent(next)}`);
  return (
    <div className="font-ramp flex min-h-screen bg-white">
      <Sidebar active={active} />
      <div className="min-w-0 flex-1">
        <TopBar user={decodeURIComponent(session)} />
        <main className="px-14 pt-6">{children}</main>
      </div>
    </div>
  );
}
