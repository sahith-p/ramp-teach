import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecordingSchema, SpeechTranscriptSchema, type Recording, type SpeechWord } from "@/contracts";
import {
  alignUtterances,
  cleanKeyterm,
  confidenceFromLogprob,
  createRealtimeToken,
  elevenLabsTranscript,
  keytermsFromRecording,
  lineWords,
  linkSteps,
  normalizeKeyterms,
  readPeaks,
  runStt,
  simulatedPeaks,
  simulatedTranscript,
  simulatedWords,
  splitUtterances,
  tokens,
  transcribeElevenLabs,
  transcriptWords,
  wordsFromElevenLabs,
  type ElevenLabsResponse,
} from "./index";

const FIX = path.join(__dirname, "__fixtures__");
const film = RecordingSchema.parse(JSON.parse(fs.readFileSync(path.join(FIX, "film-recording.json"), "utf8")));
const scribe = JSON.parse(fs.readFileSync(path.join(FIX, "elevenlabs-scribe-v2.json"), "utf8")) as ElevenLabsResponse;

const w = (text: string, start: number, end: number, confidence?: number): SpeechWord => ({ text, start, end, ...(confidence !== undefined ? { confidence } : {}) });

/* ------------------------------------------------------------------ alignment */

describe("tokens", () => {
  it("keeps numbers, IDs and stems; drops stop words and selector plumbing", () => {
    const t = tokens("Sam's approved for 36 hours on E-104, see HSG 1010");
    expect(t.has("36")).toBe(true);
    expect(t.has("e104")).toBe(true);
    expect(t.has("hsg1010")).toBe(true);
    expect(t.has("hour")).toBe(true);
    expect(t.has("approv")).toBe(true);
    expect(t.has("sam")).toBe(true);
    expect(t.has("for")).toBe(false);
    expect([...tokens('div > form > button[name="x"]')]).toEqual([]);
  });
});

describe("splitUtterances", () => {
  it("splits on end punctuation and long pauses", () => {
    const groups = splitUtterances([w("One", 0, 0.2), w("two.", 0.3, 0.5), w("Three", 0.6, 0.8), w("four", 2.5, 2.7)]);
    expect(groups.map((g) => g.map((x) => x.text).join(" "))).toEqual(["One two.", "Three", "four"]);
  });
});

describe("alignUtterances on the film recording", () => {
  const utts = alignUtterances(simulatedWords(film), film);
  const byText = (s: string) => utts.find((u) => u.text.startsWith(s))!;

  it("links the hours line to the approved_hours click (time + lexical: 40, approved, hours)", () => {
    const u = byText("Maya is approved for 40 hours.");
    const idx = film.steps.findIndex((s) => s.detail.selector === '[data-field="approved_hours"]' && s.detail.text === "40");
    expect(idx).toBeGreaterThan(0);
    expect(u.step_refs).toContain(idx);
  });

  it("links 'Sam is approved for 36' to the 36 hours click, not Maya's", () => {
    const u = byText("Sam is approved for 36.");
    const sam = film.steps.findIndex((s) => s.detail.text === "36");
    const maya = film.steps.findIndex((s) => s.detail.text === "40");
    expect(u.step_refs).toContain(sam);
    expect(u.step_refs).not.toContain(maya);
  });

  it("splits a two-sentence narration line into two utterances with ids in order", () => {
    expect(byText("Billed hours can't go over that.")).toBeTruthy();
    expect(utts.map((u) => u.id)).toEqual(utts.map((_, i) => `u${i + 1}`));
    expect(utts.length).toBe(8);
  });

  it("falls back to the nearest click when nothing matches lexically", () => {
    const u = byText("Every rate on it has to match our contract.");
    expect(u.step_refs.length).toBe(1);
    expect(film.steps[u.step_refs[0]].detail.event).toBe("click");
  });

  it("is deterministic", () => {
    expect(alignUtterances(simulatedWords(film), film)).toEqual(utts);
  });

  it("lists low-confidence words", () => {
    const rec: Recording = { session_id: "s", started_at: film.started_at, steps: [], transcript: [] };
    const [u] = alignUtterances([w("Sam", 0, 0.3, 0.3), w("is", 0.3, 0.4, 0.99), w("fine.", 0.4, 0.8, 0.59)], rec);
    expect(u.low_confidence).toEqual(["Sam", "fine."]);
  });
});

