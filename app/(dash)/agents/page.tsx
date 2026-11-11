import type { Metadata } from "next";
import { TeachView } from "@/components/dash/TeachView";
import { learnedWorkflow, learnProgress, readLearnJob } from "@/lib/learnjob";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ramp Teach · Ramp" };

export default function TeachPage() {
  const job = readLearnJob();
  return <TeachView initial={{ job, progress: learnProgress(job), ...learnedWorkflow() }} />;
}
