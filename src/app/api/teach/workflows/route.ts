/** GET: workflows (skills) with vendor, active version, last run, eval status; plus the learn job if any. */
import { learnView, listWorkflows } from "@/components/dash/teach/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ workflows: listWorkflows(), learn: learnView() });
}
