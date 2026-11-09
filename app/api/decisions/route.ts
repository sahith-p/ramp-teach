import { NextResponse } from "next/server";
import { handleDecision } from "./handler";

export const dynamic = "force-dynamic";

/** Human decisions only. The agent never calls this route. */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const result = handleDecision(body);
  return NextResponse.json(result.body, { status: result.status });
}
