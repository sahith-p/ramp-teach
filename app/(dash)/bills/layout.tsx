import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { TopBar } from "@/components/dash/BillPayHeader";
import { Sidebar } from "@/components/dash/Sidebar";

export const dynamic = "force-dynamic";

export default async function BillPayLayout({ children }: { children: React.ReactNode }) {
  const session = (await cookies()).get("dash_session")?.value;
  if (!session) redirect("/login");
  return (
    <div className="font-ramp flex min-h-screen bg-white">
      <Sidebar />
      <div className="min-w-0 flex-1">
        <TopBar user={decodeURIComponent(session)} />
        <main className="px-14 pt-6">{children}</main>
      </div>
    </div>
  );
}
