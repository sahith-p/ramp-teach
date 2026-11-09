/** Required on every page (docs/design.md). Rendered once by app/layout.tsx. */
export function DemoBanner() {
  return (
    <div
      data-testid="demo-banner"
      className="w-full border-b border-line bg-wash px-6 py-1.5 text-center text-xs text-ink-muted"
    >
      Unofficial demo inspired by Ramp&apos;s design. Not affiliated with Ramp. All data is synthetic.
    </div>
  );
}
