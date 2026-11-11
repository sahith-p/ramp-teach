import Link from "next/link";

const STEPS: { name: string; text: string; href: string; link: string }[] = [
  { name: "Record", text: "Check one invoice yourself.", href: "/portal/login", link: "Vendor portal" },
  { name: "Learn", text: "The agent writes the rules.", href: "/learn", link: "Rules" },
  { name: "Check", text: "It checks the next invoice.", href: "/receipts", link: "Receipts" },
  { name: "Receipt", text: "Every check shows its proof.", href: "/receipts/HSG-1011", link: "HSG-1011" },
  { name: "Decide", text: "You approve or dispute.", href: "/bills", link: "Bills" },
];

export default function Home() {
  return (
    <div className="space-y-12">
      <header>
        <h1 className="text-4xl font-semibold tracking-tight">Ramp Teach</h1>
        <p className="mt-3 text-lg text-ink-muted">Teach an agent to check invoices by doing it once.</p>
      </header>

      <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {STEPS.map((s, i) => (
          <li key={s.name} className="flex flex-col rounded-[var(--radius-card)] border border-line p-5">
            <div className="text-sm text-ink-faint tabular">{i + 1}</div>
            <div className="mt-1 text-base font-semibold">{s.name}</div>
            <p className="mt-1 text-sm text-ink-muted">{s.text}</p>
            <Link href={s.href} className="mt-4 text-sm font-medium underline decoration-line underline-offset-4 hover:decoration-ink">
              {s.link}
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
