/** GET ?from=<n>&to=<n>: rule diff between two versions (added / removed / changed). Defaults: latest vs previous. */
import { diffRules } from "@/components/dash/teach/logic";
import { workflowDetail } from "@/components/dash/teach/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ skillId: string }> }) {
  const { skillId } = await ctx.params;
  const d = workflowDetail(skillId);
  if (!d) return Response.json({ error: "not found" }, { status: 404 });
  const q = new URL(req.url).searchParams;
  const nums = d.versions.map((v) => v.version);
  const to = Number(q.get("to") ?? nums.at(-1));
  const from = Number(q.get("from") ?? nums.filter((n) => n < to).at(-1));
  const a = d.versions.find((v) => v.version === from);
  const b = d.versions.find((v) => v.version === to);
  if (!a || !b) return Response.json({ error: "unknown version" }, { status: 404 });
  return Response.json({ skill_id: skillId, from, to, diff: diffRules(a.rules, b.rules) });
}
