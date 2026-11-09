/**
 * npm run record:session -- [--base-url URL] [--invoice ID] [--out PATH] [--smoke] [--headed]
 *
 * Mode labels (honest):
 *   DRIVER  = scripted — fixed Playwright steps play the reviewer (no AI anywhere in this script).
 *   CAPTURE = real     — the unpacked Ramp Teach Recorder extension (content script + background +
 *                        side panel) records the session exactly as it would for a human.
 *
 * Flow (lane-spec §2): open /portal/login → side panel "Start recording" → sign in as
 * ap.reviewer/demo-only → /portal/invoices → open the invoice → click every "View timecard" link and
 * read [data-field="approved_hours"] → narration lines typed into the side panel → Stop → Export.
 * The exported Recording is validated against RecordingSchema and written to --out
 * (default extension/recordings/<session_id>.json).
 *
 * --smoke starts the self-contained fixture (extension/scripts/fixture-test-server.ts) on :3013 and
 * records invoice TEST into extension/recordings/smoke.json.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext, type Page } from "playwright";
import { RecordingSchema, type Recording } from "@/contracts";
import { SMOKE_INVOICE, SMOKE_PORT, startFixtureServer } from "./fixture-test-server";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT_DIR = path.resolve(HERE, "..");
const REC_DIR = path.join(EXT_DIR, "recordings");

const { values: args } = parseArgs({
  options: {
    "base-url": { type: "string" },
    invoice: { type: "string" },
    out: { type: "string" },
    smoke: { type: "boolean", default: false },
    headed: { type: "boolean", default: false },
  },
});

const smoke = Boolean(args.smoke);
const baseUrl = (smoke ? `http://localhost:${SMOKE_PORT}` : args["base-url"] ?? process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const invoice = args.invoice ?? (smoke ? SMOKE_INVOICE : "HSG-1010");

function log(msg: string) {
  console.log(`[record-session] ${msg}`);
}

function fail(msg: string): never {
  console.error(`[record-session] FAILED: ${msg}`);
  process.exit(1);
}

{
  const u = new URL(baseUrl);
  if (u.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(u.hostname)) {
    fail(`--base-url must be an http://localhost or http://127.0.0.1 fixture (got ${baseUrl}).`);
  }
}

/* ------------------------------------------------------------------ helpers */

async function stepCount(panel: Page): Promise<number> {
  return panel.evaluate(async () => {
    const got = await chrome.storage.local.get("session");
    const s = got.session as { steps?: unknown[] } | undefined;
    return s?.steps?.length ?? 0;
  });
}

/** Wait until the extension has stored at least `min` more steps than `before` (capture is async). */
async function settle(panel: Page, before: number, min = 1, timeoutMs = 6000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let n = before;
  while (Date.now() < deadline) {
    n = await stepCount(panel);
    if (n >= before + min) break;
    await panel.waitForTimeout(100);
  }
  // Let trailing events (e.g. a pushState navigate) land too.
  await panel.waitForTimeout(600);
  n = await stepCount(panel);
  if (n < before + min) log(`warning: expected ≥${min} new step(s), saw ${n - before}`);
  return n;
}

async function narrate(panel: Page, text: string) {
  const before = await stepCount(panel);
  await panel.fill("#narration", text);
  await panel.click("#btn-narrate");
  await settle(panel, before, 1);
  log(`narration: ${text}`);
}

/** Click on the page and wait for the capture (+ navigation when the click navigates). */
async function act(panel: Page, page: Page, label: string, fn: () => Promise<unknown>, minSteps = 1) {
  const before = await stepCount(panel);
  await fn();
  await page.waitForLoadState("load");
  const after = await settle(panel, before, minSteps);
  log(`${label} (+${after - before} steps)`);
}

