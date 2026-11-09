import { redirect } from "next/navigation";
import { requirePortalSession } from "@/components/fixtures/require-session";

export default async function PortalIndex() {
  await requirePortalSession();
  redirect("/portal/invoices");
}
