/** Required on every page (docs/design.md): one quiet line at the foot of the page. */
export function DemoBanner() {
  return (
    <div data-testid="demo-banner" className="pointer-events-none fixed bottom-1.5 right-3 z-50 text-[10px] text-ink-faint">
      Unofficial demo inspired by Ramp. Synthetic data.
    </div>
  );
}