async function launch(): Promise<{ ctx: BrowserContext; extId: string; profile: string }> {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "rt-recorder-"));
  // Extensions need the full Chromium build (new headless), not chrome-headless-shell: channel "chromium".
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: !args.headed,
    acceptDownloads: true,
    args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`],
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15_000 });
  const extId = new URL(sw.url()).host;
  return { ctx, extId, profile };
}

/* --------------------------------------------------------------------- main */

async function main() {
  const server = smoke ? await startFixtureServer(SMOKE_PORT) : null;
  if (server) log(`smoke fixture listening on ${baseUrl} (recorder-lane test page, not the real portal)`);

  try {
    const probe = await fetch(`${baseUrl}/portal/login`, { redirect: "manual" }).catch((e: Error) => e);
    if (probe instanceof Error || probe.status >= 500 || probe.status === 404) {
      fail(
        `fixture portal not reachable at ${baseUrl}/portal/login (${probe instanceof Error ? probe.message : `HTTP ${probe.status}`}). ` +
          `Start the Next app (npm run dev) or use --smoke.`,
      );
    }

    log("DRIVER: scripted (Playwright, no AI) · CAPTURE: real (unpacked Ramp Teach Recorder extension)");
    const { ctx, extId, profile } = await launch();
    log(`extension loaded: chrome-extension://${extId}/`);

    try {
      const page = await ctx.newPage();
      await page.goto(`${baseUrl}/portal/login`);

      // The side panel, opened as a tab so the driver can operate it. Start targets the most recent localhost tab.
      const panel = await ctx.newPage();
      await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
      await panel.click("#btn-start");
      await panel.waitForSelector("#status-text:text('Recording')", { timeout: 5000 }).catch(async () => {
        fail(`side panel did not start recording: ${await panel.textContent("#message")}`);
      });
      log(`recording started: ${(await panel.textContent("#message"))?.trim()}`);

      await narrate(panel, `I'm verifying invoice ${invoice} against the vendor timecard portal. First I sign in.`);

      await act(panel, page, "typed username", () => page.fill('input[name="username"]', "ap.reviewer"));
      await act(panel, page, "typed password (must be redacted)", () => page.fill('input[name="password"]', "demo-only"));
      await act(
        panel,
        page,
        "clicked Sign in",
        async () => {
          await Promise.all([page.waitForURL(/\/portal\/invoices/), page.getByRole("button", { name: "Sign in" }).click()]);
        },
        3, // click + submit + navigate
      );

      await narrate(
        panel,
        "Rules I apply: every labor rate must equal the contract rate card; no employee may be billed twice for the same week; " +
          "non-labor charges must be on the allowed list and under their cap; line amounts and the total must tie.",
      );

      await act(
        panel,
        page,
        `opened invoice ${invoice}`,
        async () => {
          await Promise.all([
            page.waitForURL(new RegExp(`/portal/invoices/${invoice}$`)),
            page.locator(`a[href="/portal/invoices/${invoice}"]`).first().click(),
          ]);
        },
        2,
      );

      await narrate(panel, "Now I open each employee's timecard for that week and compare billed hours to approved hours.");

      const links = page.getByRole("link", { name: "View timecard" });
      const n = await links.count();
      if (n === 0) log("warning: no 'View timecard' links on the invoice page");
      for (let i = 0; i < n; i++) {
        const href = await links.nth(i).getAttribute("href");
        await act(
          panel,
          page,
          `opened timecard ${href}`,
          async () => {
            await Promise.all([page.waitForURL(/\/portal\/employees\//), links.nth(i).click()]);
          },
          2,
        );
        const hours = page.locator('[data-field="approved_hours"]');
        if ((await hours.count()) > 0) {
          const name = ((await page.locator('[data-field="employee_name"]').first().textContent()) ?? "").trim();
          const week = ((await page.locator('[data-field="week_ending"]').first().textContent()) ?? "").trim();
          const h = ((await hours.first().textContent()) ?? "").trim();
          await act(panel, page, `read approved_hours=${h}`, () => hours.first().click());
          await narrate(panel, `${name || "This employee"}'s approved timecard for week ending ${week || "?"} shows ${h} hours. Billed hours must not exceed approved hours.`);
        } else {
          await narrate(panel, "No approved timecard found for this line, so the hours check fails.");
        }
        await act(
          panel,
          page,
          "back to invoice",
          async () => {
            await page.goBack();
          },
          1,
        );
      }

      await narrate(panel, "If any check fails I recommend dispute and ask the vendor for a credit memo; otherwise approve.");
      await narrate(panel, "Open question: is overtime above 40 hours a week billable at 1.5 times the rate?");

      await panel.click("#btn-stop");
      await panel.waitForSelector("#status-text:text('Stopped')", { timeout: 5000 });
      log("recording stopped");

      // Export: click the real Export button; capture the download if Playwright surfaces it, else read
      // the same export through the background messaging API (rt:export) the button uses.
      let recording: Recording | null = null;
      let via = "";
      const dl = await Promise.all([panel.waitForEvent("download", { timeout: 5000 }).catch(() => null), panel.click("#btn-export")]).then(([d]) => d);
      if (dl) {
        const tmp = await dl.path();
        recording = JSON.parse(fs.readFileSync(tmp, "utf8"));
        via = `side-panel Export download (${dl.suggestedFilename()})`;
      } else {
        const res = await panel.evaluate(() => chrome.runtime.sendMessage({ type: "rt:export" }));
        if (!res?.ok) fail(`export failed: ${res?.error}`);
        recording = res.recording;
        via = "background rt:export message (download event not surfaced to Playwright)";
      }

      const parsed = RecordingSchema.safeParse(recording);
      if (!parsed.success) fail(`exported recording does not match RecordingSchema: ${parsed.error.message}`);
      const rec = parsed.data;
      const json = JSON.stringify(rec, null, 2) + "\n";
      if (json.includes("demo-only")) fail("plaintext password found in the recording");
      if (!rec.steps.some((s) => s.detail.value === "[redacted]")) fail("no redacted password step found");

      const out = path.resolve(args.out ?? (smoke ? path.join(REC_DIR, "smoke.json") : path.join(REC_DIR, `${rec.session_id}.json`)));
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, json);

      const byEvent: Record<string, number> = {};
      for (const s of rec.steps) byEvent[s.detail.event ?? s.kind] = (byEvent[s.detail.event ?? s.kind] ?? 0) + 1;
      log(`exported via ${via}`);
      log(`RecordingSchema: valid · session ${rec.session_id} · ${rec.steps.length} steps ${JSON.stringify(byEvent)} · ${rec.transcript.length} transcript lines`);
      log(`password redacted: yes · wrote ${path.relative(process.cwd(), out)}`);
    } finally {
      await ctx.close();
      fs.rmSync(profile, { recursive: true, force: true });
    }
  } finally {
    server?.close();
  }
}

main().catch((err) => fail(err?.stack ?? String(err)));
