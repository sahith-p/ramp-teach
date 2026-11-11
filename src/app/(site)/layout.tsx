import Link from "next/link";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="border-b border-line">
        <nav className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-4 text-sm">
          <Link href="/" className="text-base font-semibold tracking-tight">
            Ramp Teach
          </Link>
          <Link href="/learn" className="text-ink-muted hover:text-ink">
            Learn
          </Link>
          <Link href="/bills" className="text-ink-muted hover:text-ink">
            Bills
          </Link>
          <Link href="/receipts" className="text-ink-muted hover:text-ink">
            Receipts
          </Link>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
    </>
  );
}