describe("linkSteps", () => {
  it("ignores steps outside the time window", () => {
    const t0 = "2026-01-01T00:00:00.000Z";
    const at = (s: number) => new Date(Date.parse(t0) + s * 1000).toISOString();
    const rec = {
      started_at: t0,
      steps: [
        { ts: at(1), kind: "dom" as const, detail: { event: "click", selector: '[data-field="approved_hours"]', text: "40" } },
        { ts: at(60), kind: "dom" as const, detail: { event: "click", selector: '[data-field="approved_hours"]', text: "40" } },
      ],
    };
    expect(linkSteps({ text: "approved for 40 hours", start: 2, end: 4 }, rec)).toEqual([0]);
  });
});

/* -------------------------------------------------------------- demo voice */

describe("simulatedTranscript", () => {
  const sim = simulatedTranscript(film);

  it("is labeled scripted, provider simulated, and matches the contract", () => {
    expect(SpeechTranscriptSchema.parse(sim)).toBeTruthy();
    expect(sim.provider).toBe("simulated");
    expect(sim.mode).toBe("scripted");
    expect(sim.model).toBeNull();
  });

  it("starts each line at its narration step and speaks ~2.6 words/s with confidence 1", () => {
    const words = lineWords("one two three four five six seven eight nine ten eleven twelve thirteen", 10);
    expect(words[0].start).toBe(10);
    const span = words[words.length - 1].end - words[0].start;
    expect(13 / span).toBeGreaterThan(2.4);
    expect(13 / span).toBeLessThan(3.4);
    expect(words.every((x) => x.confidence === 1)).toBe(true);
  });

  it("never runs a line into the next one", () => {
    const words = transcriptWords(sim.utterances);
    for (let i = 1; i < words.length; i++) expect(words[i].start).toBeGreaterThanOrEqual(words[i - 1].end);
    const lines = film.steps.filter((s) => s.kind === "narration");
    expect(words.map((x) => x.text).join(" ")).toBe(lines.map((s) => s.detail.text).join(" "));
  });

  it("keeps every narration word, in order, and has no low-confidence words", () => {
    expect(sim.utterances.every((u) => u.low_confidence.length === 0)).toBe(true);
  });
});

/* ---------------------------------------------------------------- keyterms */

describe("keyterms", () => {
  it("collects IDs, page terms, click texts and field labels, de-duplicated", () => {
    const k = keytermsFromRecording(film, ["Maya Chen", "Sam Okafor", "maya chen", "Approved hours"]);
    expect(k.slice(0, 3)).toEqual(["HSG-1010", "E-101", "E-104"]);
    expect(k).toContain("Maya Chen");
    expect(k).toContain("Halcyon Staffing client portal");
    expect(k.filter((x) => x.toLowerCase() === "maya chen").length).toBe(1);
    expect(k.map((x) => x.toLowerCase())).toContain("approved hours");
  });

  it("enforces the API limits (50 chars, 5 words, no <>{}[]\\, cap)", () => {
    expect(cleanKeyterm("a".repeat(51))).toBeNull();
    expect(cleanKeyterm("one two three four five six")).toBeNull();
    expect(cleanKeyterm("[E-104]")).toBe("E-104");
    expect(cleanKeyterm("40")).toBeNull();
    expect(normalizeKeyterms(Array.from({ length: 300 }, (_, i) => `Term ${i}x`)).length).toBe(100);
  });
});

/* -------------------------------------------------------------- ElevenLabs */

