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
    maxTurns: Number(process.env.RAMP_TEACH_MAX_TURNS ?? 25),
    headless: process.env.RAMP_TEACH_HEADFUL !== "1",
    // Override with RAMP_TEACH_VIEWPORT=WIDTHxHEIGHT (e.g. 1280x720 for the walkthrough video).
    viewport: (() => {
      const m = /^(\d{3,4})x(\d{3,4})$/.exec(process.env.RAMP_TEACH_VIEWPORT ?? "");
      return m ? { width: Number(m[1]), height: Number(m[2]) } : { width: 1280, height: 860 };
    })(),
  },
};

/* --------------------------- Anthropic credentials --------------------------- */
// Resolution order (operator instruction): RAMP_ANTHROPIC_API_KEY, then ANTHROPIC_API_KEY, then a
// KEY=VALUE file at $HOME/ramp-teach.env (written by the cloud environment's setup script).
// The key value is NEVER logged, printed, traced, or written anywhere.

export type KeySource = "env:RAMP_ANTHROPIC_API_KEY" | "env:ANTHROPIC_API_KEY" | "file:$HOME/ramp-teach.env";

function readEnvFile(file: string): Record<string, string> {
  try {
    // Lazy require so this module stays importable in non-Node bundles.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    if (!fs.existsSync(file)) return {};
    const out: Record<string, string> = {};
    for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const m = line.replace(/^export\s+/, "").match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      out[m[1]] = v;
    }
    return out;
  } catch {
    return {};
  }
}

let resolved: { key: string; source: KeySource } | null | undefined;

/** Resolve the Anthropic API key once. Returns null when none is available. Never log the key. */
export function resolveAnthropicKey(): { key: string; source: KeySource } | null {
  if (resolved !== undefined) return resolved;
  const fromRamp = process.env.RAMP_ANTHROPIC_API_KEY?.trim();
  const fromStd = process.env.ANTHROPIC_API_KEY?.trim();
  if (fromRamp) resolved = { key: fromRamp, source: "env:RAMP_ANTHROPIC_API_KEY" };
  else if (fromStd) resolved = { key: fromStd, source: "env:ANTHROPIC_API_KEY" };
  else {
    const home = process.env.HOME ?? "";
    const file = home ? readEnvFile(`${home}/ramp-teach.env`) : {};
    const v = (file.RAMP_ANTHROPIC_API_KEY ?? file.ANTHROPIC_API_KEY ?? "").trim();
    resolved = v ? { key: v, source: "file:$HOME/ramp-teach.env" } : null;
  }
  return resolved;
}

/**
 * The real Anthropic API. Set explicitly because the cloud session exports ANTHROPIC_BASE_URL for
 * Claude Code's own use, which the SDK would otherwise pick up. Override: RAMP_ANTHROPIC_BASE_URL.
 */
export const anthropicBaseUrl = process.env.RAMP_ANTHROPIC_BASE_URL ?? "https://api.anthropic.com";

/** True when the configured provider has credentials visible to this process. */
export function providerCredentialsPresent(): boolean {
  if (engineConfig.offline) return false;
  if (engineConfig.provider === "anthropic") return resolveAnthropicKey() !== null;
  return false;
}

/** Where the credential came from (for logs/MORNING.md) — the source name only, never the value. */
export function credentialSource(): KeySource | null {
  return engineConfig.offline ? null : (resolveAnthropicKey()?.source ?? null);
}
