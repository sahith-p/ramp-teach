/** Required on every page (docs/design.md): one quiet line at the foot of the page. */
export function DemoBanner() {
  return (
    <div data-testid="demo-banner" className="px-6 py-3 text-center text-[11px] text-ink-faint">
      Unofficial demo inspired by Ramp. Synthetic data.
    </div>
  );
}
