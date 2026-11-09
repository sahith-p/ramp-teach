/** Types for extension/lib/recording.js (plain JS so the extension loads unpacked with no build). */

export interface ElementDesc {
  tag: string;
  attrs?: Record<string, string>;
  text?: string;
  nth?: number;
  parent?: ElementDesc | null;
}

export interface RawCapture {
  event: "click" | "input" | "change" | "submit" | "navigate";
  url: string;
  title?: string;
  target?: ElementDesc | null;
  value?: string;
}

export interface StepDetail {
  event?: string;
  url?: string;
  title?: string;
  selector?: string;
  text?: string;
  value?: string;
}

export interface Step {
  ts: string;
  kind: "dom" | "narration";
  detail: StepDetail;
}

export interface Session {
  session_id: string;
  started_at: string;
  steps: Step[];
  last_page?: { url: string; title: string } | null;
}

export interface RecordingExport {
  session_id: string;
  started_at: string;
  steps: Step[];
  transcript: string[];
}

export const REDACTED: "[redacted]";
export const MAX_TEXT: number;
export const MAX_VALUE: number;

export function isAllowedUrl(url: string | undefined | null): boolean;
export function cleanText(s: string | undefined | null, max?: number): string;
export function isSensitiveField(desc: ElementDesc | null | undefined): boolean;
export function redact(value: string | undefined | null, desc: ElementDesc | null | undefined): string;
export function pickTarget(desc: ElementDesc): ElementDesc;
export function cssPath(desc: ElementDesc): string;
export function selectorFor(desc: ElementDesc | null | undefined): string | undefined;
export function textFor(desc: ElementDesc | null | undefined): string | undefined;
export function buildStep(raw: RawCapture, now?: Date): Step;
export function buildNarrationStep(
  text: string,
  page: { url?: string; title?: string } | null | undefined,
  now?: Date,
): Step;
export function appendStep(steps: Step[], step: Step): Step[];
export function newSessionId(now?: Date, rand?: () => number): string;
export function newSession(now?: Date): Session;
export function toRecording(session: Session): RecordingExport;
export function exportFilename(sessionId: string): string;
