import type { Metadata } from "next";
import Link from "next/link";
import { resolveEvidence, type EvidenceView } from "@/components/receipt/evidence";
import { ResultBadge } from "@/components/receipt/badges";
import { checkLabel, evidenceHref, isSafeId, SAMPLE_ID } from "@/components/receipt/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Evidence · Ramp Teach" };

type Props = {
  params: Promise<{ invoiceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function EvidencePage({ params, searchParams }: Props) {
  const { invoiceId } = await params;
  const sp = await searchParams;
  const pointer = typeof sp.p === "string" ? sp.p : "";
  const view = resolveEvidence(invoiceId, pointer);
  const safe = isSafeId(invoiceId);
  const backHref = safe ? `/receipts/${encodeURIComponent(invoiceId)}` : "/receipts";
  const backLabel = !safe ? "Receipts" : invoiceId === SAMPLE_ID ? "Sample receipt" : invoiceId;

  return (
    <div className="space-y-6">
      <header>
        <Link href={backHref} className="text-sm text-ink-muted hover:text-ink">
          ← {backLabel}
        </Link>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Evidence</h1>
        <p className="mt-1 break-all font-mono text-sm text-ink-muted" data-testid="evidence-pointer">
          {pointer || "(no pointer)"}
        </p>
      </header>

      <EvidenceBody view={view} invoiceId={invoiceId} />
    </div>
  );
}

function Json({ value, className = "" }: { value: unknown; className?: string }) {
  return (
    <pre className={`overflow-auto rounded-[var(--radius-card)] border border-line bg-wash p-5 font-mono text-sm leading-relaxed text-ink ${className}`}>
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function EvidenceBody({ view, invoiceId }: { view: EvidenceView; invoiceId: string }) {
  if (view.kind === "error") {
    return (
      <p className="text-sm text-fail" data-testid="evidence-error">
        {view.message}
      </p>
    );
  }

  if (view.kind === "fixture") {
    return (
      <Link href={view.href} className="inline-block break-all font-mono text-sm underline underline-offset-4">
        {view.href}
      </Link>
    );
  }

  if (view.kind === "file") {
    if (view.missing) return <p className="text-sm text-ink-muted">{view.file} not found.</p>;
    if (view.fragment && view.fragmentFound) {
      return (
        <div data-testid="evidence-fragment">
          <Json value={view.fragmentValue} />
        </div>
      );
    }
    return (
      <div className="space-y-2">
        {view.fragment && <p className="text-sm text-warn">#{view.fragment} not found. Showing the whole file.</p>}
        <Json value={view.content} className="max-h-[40rem]" />
      </div>
    );
  }

  // calc
  if (view.missing || !view.output) {
    return <p className="text-sm text-ink-muted">{view.missing ? `${view.file} not found.` : `No output for this check in ${view.file}.`}</p>;
  }
  const out = view.output;
  const th = "px-4 py-2.5 text-left font-medium text-ink-muted";
  return (
    <div className="space-y-4" data-testid="evidence-calc">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-base font-semibold">{checkLabel(view.check)}</h2>
        <ResultBadge result={out.result} />
      </div>
      <p className="text-sm">{out.summary}</p>
      {out.findings.length > 0 && (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-wash">
                <th className={`${th} text-right`}>Line</th>
                <th className={th}>Expected</th>
                <th className={th}>Actual</th>
                <th className={th}>Finding</th>
                <th className={th}>Source</th>
              </tr>
            </thead>
            <tbody>
              {out.findings.map((f, i) => {
                const hl = view.highlightLine !== null && f.line_index === view.highlightLine;
                const href = evidenceHref(invoiceId, f.evidence);
                return (
                  <tr key={i} className={`border-b border-line align-top last:border-0 ${hl ? "bg-wash font-medium" : ""}`} data-highlight={hl || undefined}>
                    <td className="px-4 py-3 text-right tabular">{f.line_index === null ? "All" : f.line_index + 1}</td>
                    <td className="px-4 py-3 tabular">{f.expected}</td>
                    <td className="px-4 py-3 tabular">{f.actual}</td>
                    <td className="px-4 py-3">{f.message}</td>
                    <td className="px-4 py-3">
                      {href ? (
                        <Link href={href} className="break-all font-mono text-xs underline underline-offset-4">
                          {f.evidence}
                        </Link>
                      ) : (
                        <span className="break-all font-mono text-xs text-ink-faint">{f.evidence}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
