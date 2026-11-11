import { redirect } from "next/navigation";
import { readLearnJob } from "@/lib/learnjob";

export const dynamic = "force-dynamic";

/** Old Ramp Teach page. Workflows now live under Bill Pay; keep this URL for the extension and the film. */
export default async function TeachRedirect({ searchParams }: { searchParams: Promise<{ recording?: string }> }) {
  const { recording } = await searchParams;
  const job = readLearnJob();
  const rec = recording ?? (job?.status === "running" ? job.session_id : undefined);
  redirect(rec ? `/bills/workflows?recording=${encodeURIComponent(rec)}` : "/bills/workflows");
}