describe("ElevenLabs response parsing", () => {
  it("keeps words only, shifts by the take offset, turns logprob into confidence", () => {
    const words = wordsFromElevenLabs(scribe, 10);
    expect(words.map((x) => x.text)).toEqual(["Maya", "is", "approved", "for", "40", "hours.", "Sam", "is", "approved", "for", "36."]);
    expect(words[0]).toMatchObject({ start: 10.12, end: 10.48 });
    expect(words[6].confidence).toBeCloseTo(Math.exp(-1.2), 2);
    expect(confidenceFromLogprob(0)).toBe(1);
    expect(confidenceFromLogprob(undefined)).toBeUndefined();
  });

  it("builds a real transcript with aligned utterances and low-confidence words", () => {
    const rec: Recording = { session_id: "s", started_at: "2026-01-01T00:00:00.000Z", steps: [], transcript: [] };
    const t = elevenLabsTranscript(
      [{ words: wordsFromElevenLabs(scribe), language: "eng", request_id: "req_1", duration_s: 5.2, text: scribe.text ?? "" }],
      rec,
      ["E-104"],
    );
    expect(SpeechTranscriptSchema.parse(t)).toBeTruthy();
    expect(t).toMatchObject({ provider: "elevenlabs", model: "scribe_v2", mode: "real", language: "eng", request_id: "req_1" });
    expect(t.utterances.map((u) => u.text)).toEqual(["Maya is approved for 40 hours.", "Sam is approved for 36."]);
    expect(t.utterances[1].low_confidence).toEqual(["Sam", "36."]);
  });

  it("sends the documented multipart fields with the xi-api-key header", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify(scribe), { status: 200, headers: { "content-type": "application/json", "x-request-id": "req_abc" } }),
    );
    const r = await transcribeElevenLabs(Buffer.from("fake-audio"), "audio/webm;codecs=opus", {
      apiKey: "test-key",
      keyterms: ["HSG-1010", "E-104"],
      language: "en",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    expect((init!.headers as Record<string, string>)["xi-api-key"]).toBe("test-key");
    const form = init!.body as FormData;
    expect(form.get("model_id")).toBe("scribe_v2");
    expect(form.get("timestamps_granularity")).toBe("word");
    expect(form.get("language_code")).toBe("en");
    expect(form.getAll("keyterms")).toEqual(["HSG-1010", "E-104"]);
    expect(form.get("file")).toBeInstanceOf(Blob);
    expect(r.request_id).toBe("req_abc");
    expect(r.language).toBe("eng");
    expect(r.words.length).toBe(11);
  });

  it("throws a useful error without leaking the key", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ detail: { message: "invalid api key" } }), { status: 401 });
    await expect(transcribeElevenLabs(Buffer.from("x"), "audio/webm", { apiKey: "sk-secret", fetchImpl: fetchImpl as typeof fetch })).rejects.toThrow(
      /\(401\): invalid api key/,
    );
    const err = await transcribeElevenLabs(Buffer.from("x"), "audio/webm", { apiKey: "sk-secret", fetchImpl: fetchImpl as typeof fetch }).catch(
      (e: Error) => e,
    );
    expect(JSON.stringify({ m: (err as Error).message, ...(err as object) })).not.toContain("sk-secret");
  });

  it("requests a Realtime single-use token", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ token: "sutkn_1" }), { status: 200 }));
    expect(await createRealtimeToken({ apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch })).toBe("sutkn_1");
    expect((fetchImpl.mock.calls[0] as unknown[])[0]).toBe("https://api.elevenlabs.io/v1/single-use-token/realtime_scribe");
  });
});

/* ------------------------------------------------------------------- peaks */

describe("peaks", () => {
  it("are deterministic, 0..1 at 20/s, loud during words and quiet between", () => {
    const words = simulatedWords(film);
    const a = simulatedPeaks(words, 26);
    expect(a).toEqual(simulatedPeaks(words, 26));
    expect(a.length).toBeGreaterThanOrEqual(26 * 20);
    expect(Math.max(...a)).toBeLessThanOrEqual(1);
    expect(Math.min(...a)).toBeGreaterThanOrEqual(0);
    const mid = Math.round(((words[0].start + words[0].end) / 2) * 20);
    expect(a[mid]).toBeGreaterThan(0.2);
    expect(a[5]).toBeLessThan(0.05); // 0.25 s, before the first line
  });
});

/* ------------------------------------------------------------------ runStt */

