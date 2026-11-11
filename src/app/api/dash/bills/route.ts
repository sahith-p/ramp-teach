import { listDashBills } from "@/lib/dash";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ bills: listDashBills() });
}
