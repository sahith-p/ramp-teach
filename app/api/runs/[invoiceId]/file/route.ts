/** GET ?path=runs/<id>/...png: a screenshot or evidence crop of this run. Only images under runs/<id>/. */
import fs from "node:fs";
import { resolveRunImage } from "@/components/dash/teach/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await ctx.params;
  const abs = resolveRunImage(invoiceId, new URL(req.url).searchParams.get("path") ?? "");
  if (!abs) return new Response("not found", { status: 404 });
  const type = /\.png$/i.test(abs) ? "image/png" : /\.webp$/i.test(abs) ? "image/webp" : "image/jpeg";
  return new Response(new Uint8Array(fs.readFileSync(abs)), { headers: { "Content-Type": type, "Cache-Control": "private, max-age=60" } });
}