describe("runStt", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "stt-"));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("uses the demo voice for a scripted operator without audio and writes peaks + recording", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    const r = await runStt({ recording: film, operator: "scripted_playwright" }, { dir });
    expect(r.status).toBe(200);
    if (r.status !== 200) return;
    expect(r.body.recording.speech?.provider).toBe("simulated");
    expect(r.body.recording.speech?.mode).toBe("scripted");
    expect(r.body.provider_label).toBeNull();
    expect(r.body.recording.audio).toBeUndefined();
    expect(r.body.recording.steps).toEqual(film.steps); // narration steps unchanged
    expect(readPeaks(film.session_id, dir)?.mode).toBe("scripted");
    expect(RecordingSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, `${film.session_id}.json`), "utf8"))).speech).toBeTruthy();
  });

  it("transcribes audio with ElevenLabs when the key is set (mocked fetch), offsetting each take", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(scribe), { status: 200, headers: { "x-request-id": "req_9" } }));
    const r = await runStt(
      {
        recording: film,
        operator: "human",
        audio: [{ bytes: new Uint8Array([1, 2, 3]), mime: "audio/webm", offset_s: 14, duration_s: 5.2 }],
        peaks: [0.1, 0.5, 2, -1, "x"],
        pageTerms: ["Maya Chen"],
      },
      { dir, fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(r.status).toBe(200);
    if (r.status !== 200) return;
    const speech = r.body.recording.speech!;
    expect(speech).toMatchObject({ provider: "elevenlabs", mode: "real", model: "scribe_v2", request_id: "req_9" });
    expect(speech.keyterms).toContain("Maya Chen");
    expect(speech.utterances[0].start).toBeCloseTo(14.12, 3);
    // "Maya is approved for 40 hours." at 14.1 s links to the 40-hours click at 14.6 s.
    const idx = film.steps.findIndex((s) => s.detail.text === "40");
    expect(speech.utterances[0].step_refs).toContain(idx);
    expect(r.body.provider_label).toBe("ElevenLabs Scribe v2");
    expect(r.body.recording.audio).toMatchObject({ mime: "audio/webm", duration_s: 5.2 });
    expect(fs.readFileSync(path.join(dir, `${film.session_id}.webm`))).toEqual(Buffer.from([1, 2, 3]));
    expect(readPeaks(film.session_id, dir)?.peaks).toEqual([0.1, 0.5, 1, 0, 0]);
  });

  it("returns 503 for a person's audio with no key, and still saves the audio", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    const r = await runStt({ recording: film, operator: "human", audio: [{ bytes: new Uint8Array([9]), mime: "audio/webm", offset_s: 0 }] }, { dir });
    expect(r.status).toBe(503);
    expect(fs.existsSync(path.join(dir, `${film.session_id}.webm`))).toBe(true);
  });

  it("returns 502 when ElevenLabs fails", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
    const fetchImpl = async () => new Response("{}", { status: 500 });
    const r = await runStt(
      { recording: film, operator: "human", audio: [{ bytes: new Uint8Array([9]), mime: "audio/webm", offset_s: 0 }] },
      { dir, fetchImpl: fetchImpl as typeof fetch },
    );
    expect(r.status).toBe(502);
  });

  it("rejects a bad recording or session id", async () => {
    expect((await runStt({ recording: { nope: 1 } }, { dir })).status).toBe(400);
    expect((await runStt({ recording: { ...film, session_id: "../etc" } }, { dir })).status).toBe(400);
  });
});

/* ------------------------------------------------------------------- route */

describe("POST /api/stt", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "stt-root-"));
    vi.resetModules();
    vi.stubEnv("RAMP_TEACH_ROOT", root);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("JSON body: demo voice, saved under runtime/recordings", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    const { POST } = await import("@/app/api/stt/route");
    const res = await POST(
      new Request("http://localhost:3000/api/stt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recording: film, operator: "scripted_playwright", provider: "simulated" }),
      }),
    );
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.recording.speech.provider).toBe("simulated");
    expect(fs.existsSync(path.join(root, "runtime", "recordings", `${film.session_id}.peaks.json`))).toBe(true);
  });

  it("multipart with audio: ElevenLabs via global fetch (mocked)", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(scribe), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await import("@/app/api/stt/route");
    const form = new FormData();
    form.append("recording", JSON.stringify(film));
    form.append("operator", "human");
    form.append("audio", new Blob([new Uint8Array([1, 2])], { type: "audio/webm" }), "take1.webm");
    form.append("takes", JSON.stringify([{ offset_s: 14, duration_s: 5.2 }]));
    form.append("page_terms", JSON.stringify(["Maya Chen"]));
    const res = await POST(new Request("http://localhost:3000/api/stt", { method: "POST", body: form }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.recording.speech.provider).toBe("elevenlabs");
    expect(j.recording.audio.path).toBe(`runtime/recordings/${film.session_id}.webm`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses non-local origins", async () => {
    const { POST } = await import("@/app/api/stt/route");
    const res = await POST(new Request("http://example.com/api/stt", { method: "POST", body: "{}" }));
    expect(res.status).toBe(403);
  });

  it("GET /api/stt/token is 503 without a key", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    const { GET } = await import("@/app/api/stt/token/route");
    const res = await GET(new Request("http://localhost:3000/api/stt/token"));
    expect(res.status).toBe(503);
  });
});
