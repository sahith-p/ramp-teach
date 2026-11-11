/** Time helpers shared by the speech modules. All speech times are seconds from `Recording.started_at`. */
import type { Recording, RecordingStep } from "@/contracts";

/** Seconds from the recording's start to this step (never negative). */
export function stepTime(recording: Pick<Recording, "started_at">, step: Pick<RecordingStep, "ts">): number {
  const t = (Date.parse(step.ts) - Date.parse(recording.started_at)) / 1000;
  return Number.isFinite(t) ? Math.max(0, t) : 0;
}

/** Duration of the recording in seconds: last step time (at least `minEnd`). */
export function recordingDuration(recording: Pick<Recording, "started_at" | "steps">, minEnd = 0): number {
  let end = minEnd;
  for (const s of recording.steps) end = Math.max(end, stepTime(recording, s));
  return end;
}

export const round3 = (n: number) => Math.round(n * 1000) / 1000;
