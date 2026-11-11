import { Shell } from "@/components/dash/Shell";

export const dynamic = "force-dynamic";

export default function BillPayLayout({ children }: { children: React.ReactNode }) {
  return (
    <Shell active="bills" next="/bills">
      {children}
    </Shell>
  );
}
