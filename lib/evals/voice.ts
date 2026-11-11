/**
 * C7 voice accuracy (code, deterministic) against the case's reference_transcript.
 *   wer              = (substitutions + deletions + insertions) / reference words, on normalized words
 *   keyterm_accuracy = of the keyterm occurrences in the reference (keyterms from recording.speech), the share that
 *                      also occur in the hypothesis (counts capped at the reference count)
 * Hypothesis = the recording's speech words (else its transcript lines). Both null without a reference.
 * This grades the speech-to-text input the learner received, not the learner.
 */
import type { Recording } from "@/contracts";
import { countPhrase, tokenize, wordEditOps } from "./text";

export interface VoiceGrade {
  wer: number | null;
  keyterm_accuracy: number | null;
  notes: string[];
}

export function hypothesisText(rec: Recording): string {
  if (rec.speech?.utterances.length) return rec.speech.utterances.map((u) => u.words.map((w) => w.text).join(" ")).join(" ");
  return rec.transcript.join(" ");
}

export function gradeVoice(rec: Recording, reference: string | null): VoiceGrade {
  if (!reference) return { wer: null, keyterm_accuracy: null, notes: ["No reference transcript."] };
  const notes: string[] = [];
  const ref = tokenize(reference);
  const hyp = tokenize(hypothesisText(rec));
  const ops = wordEditOps(ref, hyp);
  const wer = ref.length ? ops.distance / ref.length : 0;
  notes.push(
    `WER ${(wer * 100).toFixed(1)}% over ${ref.length} reference words (${ops.sub} substituted, ${ops.del} dropped, ${ops.ins} inserted). Speech: ${rec.speech ? `${rec.speech.provider}, mode ${rec.speech.mode}` : "none (transcript lines)"}.`,
  );

  // Keyterms compare without possessives ("Maya Chen's" contains "Maya Chen").
  const bare = (ts: string[]) => ts.map((w) => w.replace(/'s$/, ""));
  const refK = bare(ref);
  const hypK = bare(hyp);
  const keyterms = rec.speech?.keyterms ?? [];
  let refCount = 0;
  let hit = 0;
  for (const k of keyterms) {
    const kt = bare(tokenize(k));
    const r = countPhrase(refK, kt);
    if (r === 0) continue;
    const h = Math.min(r, countPhrase(hypK, kt));
    refCount += r;
    hit += h;
    if (h < r) notes.push(`KEYTERM "${k}": heard ${h} of ${r} times`);
  }
  const keyterm_accuracy = refCount ? hit / refCount : null;
  if (keyterm_accuracy == null) notes.push("No keyterms occur in the reference.");
  return { wer, keyterm_accuracy, notes };
}
