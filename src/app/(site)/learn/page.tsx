/**
 * /learn: the Recording that LEARN consumed (rules/learn_meta.json recording_path) as a timeline,
 * next to the learned workflow spec. Read-only: renders saved files, never calls Claude.
 */
import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { OfflineNote } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import {
  LearnMetaSchema,
  RecordingSchema,
  WorkflowSpecSchema,
  type LearnMeta,
  type Recording,
  type WorkflowSpec,
} from "@/contracts";
import { ROOT } from "@/lib/paths";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Learn · Ramp Teach" };

/** Only these recordings may be rendered (no arbitrary file reads). */
const ALLOWED_RECORDING = /^(extension\/recordings\/[A-Za-z0-9_.-]+\.json|data\/recording\.sample\.json)$/;

function readJson(rel: string): unknown | null {
  const f = path.join(ROOT, rel);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
}

/** Who performed the recording, stated plainly. Never claims a person when it was a script. */
function performedBy(operator: string | undefined): string | null {
  switch (operator) {
    case "human":
      return "Recorded by a person.";
    case "scripted_playwright":
      return "Recorded by a scripted test run.";
    case "synthetic":
      return "Sample recording, written by hand.";
    default:
      return null;
  }
}

function describeStep(s: Recording["steps"][number]): string | null {
  const d = s.detail;
  if (s.kind === "narration") return `“${d.text ?? ""}”`;
  switch (d.event) {
    case "navigate": {
      if (!d.url) return "Opened a page";
      const u = new URL(d.url);
      return `Opened ${u.pathname}${u.search}`;
    }
    case "click":
      return d.text ? `Clicked “${d.text}”` : "Clicked";
    case "input": {
      const field = /name="([^"]+)"/.exec(d.selector ?? "")?.[1] ?? "field";
      return `Typed ${field}: ${d.value ?? ""}`;
    }
    case "submit":
      return null; // same moment as the "Sign in" click
    default:
      return d.text ?? null;
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
  const recording: Recording | null =
    meta && ALLOWED_RECORDING.test(meta.recording_path)
      ? (() => {
          const raw = readJson(meta.recording_path);
          return raw ? RecordingSchema.parse(raw) : null;
        })()
      : null;

  if (!meta || !spec || !recording) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold tracking-tight">Learn</h1>
        <p className="text-ink-muted">
          Nothing learned yet. Run <code className="font-mono text-sm">npm run learn</code>.
        </p>
      </div>
    );
  }

  const t0 = new Date(recording.started_at).getTime();
  const who = performedBy(meta.provenance?.operator);
  const steps = recording.steps
    .map((s) => ({ s, text: describeStep(s) }))
    .filter((x): x is { s: Recording["steps"][number]; text: string } => x.text !== null);

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-semibold tracking-tight">Learn</h1>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card id="recording">
          <h2 className="text-base font-semibold">Recording</h2>
          {who && <p className="mt-1 text-xs text-ink-faint">{who}</p>}
          <ol className="mt-4 space-y-1.5 text-sm">
            {steps.map(({ s, text }, i) => {
              const secs = Math.max(0, Math.round((new Date(s.ts).getTime() - t0) / 1000));
              const said = s.kind === "narration";
              return (
                <li key={i} className={`flex gap-3 rounded-md px-2 py-1 ${said ? "bg-wash" : ""}`}>
                  <span className="w-9 shrink-0 text-right tabular text-ink-faint">{secs}s</span>
                  <span className={said ? "text-ink" : "text-ink-muted"}>{text}</span>
                </li>
              );
            })}
          </ol>
        </Card>

        <div className="space-y-6">
          <Card id="rules">
            <h2 className="text-base font-semibold">Rules</h2>
            <OfflineNote mode={meta.mode} className="mt-1" />
            <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm">
              {spec.rules.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ol>
          </Card>

          <Card title="Where it looks" id="proof">
            <ul className="space-y-3 text-sm">
              {spec.proof_sources.map((p, i) => (
                <li key={i}>
                  <div className="font-mono text-xs">{p.location}</div>
                  <div className="mt-0.5 text-xs text-ink-muted">{p.fields.join(", ")}</div>
                </li>
              ))}
            </ul>
          </Card>

          {spec.open_questions.length > 0 && (
            <Card title="Open questions" id="questions">
              <ul className="space-y-1 text-sm">
                {spec.open_questions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
