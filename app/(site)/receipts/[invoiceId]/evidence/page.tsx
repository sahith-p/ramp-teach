import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { resolveEvidence, type EvidenceView } from "@/components/receipt/evidence";
import { ResultBadge, SampleLabel } from "@/components/receipt/badges";
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
  const backHref = isSafeId(invoiceId) ? `/receipts/${encodeURIComponent(invoiceId)}` : "/receipts";

  return (
    <div className="space-y-6">
      <header>
        <div className="mb-2 flex items-center gap-3 text-xs uppercase tracking-wider text-ink-faint">
          <Link href="/receipts" className="hover:text-ink">
            Receipts
          </Link>
          <span>/</span>
          <Link href={backHref} className="hover:text-ink">
            {invoiceId === SAMPLE_ID ? "sample" : invoiceId}
          </Link>
          <span>/</span>
          <span>Evidence</span>
          {invoiceId === SAMPLE_ID && <SampleLabel />}
        </div>
        <h1 className="font-display text-4xl tracking-tight">Evidence</h1>
        <p className="mt-2 break-all font-mono text-sm text-ink-muted" data-testid="evidence-pointer">
          {pointer || "(no pointer)"}
        </p>
        <p className="mt-1 text-xs text-ink-faint">Read-only view. Sources are limited to data/, rules/, and this invoice&apos;s runs/ folder.</p>
      </header>

      <EvidenceBody view={view} invoiceId={invoiceId} />

      <Link href={backHref} className="inline-block text-sm font-medium underline underline-offset-4">
        ← Back to receipt
      </Link>
    </div>
  );
}

/** Card's `title` prop is string-typed (it merges HTML attrs); rich titles go through this instead. */
function CardTitle({ children, mono = false }: { children: React.ReactNode; mono?: boolean }) {
  return <h2 className={`mb-4 text-lg font-semibold tracking-tight ${mono ? "break-all font-mono text-base" : ""}`}>{children}</h2>;
}

function Json({ value, className = "" }: { value: unknown; className?: string }) {
  return (
    <pre className={`overflow-auto rounded-lg border border-line bg-wash p-4 font-mono text-xs leading-relaxed text-ink ${className}`}>
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function EvidenceBody({ view, invoiceId }: { view: EvidenceView; invoiceId: string }) {
  if (view.kind === "error") {
    return (
      <Card eyebrow="Not shown" data-testid="evidence-error">
        <p className="text-sm text-fail">{view.message}</p>
      </Card>
    );
  }

  if (view.kind === "fixture") {
    return (
      <Card eyebrow="Fixture page" title="Read on the local vendor portal">
        <p className="text-sm text-ink-muted">This value was read off a page of the fixture app (synthetic data). Open it to see the source.</p>
        <Link href={view.href} className="mt-4 inline-block break-all font-mono text-sm underline underline-offset-4">
          {view.href}
        </Link>
      </Card>
    );
  }

  if (view.kind === "file") {
    if (view.missing) {
      return (
        <Card eyebrow="File" title={view.file}>
          <p className="text-sm text-ink-muted">This file is not present yet. It is produced by another stage of the build.</p>
        </Card>
      );
    }
    return (
      <>
        {view.fragment && (
          <Card eyebrow="Fragment" data-testid="evidence-fragment">
            <CardTitle mono>#{view.fragment}</CardTitle>
            {view.fragmentFound ? (
              <Json value={view.fragmentValue} className="border-ink/20" />
            ) : (
              <p className="text-sm text-warn">Fragment not found in the file; showing the whole file below.</p>
            )}
          </Card>
        )}
        <Card eyebrow="File">
          <CardTitle mono>{view.file}</CardTitle>
          <Json value={view.content} className="max-h-[32rem]" />
        </Card>
      </>
    );
  }

  // calc
  if (view.missing || !view.output) {
    return (
      <Card eyebrow="Deterministic check" title={checkLabel(view.check)}>
        <p className="text-sm text-ink-muted">
          {view.missing ? (
            <>
              <code className="font-mono text-xs">{view.file}</code> does not exist yet. It is written when the agent runs the calc stage for
              this invoice.
            </>
          ) : (
            <>No output for this check in {view.file}.</>
          )}
        </p>
      </Card>
    );
  }
  const out = view.output;
  return (
    <Card eyebrow="Deterministic check (no AI)" data-testid="evidence-calc">
      <CardTitle>
        <span className="flex flex-wrap items-center gap-3">
          {checkLabel(view.check)} <ResultBadge result={out.result} />
        </span>
      </CardTitle>
      <p className="text-sm text-ink">{out.summary}</p>
      <p className="mt-1 font-mono text-xs text-ink-faint">
        {view.file}
        {view.computedAt ? ` · computed ${view.computedAt}` : ""}
      </p>
      {out.findings.length > 0 && (
        <div className="-mx-6 mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-line bg-wash text-left text-xs uppercase tracking-wider text-ink-faint">
                <th className="px-6 py-2.5 text-right font-medium">Line</th>
                <th className="px-3 py-2.5 font-medium">Expected</th>
                <th className="px-3 py-2.5 font-medium">Actual</th>
                <th className="px-3 py-2.5 font-medium">Finding</th>
                <th className="px-6 py-2.5 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {out.findings.map((f, i) => {
                const hl = view.highlightLine !== null && f.line_index === view.highlightLine;
                const href = evidenceHref(invoiceId, f.evidence);
                return (
                  <tr key={i} className={`border-b border-line align-top last:border-0 ${hl ? "bg-wash" : ""}`} data-highlight={hl || undefined}>
                    <td className={`px-6 py-3 text-right tabular ${hl ? "font-semibold" : ""}`}>
                      {f.line_index === null ? "Invoice level" : f.line_index + 1}
                      {hl && <span className="ml-2"><Badge>cited</Badge></span>}
                    </td>
                    <td className="px-3 py-3 tabular">{f.expected}</td>
                    <td className="px-3 py-3 tabular">{f.actual}</td>
                    <td className="px-3 py-3">{f.message}</td>
                    <td className="px-6 py-3">
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
      {view.fragment && view.highlightLine === null && (
        <p className="mt-3 text-xs text-warn">Fragment #{view.fragment} is not a line reference; showing all findings.</p>
      )}
    </Card>
  );
}
