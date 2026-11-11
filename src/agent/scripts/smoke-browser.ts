/**
 * Minimal REAL smoke test of the browser toolset wire format (makes real Anthropic API calls — costs money).
 * Usage: npx tsx agent/scripts/smoke-browser.ts [--base-url http://127.0.0.1:3014] [--max-turns 4]
 * Task: open the sign-in page, take one screenshot, reply. Prints turns, stop reason, actions, token usage.
 */
import path from "node:path";
import { getProvider } from "@/agent/providers";
import { PlaywrightDriver } from "@/agent/browser/playwright-driver";
import { normalizeOrigin } from "@/agent/browser/url-policy";
import { browserSystemPrompt } from "@/agent/engine";
import { P } from "@/lib/paths";

async function main() {
  const arg = (k: string, d: string) => {
    const i = process.argv.indexOf(k);
    return i > -1 ? process.argv[i + 1] : d;
  };
  const baseUrl = arg("--base-url", "http://127.0.0.1:3014");
  const maxTurns = Number(arg("--max-turns", "4"));
  const provider = getProvider();
  if (!provider) throw new Error("No credentials: the smoke test needs a real provider.");
  const origin = normalizeOrigin(baseUrl);
  const driver = new PlaywrightDriver({ allowedOrigins: [origin], screenshotDir: path.join(P.runs, "_smoke", "screenshots") });
  try {
    const res = await provider.runBrowserTask({
      system: browserSystemPrompt([origin]),
      task: "Smoke test: open the portal sign-in page, take exactly one screenshot of it, then reply with one sentence describing the page. Do not sign in.",
      startUrl: `${baseUrl}/portal/login`,
      allowedOrigins: [origin],
      maxTurns,
      driver,
      onStep: (s) => {
        if (s.kind === "action") console.log(`action  ${String(s.detail.tool)} ${JSON.stringify(s.detail.input)}`);
        else if (s.kind === "result" && s.detail.tool) console.log(`result  ${JSON.stringify(s.detail.content).slice(0, 200)}${s.detail.is_error ? " (error)" : ""}`);
        else if (s.kind === "result") console.log(`turn ${String(s.detail.turn)} stop_reason=${String(s.detail.stop_reason)}`);
        else if (s.kind === "text") console.log(`text    ${String(s.detail.text).slice(0, 200)}`);
      },
    });
    const extra = res as typeof res & { usage?: unknown; stopReason?: string };
    console.log(JSON.stringify({ turns: res.turns, stopReason: extra.stopReason, model: res.model, usage: extra.usage, finalText: res.finalText }, null, 2));
  } finally {
    await driver.close();
  }
}

main().catch((e) => {
  console.error(`smoke failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
