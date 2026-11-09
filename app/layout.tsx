import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { DemoBanner } from "@/components/ui/DemoBanner";

export const metadata: Metadata = {
  title: "Ramp Teach — invoice verification demo",
  description: "Unofficial demo inspired by Ramp's design. Teach an agent to verify a service invoice.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-surface text-ink">
        <DemoBanner />
        <header className="border-b border-line">
          <nav className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-4 text-sm">
            <Link href="/" className="font-display text-xl tracking-tight">
              Ramp Teach
            </Link>
            <Link href="/portal/login" className="text-ink-muted hover:text-ink">
              Vendor portal (fixture)
            </Link>
            <Link href="/bills" className="text-ink-muted hover:text-ink">
              Bill inbox (fixture)
            </Link>
            <Link href="/receipts" className="text-ink-muted hover:text-ink">
              Receipts
            </Link>
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
      </body>
    </html>
  );
}
