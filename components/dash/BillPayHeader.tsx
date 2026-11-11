export function BillPayHeader() {
  return (
    <div className="mb-6 flex items-center justify-between">
      <h1 className="text-[26px] font-semibold tracking-tight">Bill Pay</h1>
      <div className="flex items-center gap-3">
        <div className="flex w-64 items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm text-ink-faint">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
            <path d="m9.5 9.5 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          Search bills
        </div>
        <span className="rounded-lg bg-[#1f1f1f] px-4 py-2 text-sm font-medium text-white">New bill</span>
      </div>
    </div>
  );
}
