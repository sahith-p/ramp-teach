import { Shell } from "@/components/dash/Shell";

export const dynamic = "force-dynamic";

export default function TeachLayout({ children }: { children: React.ReactNode }) {
  return (
    <Shell active="teach" next="/agents">
      {children}
    </Shell>
  );
}
