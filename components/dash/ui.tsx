/** Shared bits for the bill-pay dashboard (Ramp-style look; no Ramp marks). */
import Link from "next/link";
import type { DashStatus } from "@/lib/dash";
import { HalcyonMark } from "@/components/fixtures/HalcyonLogo";

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
  if (/halcyon/i.test(name)) return <HalcyonMark size={size} />;
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

/* ------------------------------ page building blocks ------------------------------ */

export const INK = "text-[rgb(26,25,25)]";
export const MUTED = "text-[rgb(110,106,104)]";
export const SECOND = "text-[rgb(71,69,67)]";
export const BTN = "inline-flex h-10 items-center gap-2 border border-[rgb(210,206,203)] bg-white px-4 text-[14px] font-normal text-[rgb(71,69,67)] hover:bg-[rgb(250,249,248)] disabled:opacity-40";
export const BTN_PRIMARY = "inline-flex h-10 items-center gap-2 border border-[rgb(228,242,34)] bg-[rgb(228,242,34)] px-4 text-[14px] font-normal text-[rgb(26,25,25)] hover:brightness-95 disabled:opacity-40";

/** White panel with Ramp's hairline border. */
export function Card({ title, aside, children, className = "", pad = true, testId }: { title?: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode; className?: string; pad?: boolean; testId?: string }) {
  return (
    <section data-testid={testId} className={`border border-[rgb(234,231,228)] bg-white ${className}`}>
      {(title || aside) && (
        <div className="flex min-h-12 items-center justify-between gap-4 border-b border-[rgb(234,231,228)] px-5">
          <h2 className="text-[15px] font-normal">{title}</h2>
          {aside && <div className={`flex items-center gap-3 text-[13px] ${MUTED}`}>{aside}</div>}
        </div>
      )}
      <div className={pad ? "p-5" : ""}>{children}</div>
    </section>
  );
}

/** Small neutral tag. Used for real model output only ("Claude", "ElevenLabs Scribe v2"). */
export function Tag({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className="inline-flex h-5 items-center whitespace-nowrap rounded-[3px] bg-[rgb(234,231,228)] px-1.5 text-[11.5px] font-normal leading-none text-[rgb(71,69,67)]">
      {children}
    </span>
  );
}

export function ModeTag({ label }: { label: string | null }) {
  return label ? <Tag>{label}</Tag> : null;
}

export function Pill({ tone = "neutral", children, testId }: { tone?: "neutral" | "good" | "bad" | "warn" | "lemon"; children: React.ReactNode; testId?: string }) {
  const cls = {
    neutral: "bg-[#f1f1ee] text-ink",
    good: "bg-[#e3f3e8] text-[#17633a]",
    bad: "bg-[#fbe4e2] text-[#9b1c12]",
    warn: "bg-[#fdf0dc] text-[#8a4b00]",
    lemon: "bg-[#f4f8c7] text-ink",
  }[tone];
  return (
    <span data-testid={testId} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {children}
    </span>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className={`py-14 text-center text-[14px] ${MUTED}`}>{children}</div>;
}

/** Back link above a page title. */
export function BackLink({ href, children, label }: { href: string; children: React.ReactNode; label?: string }) {
  return (
    <Link href={href} aria-label={label} className={`inline-flex items-center gap-1.5 text-[14px] ${MUTED} hover:text-[rgb(26,25,25)]`}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
        <path d="M7.5 2.5 4 6l3.5 3.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
      </svg>
      {children}
    </Link>
  );
}

/** Ramp underline tabs. `items` are links; the active one is underlined. Full-bleed under the header. */
export function TabBar({ items, active, testId = "tabs" }: { items: { key: string; label: string; href: string; count?: number }[]; active: string; testId?: string }) {
  return (
    <nav data-testid={testId} className="-mx-14 mt-6 flex items-end border-b border-[rgb(226,222,219)] px-[42px]">
      {items.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          scroll={false}
          data-tab={t.key}
          aria-current={t.key === active ? "page" : undefined}
          className={`-mb-px flex h-12 items-center gap-2 border-b-2 px-4 text-[15px] ${t.key === active ? "border-[rgb(26,25,25)] text-[rgb(26,25,25)]" : "border-transparent text-[rgb(110,106,104)] hover:text-[rgb(26,25,25)]"}`}
        >
          {t.label}
          {t.count !== undefined && <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-[3px] bg-[rgb(234,231,228)] px-1 text-[12px] text-[rgb(71,69,67)]">{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

/** Gray content area under the tabs (full bleed). */
export function Wash({ children }: { children: React.ReactNode }) {
  return <div className="-mx-14 min-h-[calc(100vh-260px)] bg-[rgb(250,249,248)] px-14 pb-16 pt-6">{children}</div>;
}

/** Row of key figures under a page title. */
export function Stats({ items }: { items: { label: string; value: React.ReactNode; testId?: string }[] }) {
  return (
    <dl className="mt-6 flex flex-wrap gap-x-12 gap-y-4">
      {items.map((s) => (
        <div key={s.label} data-testid={s.testId}>
          <dt className={`text-[13px] ${MUTED}`}>{s.label}</dt>
          <dd className="tabular mt-0.5 text-[18px] font-normal">{s.value || <span className={MUTED}>None</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export function CheckIcon({ ok = true, size = 16 }: { ok?: boolean; size?: number }) {
  return ok ? (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden className="shrink-0 text-[#17633a]">
      <circle cx="8" cy="8" r="7" fill="currentColor" opacity=".12" />
      <path d="m5 8.2 2 2 4-4.4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden className="shrink-0 text-[#b42318]">
      <circle cx="8" cy="8" r="7" fill="currentColor" opacity=".12" />
      <path d="M8 4.6v4.2M8 11.2v.1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
