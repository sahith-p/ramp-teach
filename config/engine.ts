/**
 * Engine configuration — the swappable AI-provider boundary lives here.
 * Only "anthropic" is implemented (agent/providers/anthropic.ts). To add a provider later,
 * implement contracts/engine.ts `AIProvider` and register it in agent/providers/index.ts.
 */
export const engineConfig = {
  provider: (process.env.RAMP_TEACH_PROVIDER ?? "anthropic") as "anthropic",
  model: process.env.RAMP_TEACH_MODEL ?? "claude-opus-5-5",
  effort: (process.env.RAMP_TEACH_EFFORT ?? "medium") as "low" | "medium" | "high" | "xhigh" | "max",
  /** Force offline modes even when credentials exist (for tests/CI). */
  offline: process.env.RAMP_TEACH_OFFLINE === "1",
  browser: {
    maxTurns: Number(process.env.RAMP_TEACH_MAX_TURNS ?? 40),
    headless: process.env.RAMP_TEACH_HEADFUL !== "1",
    viewport: { width: 1280, height: 860 },
  },
};

/** True when the configured provider has credentials visible to this process. */
export function providerCredentialsPresent(): boolean {
  if (engineConfig.offline) return false;
  if (engineConfig.provider === "anthropic") return Boolean(process.env.ANTHROPIC_API_KEY);
  return false;
}
