/**
 * Span recorder (E1): one timed step per routing call, model turn, tool call, calc, synthesis and
 * evidence check, written as JSONL to runs/<invoice_id>/spans.jsonl (contracts/pillars.ts SpanSchema).
 *
 * - `reset()` truncates the file at run start (one file = one run, trace_id = run id).
 * - Spans are appended when they END, so a parent (e.g. the run span) is written after its children;
 *   readers rebuild the tree from parent_id.
 * - The default file goes through lib/pillars (appendSpan / spansPath); tests pass their own file.
 * - Never writes prompts, page text, image bytes or credentials: callers pass redacted attrs.
 */
import fs from "node:fs";
import path from "node:path";
import { SpanSchema, type PillarMode, type Span } from "@/contracts";
import { appendSpan, spansPath } from "@/lib/pillars";

type SpanKind = Span["kind"];

/**
 * USD per 1M tokens. Same table as scripts/usage.ts (Claude Opus 5.5 first-party list prices;
 * cache writes at the 5-minute rate, 1.25x input). Other models get cost_usd null.
 */
export const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-opus-5-5": { input: 4.0, output: 20.0, cacheRead: 0.2, cacheWrite: 5.0 },
};

export interface UsageLike {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** Rough USD cost of one call with the repo's price table, or null when the model is not priced. */
export function costUsd(model: string | null | undefined, usage: UsageLike | null | undefined): number | null {
  if (!model || !usage) return null;
  const p = PRICES[model];
  if (!p) return null;
  const n = (x: number | null | undefined) => (typeof x === "number" ? x : 0);
  const usd =
    (n(usage.input_tokens) * p.input +
      n(usage.output_tokens) * p.output +
      n(usage.cache_read_input_tokens) * p.cacheRead +
      n(usage.cache_creation_input_tokens) * p.cacheWrite) /
    1e6;
  return Math.round(usd * 1e6) / 1e6;
}

/** Token + cost attrs for a model span (what the UI shows per turn). */
export function modelAttrs(model: string | null, usage: UsageLike | null | undefined, ids: { request_id?: string | null; message_id?: string | null } = {}) {
  const n = (x: number | null | undefined) => (typeof x === "number" ? x : 0);
  return {
    model,
    request_id: ids.request_id ?? null,
    message_id: ids.message_id ?? null,
    input_tokens: n(usage?.input_tokens),
    output_tokens: n(usage?.output_tokens),
    cache_read_input_tokens: n(usage?.cache_read_input_tokens),
    cache_creation_input_tokens: n(usage?.cache_creation_input_tokens),
    cost_usd: costUsd(model, usage),
  };
}

export interface OpenSpan {
  readonly id: string;
  /** Finish the span and append it. `mode` overrides the mode given at start (e.g. a real call that fell back). */
  end(attrs?: Record<string, unknown>, mode?: PillarMode): Span;
}

export interface SpanRecorderOptions {
  invoiceId: string;
  /** Run id; becomes every span's trace_id. */
  traceId: string;
  /** Override the JSONL file (tests). Default: lib/pillars spansPath(invoiceId) via appendSpan. */
  file?: string;
}

export class SpanRecorder {
  readonly invoiceId: string;
  readonly traceId: string;
  readonly file: string;
  private readonly custom: boolean;
  private seq = 0;

  constructor(opts: SpanRecorderOptions) {
    this.invoiceId = opts.invoiceId;
    this.traceId = opts.traceId;
    this.custom = Boolean(opts.file);
    this.file = opts.file ?? spansPath(opts.invoiceId);
  }

  /** Truncate the run's spans file (call once at run start). */
  reset(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, "");
  }

  newId(): string {
    return `sp_${String(++this.seq).padStart(3, "0")}`;
  }

  /** Append a finished span (start/end already known). Returns the validated span. */
  record(s: {
    id?: string;
    name: string;
    kind: SpanKind;
    mode: PillarMode;
    parentId: string | null;
    start: string;
    end: string;
    attrs?: Record<string, unknown>;
  }): Span {
    const span = SpanSchema.parse({
      span_id: s.id ?? this.newId(),
      parent_id: s.parentId,
      trace_id: this.traceId,
      name: s.name,
      kind: s.kind,
      mode: s.mode,
      start: s.start,
      end: s.end,
      attrs: { ...(s.attrs ?? {}), duration_ms: Math.max(0, Date.parse(s.end) - Date.parse(s.start)) },
    });
    try {
      if (this.custom) {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        fs.appendFileSync(this.file, JSON.stringify(span) + "\n");
      } else {
        appendSpan(this.invoiceId, span);
      }
    } catch {
      /* observability must never break a run */
    }
    return span;
  }

  /** Start a span now; `end()` writes it. */
  start(name: string, kind: SpanKind, mode: PillarMode, parentId: string | null, attrs: Record<string, unknown> = {}): OpenSpan {
    const id = this.newId();
    const start = new Date().toISOString();
    let done: Span | null = null;
    return {
      id,
      end: (more = {}, endMode) => {
        if (done) return done;
        done = this.record({ id, name, kind, mode: endMode ?? mode, parentId, start, end: new Date().toISOString(), attrs: { ...attrs, ...more } });
        return done;
      },
    };
  }
}

/** Read a spans JSONL file (tests / tools). */
export function readSpansFile(file: string): Span[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => SpanSchema.parse(JSON.parse(l)));
}
