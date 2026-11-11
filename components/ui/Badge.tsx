const tones = {
  pass: "text-pass border-pass/30 bg-pass/5",
  fail: "text-fail border-fail/30 bg-fail/5",
  warn: "text-warn border-warn/30 bg-warn/5",
  neutral: "text-ink-muted border-line bg-wash",
} as const;

export function Badge({ tone = "neutral", children }: { tone?: keyof typeof tones; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** One muted line when output was written without AI (mock/scripted/deterministic). Nothing for `real`. */
export function OfflineNote({ mode, className = "" }: { mode: string; className?: string }) {
  if (mode === "real") return null;
  return (
    <p className={`text-xs text-ink-faint ${className}`} data-testid="offline-note">
      Offline mode: written without AI.
    </p>
  );
}

/**
 * @deprecated No mode badges in the UI. Kept so pages outside this lane still compile; it renders
 * the same quiet OfflineNote (nothing when `real`).
 */
export function ModeBadge({ mode }: { mode: "real" | "scripted" | "mock" | "deterministic" }) {
  return <OfflineNote mode={mode} />;
}
