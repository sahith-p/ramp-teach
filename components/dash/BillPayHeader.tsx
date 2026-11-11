/** Bill Pay page header, Ramp layout: breadcrumb, large title, secondary + lemon primary actions. */
export function BillPayHeader() {
  return (
    <div className="flex items-end justify-between">
      <div>
        <div className="text-[16px] leading-6 text-[rgb(110,106,104)]">Bill Pay</div>
        <h1 className="mt-1 text-[40px] font-normal leading-[48px] tracking-[-0.01em]">Bills</h1>
      </div>
      <div className="flex items-center gap-2 pb-1">
        <span className="flex h-10 w-8 items-center justify-center text-[rgb(71,69,67)]" aria-hidden>
          <svg width="4" height="16" viewBox="0 0 4 16" fill="currentColor"><circle cx="2" cy="2.5" r="1.5" /><circle cx="2" cy="8" r="1.5" /><circle cx="2" cy="13.5" r="1.5" /></svg>
        </span>
        <span className="flex h-10 items-center border border-[rgb(210,206,203)] px-4 text-[14px] font-normal text-[rgb(71,69,67)]">Recurring bills</span>
        <span className="flex h-10 items-center gap-2 border border-[rgb(228,242,34)] bg-[rgb(228,242,34)] px-4 text-[14px] font-normal text-[rgb(26,25,25)]">
          New bill
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d="m2 3.5 3 3 3-3" stroke="currentColor" strokeWidth="1.3" fill="none" /></svg>
        </span>
      </div>
    </div>
  );
}

/** Ramp top bar: notifications, create, help, avatar. */
export function TopBar({ user }: { user: string }) {
  const initials = (user.split("@")[0].match(/[a-z]/gi) ?? ["N"]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="flex h-[50px] items-center justify-end gap-6 border-b border-[rgb(234,231,228)] px-14">
      {[
        <path key="b" d="M4 11V7.5a4 4 0 1 1 8 0V11l1 1.5H3L4 11Zm2.5 3h3" />,
        <path key="p" d="M8 3v10M3 8h10" />,
        <><circle key="c" cx="8" cy="8" r="5.6" /><path key="q" d="M6.6 6.5a1.5 1.5 0 1 1 2 1.4c-.4.2-.6.5-.6.9v.4M8 11v.1" /></>,
      ].map((d, i) => (
        <svg key={i} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="rgb(71,69,67)" strokeWidth="1.2" strokeLinecap="round" aria-hidden>
          {d}
        </svg>
      ))}
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[rgb(247,178,138)] text-[12px] font-normal text-[rgb(26,25,25)]">{initials}</span>
    </div>
  );
}
