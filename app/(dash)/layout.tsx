/** Bill-pay dashboard shell (Ramp-style). Replaced with the full sidebar layout in the dashboard build. */
export default function DashLayout({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>;
}
