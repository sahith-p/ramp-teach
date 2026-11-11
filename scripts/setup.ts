/**
 * One-shot setup + health check for a new person or agent picking up the repo (see docs/HANDOFF.md).
 *
 *   npm run setup            # everything below, including typecheck and tests
 *   npm run setup -- --quick # skip typecheck and tests
 *
 * Does what it can by itself (install deps, check Chromium and ffmpeg, cache the Lausanne font, check the API key
 * against the API, check the committed artifacts) and ends with the MANUAL steps a human must do. It never prints
 * the API key; only where it was found.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const ROOT = process.cwd();
const QUICK = process.argv.includes("--quick");
type Status = "ok" | "warn" | "fail";
const results: { name: string; status: Status; note: string }[] = [];
const manual: string[] = [];
const add = (name: string, status: Status, note: string) => {
  results.push({ name, status, note });
  console.log(`${status === "ok" ? "✓" : status === "warn" ? "!" : "✗"} ${name}: ${note}`);
};
const run = (cmd: string, args: string[], env: Record<string, string> = {}) =>
  spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", env: { ...process.env, ...env } });

async function main() {
  if (!fs.existsSync(path.join(ROOT, "package.json")) || !fs.existsSync(path.join(ROOT, "docs", "HANDOFF.md"))) {
    console.error("Run this from the repo root (the folder with package.json).");
    process.exit(1);
  }

  // 1. Node
  const major = Number(process.versions.node.split(".")[0]);
  add("node", major >= 22 ? "ok" : "fail", `v${process.versions.node}${major >= 22 ? "" : " (need 22 or newer)"}`);
  if (major < 22) manual.push("Install Node 22 or newer, then run `npm run setup` again.");

  // 2. Dependencies
  if (!fs.existsSync(path.join(ROOT, "node_modules", "next", "package.json"))) {
    console.log("… installing dependencies (npm install)");
    const r = spawnSync("npm", ["install", "--no-audit", "--no-fund"], { cwd: ROOT, stdio: "inherit" });
    add("dependencies", r.status === 0 ? "ok" : "fail", r.status === 0 ? "installed" : "npm install failed");
  } else add("dependencies", "ok", "node_modules present");

  // 3. Chromium (Playwright)
  try {
    const { chromium } = await import("playwright");
    const b = await chromium.launch();
    await b.close();
    add("chromium", "ok", "Playwright can launch Chromium");
  } catch (e) {
    add("chromium", "fail", `Playwright can't launch Chromium (${String(e).split("\n")[0].slice(0, 120)})`);
    manual.push(
      "Install Chromium for Playwright: `npx playwright install chromium` (on a Claude Code cloud machine it is preinstalled; do not reinstall there).",
    );
  }

  // 4. ffmpeg (only needed for the videos)
  const ff = run("ffmpeg", ["-hide_banner", "-encoders"]);
  if (ff.error) {
    add("ffmpeg", "warn", "not found (only needed to make the videos)");
    manual.push("Optional, for the videos: install ffmpeg with libx264 (macOS: `brew install ffmpeg`).");
  } else add("ffmpeg", /libx264/.test(ff.stdout) ? "ok" : "warn", /libx264/.test(ff.stdout) ? "with libx264" : "found, but without libx264");

  // 5. Lausanne cache for the video renderers (optional; renderers fall back to assets.ramp.com)
  const lausanne = path.join(ROOT, "demo", "video", "assets", "fonts", "lausanne");
  const haveFonts = [300, 400, 700].every((w) => fs.existsSync(path.join(lausanne, `TWKLausanne-${w}.woff2`)));
  if (haveFonts) add("lausanne font", "ok", "cached for the video renderers");
  else {
    const r = run("npx", ["tsx", "demo/video/fetch-fonts.ts"], { NODE_USE_ENV_PROXY: "1", NODE_NO_WARNINGS: "1" });
    add("lausanne font", r.status === 0 ? "ok" : "warn", r.status === 0 ? "downloaded to the local cache" : "could not download; renderers will load it online");
  }

  // 6. Anthropic API key (presence, source, and a free check against the API)
  const { resolveAnthropicKey, anthropicBaseUrl, engineConfig } = await import("../config/engine");
  const cred = resolveAnthropicKey();
  if (!cred) {
    add("api key", "warn", "not found: everything runs in labeled offline mode; the film script refuses to shoot");
    manual.push(
      [
        "Give the project an Anthropic API key (never commit it or paste it into chat). Pick one:",
        "  • Own machine: `echo 'RAMP_ANTHROPIC_API_KEY=sk-ant-…' > ~/ramp-teach.env && chmod 600 ~/ramp-teach.env`",
        "  • Shell: `export RAMP_ANTHROPIC_API_KEY=sk-ant-…`",
        "  • Claude Code cloud session: environment menu in the session title bar → Edit → add environment variable",
        "    RAMP_ANTHROPIC_API_KEY, then restart or resume the session.",
        "  Then run `npm run setup` again to confirm.",
      ].join("\n"),
    );
  } else {
    try {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey: cred.key, baseURL: anthropicBaseUrl });
      const page = await client.models.list({ limit: 50 });
      const ids = page.data.map((m) => m.id);
      const hasModel = ids.includes(engineConfig.model);
      add("api key", hasModel ? "ok" : "warn", `found in ${cred.source}; accepted by the API${hasModel ? `; ${engineConfig.model} available` : `; ${engineConfig.model} not in the first page of models`}`);
    } catch (e) {
      const status = (e as { status?: number }).status;
      add("api key", "fail", `found in ${cred.source} but the API rejected it${status ? ` (HTTP ${status})` : ""}`);
      manual.push("The API key was rejected: replace it with a valid Anthropic key (same places as above), then run `npm run setup` again.");
    }
  }

  // 6b. ElevenLabs key (voice; optional)
  if (process.env.ELEVENLABS_API_KEY) add("elevenlabs key", "ok", "found (voice transcription available)");
  else {
    add("elevenlabs key", "warn", "not found: voice uses browser dictation and the demo narration path");
    manual.push(
      "Optional, for real speech-to-text: add the environment variable ELEVENLABS_API_KEY (same places as the Anthropic key; never commit it).",
    );
  }

  // 7. Port 3000 (the app, demo and film use it)
  const free = await new Promise<boolean>((resolve) => {
    const s = net.createServer().once("error", () => resolve(false)).once("listening", () => s.close(() => resolve(true)));
    s.listen(3000, "127.0.0.1");
  });
  add("port 3000", free ? "ok" : "warn", free ? "free" : "in use (stop the other server, e.g. `pkill -f next-server`)");

  // 8. Committed artifacts are real-mode
  const g = run("npx", ["tsx", "scripts/guard-artifacts.ts"]);
  add("artifact guard", g.status === 0 ? "ok" : "fail", (g.stdout || g.stderr).trim().split("\n").pop() ?? "");

  // 9. Typecheck + tests
  if (!QUICK) {
    const tc = run("npx", ["tsc", "--noEmit"]);
    add("typecheck", tc.status === 0 ? "ok" : "fail", tc.status === 0 ? "clean" : "errors (run `npm run typecheck`)");
    const t = run("npx", ["vitest", "run"]);
    const line = /Tests\s+(.+)/.exec(t.stdout)?.[1]?.trim() ?? "see `npm test`";
    add("tests", t.status === 0 ? "ok" : "fail", line);
  }

  // Summary
  const bad = results.filter((r) => r.status === "fail").length;
  console.log(`\n${bad ? `${bad} problem(s) found.` : "Setup done."} Real Claude calls: ${cred ? "available" : "NOT available (offline mode)"}.`);
  console.log("\nMANUAL STEPS FOR A HUMAN" + (manual.length ? ":" : ": none"));
  manual.forEach((m, i) => console.log(`${i + 1}. ${m}`));
  console.log("\nNext: read docs/HANDOFF.md §3 to run the app, demo/video/PIPELINE.md to make the film.");
  process.exit(bad ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
