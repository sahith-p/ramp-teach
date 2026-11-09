import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import type { BillStatus } from "@/contracts";

/** Visible per-app fixture label (the global demo banner comes from app/layout.tsx). */
export function FixtureLabel({ app }: { app: "portal" | "bills" }) {
  const text = app === "portal" ? "Fixture vendor portal — synthetic data" : "Fixture bill inbox — synthetic data";
  return (
    <p
      data-testid="fixture-label"
      className="mb-6 inline-flex items-center gap-2 rounded-full border border-line bg-wash px-3 py-1 text-xs text-ink-muted"
    >
      <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-ink-faint" />
      {text}
    </p>
  );
}

/** Header for vendor-portal pages: fixture label, portal name, sub-navigation. */
export function PortalHeader({ signedIn = true }: { signedIn?: boolean }) {
  return (
    <div className="mb-8">
      <FixtureLabel app="portal" />
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-ink-faint">Vendor timecard portal</div>
          <div className="text-lg font-semibold tracking-tight">Halcyon Staffing Group — client access</div>
        </div>
        {signedIn && (
          <nav aria-label="Portal" className="flex items-center gap-5 text-sm">
            <Link href="/portal/invoices" className="text-ink-muted hover:text-ink">
              Invoices
            </Link>
            <Link href="/portal/employees" className="text-ink-muted hover:text-ink">
              Employees
            </Link>
            <form action="/api/portal/logout" method="post">
              <button type="submit" className="text-ink-muted hover:text-ink">
                Sign out
              </button>
            </form>
          </nav>
        )}
      </div>
    </div>
  );
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="font-display text-4xl tracking-tight">{children}</h1>
      {sub && <p className="mt-2 text-sm text-ink-muted">{sub}</p>}
    </div>
  );
}

/** Semantic table wrapper per docs/design.md: wash header, row rules, text-sm, no zebra. */
export function Table({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export const th = "border-b border-line bg-wash px-4 py-2.5 text-left font-medium text-ink-muted";
export const thMoney = `${th} text-right`;
export const td = "border-b border-line px-4 py-3 align-top";
export const tdMoney = `${td} text-right tabular`;
export const link = "underline decoration-line underline-offset-4 hover:decoration-ink";

const statusTone = {
  pending: "neutral",
  receipt_attached: "warn",
  approved: "pass",
  disputed: "fail",
} as const;

const statusText: Record<BillStatus, string> = {
  pending: "Pending",
  receipt_attached: "Receipt attached",
  approved: "Approved",
  disputed: "Disputed",
};

export function BillStatusBadge({ status }: { status: BillStatus }) {
  return (
    <span data-bill-status={status}>
      <Badge tone={statusTone[status]}>{statusText[status]}</Badge>
    </span>
  );
}

/** Labelled read-only value (dt/dd). Pass `field` to add a stable [data-field] marker on the value. */
export function Field({ label, field, children }: { label: string; field?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs uppercase tracking-wider text-ink-faint">{label}</dt>
      <dd className="text-base" {...(field ? { "data-field": field } : {})}>
        {children}
      </dd>
    </div>
  );
}
