/**
 * /learn: RECORD → LEARN made readable. Shows the Recording that LEARN consumed (rules/learn_meta.json
 * recording_path) as a timeline, its provenance, and the learned workflow spec. Read-only: this page
 * never calls Claude; it renders saved files (rules/*, the recording JSON, learn/trace.jsonl).
 */
import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { Badge, ModeBadge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import {
  EvalsFileSchema,
  LearnMetaSchema,
  RecordingSchema,
  WorkflowSpecSchema,
  type LearnMeta,
  type Recording,
  type WorkflowSpec,
} from "@/contracts";
import { ROOT } from "@/lib/paths";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Record and learn · Ramp Teach" };

/** Only these recordings may be rendered (no arbitrary file reads). */
const ALLOWED_RECORDING = /^(extension\/recordings\/[A-Za-z0-9_.-]+\.json|data\/recording\.sample\.json)$/;

function readJson(rel: string): unknown | null {
  const f = path.join(ROOT, rel);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
}

interface LearnCallInfo {
  ts: string;
  cacheHit: boolean;
}

/** The learn trace's real distillation events for this recording session (newest first). */
function realLearnCalls(sessionId: string): LearnCallInfo[] {
  const f = path.join(ROOT, "learn", "trace.jsonl");
  if (!fs.existsSync(f)) return [];
  const lines = fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const out: LearnCallInfo[] = [];
  let currentSession: string | null = null;
  for (const e of lines) {
    if (e.step === "load_recording") currentSession = e.detail?.session_id ?? null;
    if (e.step === "distill.real" && currentSession === sessionId) out.push({ ts: e.ts, cacheHit: !!e.detail?.cache_hit });
  }
  return out.reverse();
}

function fmtUtc(iso: string): string {
  const d = new Date(iso);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
}

function describeStep(s: Recording["steps"][number]): { label: string; text: string } {
  const d = s.detail;
  const url = d.url ? new URL(d.url).pathname + new URL(d.url).search : "";
  if (s.kind === "narration") return { label: "Narration", text: `“${d.text ?? ""}”` };
  switch (d.event) {
    case "navigate":
      return { label: "Page", text: `Opened ${url}` };
    case "click":
      return { label: "Click", text: d.text ? `Clicked “${d.text}”` : `Clicked ${d.selector ?? "element"}` };
    case "input": {
      const field = /name="([^"]+)"/.exec(d.selector ?? "")?.[1] ?? "field";
      return { label: "Input", text: `Typed ${field}: ${d.value ?? ""}` };
    }
    case "submit":
      return { label: "Submit", text: "Submitted the sign-in form" };
    default:
      return { label: d.event ?? "Event", text: d.text ?? url };
  }
}

