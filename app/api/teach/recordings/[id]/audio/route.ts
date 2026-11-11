/** GET: stream a recording's audio (runtime/recordings/<id>.webm), with Range support for seeking. */
import fs from "node:fs";
import { Readable } from "node:stream";
import { recordingAudio } from "@/components/dash/teach/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const a = recordingAudio(id);
  if (!a) return new Response("not found", { status: 404 });
  const size = fs.statSync(a.file).size;
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  const base = { "Content-Type": a.mime, "Accept-Ranges": "bytes", "Cache-Control": "no-store" };
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    end = Math.min(end, size - 1);
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    start = Math.max(0, start);
    const body = Readable.toWeb(fs.createReadStream(a.file, { start, end })) as ReadableStream;
    return new Response(body, {
      status: 206,
      headers: { ...base, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${size}` },
    });
  }
  const body = Readable.toWeb(fs.createReadStream(a.file)) as ReadableStream;
  return new Response(body, { headers: { ...base, "Content-Length": String(size) } });
}
