/** GET: the learn job started by the extension's Send to Ramp, with its stages (runtime/learn-job.json). */
import { learnView } from "@/components/dash/teach/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ learn: learnView() });
}
