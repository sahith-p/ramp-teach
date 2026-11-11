/**
 * Halcyon Staffing Group (fictional vendor) logo: a calm sun settling on a horizon, "halcyon days".
 * Original artwork for this demo.
 */
export function HalcyonMark({ size = 28, onDark = false }: { size?: number; onDark?: boolean }) {
  const ink = onDark ? "#ffffff" : "#123c4a";
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="7" fill={onDark ? "rgba(255,255,255,0.08)" : "#123c4a"} />
      <path d="M9 19a7 7 0 0 1 14 0Z" fill="#f2b33d" />
      <path d="M6 19.5h20" stroke={onDark ? ink : "#ffffff"} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M9 23.2h14M12.5 26.6h7" stroke={onDark ? ink : "#ffffff"} strokeWidth="1.8" strokeLinecap="round" opacity=".55" />
    </svg>
  );
}

export function HalcyonLogo({ onDark = false, size = 28 }: { onDark?: boolean; size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <HalcyonMark size={size} onDark={onDark} />
      <span className="leading-none">
        <span className={`block text-[17px] font-semibold tracking-tight ${onDark ? "text-white" : "text-[#123c4a]"}`}>Halcyon</span>
        <span className={`block text-[10.5px] uppercase tracking-[0.18em] ${onDark ? "text-white/70" : "text-[#123c4a]/70"}`}>Staffing Group</span>
      </span>
    </span>
  );
}
