import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import type { BillStatus } from "@/contracts";

/**
 * @deprecated The global footer (DemoBanner) is the demo label now. Kept only for pages outside the
 * portal that still import it; renders nothing.
 */
export function FixtureLabel(_props: { app: "portal" | "bills" }) {
  return null;
}

/** Halcyon Staffing's own brand color: the vendor site must not look like Ramp Teach. */
const BRAND = "bg-[#123c4a]";

/** The vendor's site header: name, "Client portal", and nav when signed in. */
export function PortalHeader({ signedIn = true }: { signedIn?: boolean }) {
  return (
    <header className={`${BRAND} text-white`}>
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-4">
        <Link href={signedIn ? "/portal/invoices" : "/portal/login"} className="flex items-baseline gap-3">
          <span className="text-lg font-semibold">Halcyon Staffing</span>
          <span className="text-sm text-white/60">Client portal</span>
        </Link>
        {signedIn && (
          <nav aria-label="Portal" className="flex items-center gap-6 text-sm">
            <Link href="/portal/invoices" className="text-white/80 hover:text-white">
              Invoices
            </Link>
            <Link href="/portal/employees" className="text-white/80 hover:text-white">
              Employees
            </Link>
            <form action="/api/portal/logout" method="post">
              <button type="submit" className="text-white/80 hover:text-white">
                Sign out
              </button>
            </form>
          </nav>
        )}
      </div>
    </header>
  );
}

/** Vendor page frame: the vendor header, then the page body. */
export function PortalShell({ signedIn = true, children }: { signedIn?: boolean; children: ReactNode }) {
  return (
    <>
      <PortalHeader signedIn={signedIn} />
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </>
  );
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold">{children}</h1>
      {sub && <p className="mt-1 text-sm text-ink-muted">{sub}</p>}
    </div>
  );
}

/** Plain table: header row, row rules, text-sm. */
export function Table({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-md border border-line">
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
/** Vendor-portal links in the vendor's own color. */
export const plink = "text-[#1a5b70] underline decoration-[#1a5b70]/30 underline-offset-4 hover:decoration-[#1a5b70]";

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
    <div className="flex flex-col gap-0.5">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="text-base" {...(field ? { "data-field": field } : {})}>
        {children}
      </dd>
    </div>
  );
}
