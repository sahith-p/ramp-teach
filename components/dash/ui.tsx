/** Shared bits for the bill-pay dashboard (Ramp-style look; no Ramp marks). */
import type { DashStatus } from "@/lib/dash";

export const fmtMoney = (n: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);

export const fmtDate = (iso: string | null) =>
  iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "";

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export function VendorAvatar({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-md bg-[#1f1f1f] font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials(name)}
    </span>
  );
}

const PILL: Record<DashStatus, { label: string; cls: string }> = {
  new: { label: "New", cls: "bg-[#f1f1ee] text-ink" },
  reviewing: { label: "Agent reviewing", cls: "bg-[#f4f8c7] text-ink" },
  needs_review: { label: "Needs review", cls: "bg-[#fdf0dc] text-[#8a4b00]" },
  ready: { label: "Ready to approve", cls: "bg-[#e3f3e8] text-[#17633a]" },
  approved: { label: "Approved", cls: "bg-[#e3f3e8] text-[#17633a]" },
  disputed: { label: "Disputed", cls: "bg-[#fbe4e2] text-[#9b1c12]" },
  failed: { label: "Review failed", cls: "bg-[#fbe4e2] text-[#9b1c12]" },
};

export function StatusPill({ status }: { status: DashStatus }) {
  const p = PILL[status];
  return (
    <span data-status={status} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${p.cls}`}>
      {status === "reviewing" && <Spinner />}
      {p.label}
    </span>
  );
}

export function Spinner({ size = 11 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block animate-spin rounded-full border-2 border-current border-r-transparent"
      style={{ width: size, height: size }}
    />
  );
}
