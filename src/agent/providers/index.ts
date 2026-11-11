/**
 * Provider selection (config-level swap point). Returns null when the configured provider
 * has no credentials visible to this process — callers then run their labeled offline mode.
 */
import type { AIProvider } from "@/contracts";
import { engineConfig, providerCredentialsPresent } from "@/config/engine";
import { AnthropicProvider } from "./anthropic";

const registry: Record<string, () => AIProvider> = {
  anthropic: () => new AnthropicProvider(),
};

export function getProvider(): AIProvider | null {
  if (!providerCredentialsPresent()) return null;
  const make = registry[engineConfig.provider];
  if (!make) throw new Error(`Unknown AI provider "${engineConfig.provider}" (only "anthropic" is implemented)`);
  return make();
}
