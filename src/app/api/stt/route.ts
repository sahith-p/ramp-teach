/**
 * POST /api/stt: the Recorder side panel sends a recording (and its audio) when recording stops.
 *
 *   multipart/form-data   recording=<Recording JSON>  audio=<file> (one per take, in order)
 *                         takes=<[{offset_s, duration_s}] JSON>  peaks=<number[] JSON>  page_terms=<string[] JSON>
 *                         operator=human|scripted_playwright  language=<ISO code, optional>
 *   application/json      { recording, operator?, provider?: "simulated", page_terms?, peaks? }   (no audio)
 *
 * Saves audio to runtime/recordings/<session_id>.webm, transcribes (ElevenLabs Scribe v2 when
 * ELEVENLABS_API_KEY is set and audio is present; the scripted demo voice when the operator is scripted or
 * there is no audio; otherwise 503), aligns words to the recorded clicks, writes
 * runtime/recordings/<session_id>.peaks.json, and returns the recording with `audio` and `speech` filled.
 * Local demo only.
 */
import { runStt, type AudioTake, type SttInput } from "@/lib/speech/stt";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function json(text: FormDataEntryValue | null): unknown {
  if (typeof text !== "string" || !text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export async function POST(req: Request) {
  if (!LOCAL.test(new URL(req.url).origin)) return Response.json({ error: "local demo only" }, { status: 403 });
  const type = req.headers.get("content-type") ?? "";
  let input: SttInput;
  if (type.includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    if (!form) return Response.json({ error: "bad form data" }, { status: 400 });
    const meta = json(form.get("takes"));
    const takesMeta = Array.isArray(meta) ? (meta as { offset_s?: unknown; duration_s?: unknown }[]) : [];
    const files = form.getAll("audio").filter((f): f is File => typeof f !== "string");
    const audio: AudioTake[] = [];
    for (const [i, f] of files.entries()) {
      const m = takesMeta[i] ?? {};
      const d = Number(m.duration_s);
      audio.push({
        bytes: new Uint8Array(await f.arrayBuffer()),
        mime: f.type || "audio/webm",
        offset_s: Math.max(0, Number(m.offset_s) || 0),
        duration_s: m.duration_s != null && Number.isFinite(d) ? d : undefined,
      });
    }
    const lang = form.get("language");
    input = {
      recording: json(form.get("recording")),
      operator: String(form.get("operator") ?? ""),
      audio,
      peaks: json(form.get("peaks")),
      pageTerms: json(form.get("page_terms")),
      language: typeof lang === "string" ? lang : null,
    };
  } else {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return Response.json({ error: "send JSON or multipart form data" }, { status: 400 });
    input = { recording: body.recording, operator: String(body.operator ?? ""), peaks: body.peaks, pageTerms: body.page_terms };
  }
  if (!input.recording) return Response.json({ error: "recording required" }, { status: 400 });
  const res = await runStt(input);
  return Response.json(res.body, { status: res.status });
}
