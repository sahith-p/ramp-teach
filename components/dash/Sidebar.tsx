import Link from "next/link";
import { initials } from "./ui";

const NAV: { label: string; href?: string; active?: boolean }[] = [
  { label: "Home" },
  { label: "Cards" },
  { label: "Reimbursements" },
  { label: "Bill Pay", href: "/bills", active: true },
  { label: "Vendors" },
  { label: "Accounting" },
  { label: "Insights" },
];

const Icon = ({ i }: { i: number }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0">
    {i === 0 && <path d="M2.5 7.5 8 3l5.5 4.5V13a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V7.5Z" stroke="currentColor" strokeWidth="1.3" />}
    {i === 1 && <rect x="2" y="4" width="12" height="8.5" rx="1.5" stroke="currentColor" strokeWidth="1.3" />}
    {i === 2 && <path d="M4 2.5h8v11l-2-1.2-2 1.2-2-1.2-2 1.2v-11Z" stroke="currentColor" strokeWidth="1.3" />}
    {i === 3 && <path d="M3 2.5h7l3 3v8H3v-11Zm7 0v3h3M5.5 8.5h5M5.5 11h5" stroke="currentColor" strokeWidth="1.3" />}
    {i === 4 && <path d="M2.5 13.5v-7l5.5-3 5.5 3v7M5.5 13.5v-4h5v4" stroke="currentColor" strokeWidth="1.3" />}
    {i === 5 && <path d="M3 13V8m3.3 5V5m3.4 8V9.5M13 13V3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />}
    {i === 6 && <path d="M2.5 12.5 6 8l3 2.5 4.5-6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />}
  </svg>
);

export function Sidebar({ user }: { user: string }) {
  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-line bg-[#fbfbf9] px-3 py-4">
      <div className="mb-6 px-3 text-[17px] font-semibold tracking-tight">Ramp Teach</div>
      <nav className="flex flex-col gap-0.5 text-[13.5px]">
        {NAV.map((n, i) =>
          n.href ? (
            <Link
              key={n.label}
              href={n.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 ${n.active ? "bg-[#efefea] font-medium text-ink" : "text-ink-muted hover:bg-[#f3f3ef]"}`}
            >
              <Icon i={i} />
              {n.label}
            </Link>
          ) : (
            <span key={n.label} className="flex cursor-default items-center gap-3 rounded-lg px-3 py-2 text-ink-muted">
              <Icon i={i} />
              {n.label}
            </span>
          ),
        )}
      </nav>
      <div className="mt-auto flex items-center gap-3 rounded-lg px-3 py-2">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-accent text-xs font-semibold text-ink">
          {initials(user.split("@")[0].replace(/[._-]/g, " ")) || "N"}
        </span>
        <div className="min-w-0 text-[13px] leading-tight">
          <div className="font-medium">Northwind</div>
          <div className="truncate text-ink-faint">{user}</div>
        </div>
      </div>
    </aside>
  );
}