export default function LearnPage() {
  const meta: LearnMeta | null = (() => {
    const raw = readJson("rules/learn_meta.json");
    return raw ? LearnMetaSchema.parse(raw) : null;
  })();
  const spec: WorkflowSpec | null = (() => {
    const raw = readJson("rules/workflow_spec.json");
    return raw ? WorkflowSpecSchema.parse(raw) : null;
  })();
  const evalCount = (() => {
    const raw = readJson("rules/evals.json");
    return raw ? EvalsFileSchema.parse(raw).length : 0;
  })();
  const recording: Recording | null =
    meta && ALLOWED_RECORDING.test(meta.recording_path)
      ? (() => {
          const raw = readJson(meta.recording_path);
          return raw ? RecordingSchema.parse(raw) : null;
        })()
      : null;

  if (!meta || !spec || !recording) {
    return (
      <Card title="Nothing learned yet">
        <p className="text-sm text-ink-muted">Run <code>npm run learn</code> to distill a recording into rules/.</p>
      </Card>
    );
  }

  const prov = meta.provenance;
  const calls = realLearnCalls(recording.session_id);
  const firstFresh = [...calls].reverse().find((c) => !c.cacheHit) ?? null;
  const t0 = new Date(recording.started_at).getTime();
  const operatorText =
    prov?.operator === "human"
      ? "A human reviewer"
      : prov?.operator === "scripted_playwright"
        ? "A scripted Playwright operator, not a human"
        : prov?.operator === "synthetic"
          ? "Hand-written sample data"
          : "Unknown";

  return (
    <div className="space-y-8">
      <div>
        <div className="text-xs uppercase tracking-wider text-ink-faint">Stages 1 and 2</div>
        <h1 className="font-display text-4xl tracking-tight">Record, then learn</h1>
        <p className="mt-2 max-w-3xl text-ink-muted">
          A reviewer verifies one past invoice in the vendor portal while narrating. Our Chrome extension captures the
          session. One Claude call distills it into a workflow spec: the rules, where the proof lives, and open questions.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3" id="provenance">
        <Card eyebrow="Performed by">
          <div className="text-base font-semibold">{operatorText}</div>
          <p className="mt-1 text-sm text-ink-muted">
            Session {recording.session_id}. A genuinely human-recorded session is still outstanding.
          </p>
        </Card>
        <Card eyebrow="Captured by">
          <div className="text-base font-semibold">
            {prov?.capture === "mv3_extension" ? "Ramp Teach Recorder (Chrome MV3 extension)" : "Hand-authored fixture"}
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            {recording.steps.length} steps on the fixture vendor portal (localhost, synthetic data). Passwords are
            never recorded.
          </p>
        </Card>
        <Card eyebrow="Learned by">
          <div className="flex items-center gap-2">
            <ModeBadge mode={meta.mode === "real" ? "real" : "deterministic"} />
            <span className="text-sm text-ink-muted">{meta.model ?? "no model"}</span>
          </div>
          <p className="mt-2 text-sm text-ink-muted">
            {meta.mode === "real"
              ? `One Claude call${firstFresh ? ` on ${fmtUtc(firstFresh.ts)}` : ""}. This page shows that saved output; it does not call Claude.`
              : "Deterministic distiller (no AI)."}
          </p>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Card eyebrow="Recorded session" title="What the extension captured" id="recording">
          <ol className="space-y-1.5 text-sm">
            {recording.steps.map((s, i) => {
              const { label, text } = describeStep(s);
              const secs = Math.max(0, Math.round((new Date(s.ts).getTime() - t0) / 1000));
              return (
                <li key={i} className={`flex gap-3 ${s.kind === "narration" ? "rounded-md bg-wash px-2 py-1.5" : "px-2"}`}>
                  <span className="w-10 shrink-0 tabular text-right text-ink-faint">{secs}s</span>
                  <span className={`w-20 shrink-0 text-xs uppercase tracking-wide ${s.kind === "narration" ? "pt-0.5 text-ink" : "pt-0.5 text-ink-faint"}`}>
                    {label}
                  </span>
                  <span className={s.kind === "narration" ? "italic" : "text-ink-muted"}>{text}</span>
                </li>
              );
            })}
          </ol>
        </Card>

        <div className="space-y-6">
          <Card eyebrow="Learned workflow spec" title="Rules the agent will apply" id="rules">
            <ol className="list-decimal space-y-2 pl-5 text-sm">
              {spec.rules.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ol>
            <p className="mt-4 text-xs text-ink-faint">
              Vendor in spec: “{spec.vendor}”. The checks themselves run as hand-written code; the spec guides where the
              agent looks and what the receipt explains.
            </p>
          </Card>
          <Card eyebrow="Learned workflow spec" title="Where the proof lives" id="proof">
            <ul className="space-y-2 text-sm">
              {spec.proof_sources.map((p, i) => (
                <li key={i}>
                  <div className="font-medium">{p.app}</div>
                  <div className="font-mono text-xs text-ink-muted">{p.location}</div>
                  <div className="text-xs text-ink-faint">{p.fields.join(", ")}</div>
                </li>
              ))}
            </ul>
          </Card>
          <Card eyebrow="Learned workflow spec" title="Open questions" id="questions">
            <ul className="space-y-1 text-sm">
              {spec.open_questions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
            <div className="mt-4 flex items-center gap-2 text-sm">
              <Badge>Evals</Badge>
              <span className="text-ink-muted">{evalCount} permanent eval cases from the vendor’s past corrections</span>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
