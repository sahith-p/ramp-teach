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

/** Mode label shown wherever an output is displayed: never pass off scripted/mock as AI. */
export function ModeBadge({ mode }: { mode: "real" | "scripted" | "mock" | "deterministic" }) {
  const label = {
    real: "Real AI (Claude)",
    scripted: "Scripted (Playwright, no AI)",
    mock: "Mock (deterministic, no AI)",
    deterministic: "Deterministic (no AI)",
  }[mode];
  return <Badge tone={mode === "real" ? "pass" : "warn"}>{label}</Badge>;
}
