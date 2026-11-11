import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/dash/Sidebar";

export const dynamic = "force-dynamic";

export default async function BillPayLayout({ children }: { children: React.ReactNode }) {
  const session = (await cookies()).get("dash_session")?.value;
  if (!session) redirect("/login");
  return (
    <div className="flex min-h-[calc(100vh-44px)]">
      <Sidebar user={decodeURIComponent(session)} />
      <main className="min-w-0 flex-1 px-10 py-8">{children}</main>
    </div>
  );
}
