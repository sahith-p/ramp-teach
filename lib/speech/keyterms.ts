/**
 * Key terms for the speech model: names, IDs (HSG-1011, E-104) and field labels visible on the recorded
 * pages, so the transcript spells them the way the pages do.
 *
 * Limits from the ElevenLabs Speech to Text reference (`keyterms` form field,
 * https://elevenlabs.io/docs/api-reference/speech-to-text/convert, checked against the official SDK
 * @elevenlabs/elevenlabs-js 2.77.0, BodySpeechToTextV1SpeechToTextPost.keyterms):
 *   at most 1000 terms; each at most 50 characters and at most 5 words; the characters < > { } [ ] \ are
 *   not supported; more than 100 terms sets a 20 second minimum billable duration. We cap at 100.
 */
import type { Recording } from "@/contracts";

export const KEYTERM_MAX_COUNT = 100; // the API allows 1000; above 100 a 20 s minimum bill applies
export const KEYTERM_MAX_CHARS = 50;
export const KEYTERM_MAX_WORDS = 5;

const ID_RE = /\b[A-Z]{1,5}-\d{2,6}\b/g;
const GENERIC = new Set(["view", "open", "back", "next", "close", "cancel", "ok", "submit", "continue", "menu", "home"]);

/** Clean one candidate; null when it cannot be a keyterm. */
export function cleanKeyterm(raw: string): string | null {
  const t = String(raw ?? "")
    .replace(/[<>{}[\]\\]/g, " ")
    .replace(/[“”"]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}.)]+$/gu, "");
  if (t.length < 2 || t.length > KEYTERM_MAX_CHARS) return null;
  if (t.split(" ").length > KEYTERM_MAX_WORDS) return null;
  if (/^[\d.,:$%/ -]+$/.test(t)) return null; // amounts, dates, bare numbers: the model gets these right
  if (GENERIC.has(t.toLowerCase())) return null;
  return t;
}

/** De-duplicate (case-insensitive, first spelling wins), drop invalid terms, cap the count. */
export function normalizeKeyterms(candidates: Iterable<string>, max = KEYTERM_MAX_COUNT): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of candidates) {
    const t = cleanKeyterm(c);
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

const humanize = (field: string) => field.replace(/[_-]+/g, " ").trim();

/**
 * Key terms from a recording: IDs first, then terms collected from the pages (`pageTerms`, from the
 * content script), then clicked texts, page title parts and data-field labels.
 */
export function keytermsFromRecording(recording: Pick<Recording, "steps">, pageTerms: string[] = []): string[] {
  const ids: string[] = [];
  const texts: string[] = [];
  const labels: string[] = [];
  for (const s of recording.steps) {
    const d = s.detail;
    const blob = [d.url, d.selector, d.text, d.title].filter(Boolean).join(" ");
    for (const m of blob.matchAll(ID_RE)) ids.push(m[0]);
    if (s.kind !== "dom") continue;
    if (d.event === "click" && d.text) texts.push(d.text);
    if (d.title) for (const part of d.title.split(/\s+[·|—–-]\s+/)) labels.push(part);
    for (const m of (d.selector ?? "").matchAll(/data-field="([^"]+)"/g)) labels.push(humanize(m[1]));
  }
  return normalizeKeyterms([...ids, ...pageTerms, ...texts, ...labels]);
}
