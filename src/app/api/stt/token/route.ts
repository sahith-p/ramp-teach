/**
 * GET /api/stt/token: a single-use ElevenLabs token for Scribe v2 Realtime, so the side panel can stream the
 * mic for a live preview without ever holding the API key. The token expires after 15 minutes and works once.
 * 503 when ELEVENLABS_API_KEY is not set (the panel then falls back to the browser's dictation, labeled).
 * Docs: https://elevenlabs.io/docs/api-reference/tokens/create (see lib/speech/elevenlabs.ts). Local demo only.
 */
import { createRealtimeToken, ELEVENLABS_REALTIME_MODEL, ELEVENLABS_REALTIME_WS, elevenLabsKey, ElevenLabsError } from "@/lib/speech/elevenlabs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export async function GET(req: Request) {
  if (!LOCAL.test(new URL(req.url).origin)) return Response.json({ error: "local demo only" }, { status: 403 });
  if (!elevenLabsKey()) return Response.json({ error: "ELEVENLABS_API_KEY is not set" }, { status: 503 });
  try {
    const token = await createRealtimeToken();
    return Response.json(
      { token, model_id: ELEVENLABS_REALTIME_MODEL, ws_url: ELEVENLABS_REALTIME_WS, audio_format: "pcm_16000" },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    const status = e instanceof ElevenLabsError && e.status === 503 ? 503 : 502;
    return Response.json({ error: e instanceof Error ? e.message : "token request failed" }, { status });
  }
}
