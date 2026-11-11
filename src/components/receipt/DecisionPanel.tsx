"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Bill, HumanDecision } from "@/contracts";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { BillStatusBadge, DecisionBadge } from "./badges";
import { fmtDateTime } from "./format";

export interface RecordedDecision {
  decision: HumanDecision;
  decided_by: string | null;
  decided_at: string | null;
}

/**
 * The human decision. Posts to POST /api/decisions (the only writer of decisions), then shows the
 * recorded decision and the bill it was attached to. The agent never calls this.
 */
export function DecisionPanel({
  invoiceId,
  billId,
  sample,
  recorded,
  bill,
}: {
  invoiceId: string;
  billId: string;
  sample: boolean;
  recorded: RecordedDecision | null;
  bill: Bill | null;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<HumanDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ recorded: RecordedDecision; bill: Bill } | null>(null);

  const shown = result?.recorded ?? recorded;
  const shownBill = result?.bill ?? bill;

  async function decide(decision: HumanDecision) {
    if (!name.trim()) {
      setError("Enter your name.");
      return;
    }
    setPending(decision);
    setError(null);
    try {
      const res = await fetch("/api/decisions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invoice_id: invoiceId, decision, decided_by: name.trim(), ...(note.trim() ? { note: note.trim() } : {}) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? `Request failed (${res.status})`);
        if (res.status === 409) router.refresh();
        return;
      }
      setResult({
        recorded: { decision: json.decision.decision, decided_by: json.decision.decided_by, decided_at: json.decision.decided_at },
        bill: json.bill,
      });
      router.refresh();
    } catch {
      setError("Network error. Not recorded.");
    } finally {
      setPending(null);
    }
  }

  if (shown) {
    return (
      <Card data-testid="decision-recorded">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <DecisionBadge decision={shown.decision} />
          <span className="text-ink-muted">
            {shown.decided_by ?? "Unknown"}, {fmtDateTime(shown.decided_at)}
          </span>
          {/* Bill status only when it disagrees with the decision (e.g. the attach did not happen). */}
          {shownBill && shownBill.status !== (shown.decision === "approve" ? "approved" : "disputed") && (
            <span className="flex items-center gap-2 text-ink-muted">
              Bill <BillStatusBadge status={shownBill.status} />
            </span>
          )}
          <Link href={`/bills/${encodeURIComponent(billId)}`} className="ml-auto font-medium underline underline-offset-4">
            Open bill in inbox
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <Card title="Decide" data-testid="decision-panel">
      <div className="grid gap-4 md:grid-cols-[1fr_1.4fr_auto] md:items-end">
        <label className="block text-sm">
          <span className="mb-1 block text-ink-muted">Your name</span>
          <input
            name="decided_by"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={sample || pending !== null}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-ink disabled:bg-wash"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-ink-muted">Note (optional)</span>
          <input
            name="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={sample || pending !== null}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-ink disabled:bg-wash"
          />
        </label>
        <div className="flex gap-3">
          <Button variant="primary" disabled={sample || pending !== null} onClick={() => decide("approve")}>
            {pending === "approve" ? "Approving…" : "Approve"}
          </Button>
          <Button variant="danger" disabled={sample || pending !== null} onClick={() => decide("dispute")}>
            {pending === "dispute" ? "Disputing…" : "Dispute"}
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-fail">
          {error}
        </p>
      )}
    </Card>
  );
}
