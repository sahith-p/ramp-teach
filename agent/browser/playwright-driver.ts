/**
 * BrowserDriver over a local Playwright Chromium (contracts/engine.ts).
 *
 * Safety (enforced here, not only in the model-facing toolset):
 *  - navigate() refuses any URL whose host is not localhost/127.0.0.1 (or not in allowedOrigins);
 *  - every request the browser makes (documents, sub-resources, redirects, page-started navigations)
 *    goes through a route that aborts anything not on localhost/127.0.0.1.
 * No JavaScript execution or file upload is exposed. Refs come from data-agent-ref stamps (outline.ts).
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { BrowserDriver, BrowserTab, BrowserTarget, PageRef } from "@/contracts";
import { engineConfig } from "@/config/engine";
import { ROOT } from "@/lib/paths";
import { FIND_SCRIPT, OUTLINE_SCRIPT } from "./outline";
import { checkUrl, isLocalUrl } from "./url-policy";

export interface PlaywrightDriverOptions {
  /** e.g. ["http://localhost:3000"]; empty ⇒ any localhost origin. */
  allowedOrigins?: string[];
  /** Absolute directory for screenshots (runs/<id>/screenshots). null ⇒ screenshots not saved. */
  screenshotDir?: string | null;
  headless?: boolean;
  viewport?: { width: number; height: number };
  /** Per-action timeout (ms). */
  timeoutMs?: number;
}

const KEY_ALIASES: Record<string, string> = {
  ctrl: "Control", control: "Control", cmd: "Meta", command: "Meta", super: "Meta", meta: "Meta", win: "Meta",
  alt: "Alt", option: "Alt", shift: "Shift", return: "Enter", enter: "Enter", esc: "Escape", escape: "Escape",
  tab: "Tab", space: "Space", backspace: "Backspace", delete: "Delete", del: "Delete", home: "Home", end: "End",
  page_up: "PageUp", pageup: "PageUp", page_down: "PageDown", pagedown: "PageDown", up: "ArrowUp", down: "ArrowDown",
  left: "ArrowLeft", right: "ArrowRight", arrowup: "ArrowUp", arrowdown: "ArrowDown", arrowleft: "ArrowLeft", arrowright: "ArrowRight",
};

/** Map xdotool-style key names ("ctrl+a", "Return") to Playwright's ("Control+a", "Enter"). */
export function toPlaywrightKeys(keys: string): string[] {
  return keys
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((combo) =>
      combo
        .split("+")
        .map((k) => KEY_ALIASES[k.toLowerCase()] ?? (/^f\d{1,2}$/i.test(k) ? k.toUpperCase() : k))
        .join("+"),
    );
}

export class PlaywrightDriver implements BrowserDriver {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private pages = new Map<string, Page>();
  private activeTab: string | null = null;
  private tabSeq = 0;
  private shotSeq = 0;
  /** Per-driver stamp so screenshots of different runs never overwrite each other. */
  private readonly shotStamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  readonly blockedRequests: string[] = [];
  /** Every URL a document finished loading at (for evidence-pointer resolution). */
  readonly visited: string[] = [];
  private opts: Required<PlaywrightDriverOptions>;

  constructor(opts: PlaywrightDriverOptions = {}) {
    this.opts = {
      allowedOrigins: opts.allowedOrigins ?? [],
      screenshotDir: opts.screenshotDir ?? null,
      headless: opts.headless ?? engineConfig.browser.headless,
      viewport: opts.viewport ?? engineConfig.browser.viewport,
      timeoutMs: opts.timeoutMs ?? 10_000,
    };
  }

  /* ------------------------------ lifecycle ------------------------------ */

  private async ensure(): Promise<void> {
    if (this.context) return;
    // Preinstalled Chromium pinned to Playwright 1.63.0: launch with defaults.
    this.browser = await chromium.launch(this.opts.headless ? undefined : { headless: false });
    // Optional: record a video of the agent's OWN browser (for the walkthrough film). Off unless
    // RAMP_TEACH_RECORD_VIDEO_DIR is set. Recording does not change what the model sees or can do.
    const videoDir = process.env.RAMP_TEACH_RECORD_VIDEO_DIR;
    this.context = await this.browser.newContext({
      viewport: this.opts.viewport,
      acceptDownloads: false,
      ...(videoDir ? { recordVideo: { dir: videoDir, size: this.opts.viewport } } : {}),
    });
    if (videoDir) {
      fs.mkdirSync(videoDir, { recursive: true });
      fs.writeFileSync(path.join(videoDir, "video-start.json"), JSON.stringify({ started_at: new Date().toISOString(), viewport: this.opts.viewport }) + "\n");
    }
    this.context.setDefaultTimeout(this.opts.timeoutMs);
    await this.context.route("**/*", (route) => {
      const url = route.request().url();
      if (isLocalUrl(url)) return route.continue();
      this.blockedRequests.push(url.slice(0, 200));
      return route.abort("blockedbyclient");
    });
    this.context.on("page", (p) => this.register(p));
    const page = await this.context.newPage();
    if (!this.findTabId(page)) this.register(page);
    this.activeTab = this.findTabId(page);
  }

  private register(page: Page): string {
    const existing = this.findTabId(page);
    if (existing) return existing;
    const id = `tab_${++this.tabSeq}`;
    this.pages.set(id, page);
    page.on("dialog", (d) => void d.dismiss().catch(() => {}));
    page.on("load", () => {
      const u = page.url();
      if (isLocalUrl(u)) this.visited.push(u);
    });
    page.on("close", () => {
      this.pages.delete(id);
      if (this.activeTab === id) this.activeTab = this.pages.keys().next().value ?? null;
    });
    return id;
  }

  private findTabId(page: Page): string | null {
    for (const [id, p] of this.pages) if (p === page) return id;
    return null;
  }

  private async page(tabId?: string): Promise<Page> {
    await this.ensure();
    const id = tabId ?? this.activeTab;
    const p = id ? this.pages.get(id) : undefined;
    if (!p) throw new Error(tabId ? `No tab with id ${tabId}` : "No open tab");
    return p;
  }

  async close(): Promise<void> {
    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
    this.context = null;
    this.browser = null;
    this.pages.clear();
  }

  /* ------------------------------ navigation ----------------------------- */

  async navigate(url: string, tabId?: string): Promise<string> {
    const page = await this.page(tabId);
    let resp;
    if (url === "back") resp = await page.goBack({ waitUntil: "load" });
    else if (url === "forward") resp = await page.goForward({ waitUntil: "load" });
    else if (url === "reload") resp = await page.reload({ waitUntil: "load" });
    else {
      const current = page.url();
      const base = isLocalUrl(current) ? current : (this.opts.allowedOrigins[0] ?? null);
      const abs = checkUrl(url, { base, allowedOrigins: this.opts.allowedOrigins });
      resp = await page.goto(abs, { waitUntil: "load" });
    }
    const status = resp?.status();
    return `Navigated to ${page.url()} — ${await page.title()}${status ? ` (HTTP ${status})` : ""}`;
  }

  async currentUrl(tabId?: string): Promise<string> {
    return (await this.page(tabId)).url();
  }

  async tabs(): Promise<BrowserTab[]> {
    await this.ensure();
    const out: BrowserTab[] = [];
    for (const [id, p] of this.pages) {
      out.push({ tab_id: id, title: await p.title().catch(() => ""), url: p.url(), active: id === this.activeTab });
    }
    return out;
  }

  /* ------------------------------- reading ------------------------------- */

  async screenshot(tabId?: string): Promise<{ png: Buffer; savedPath: string | null }> {
    const page = await this.page(tabId);
    const png = await page.screenshot({ type: "png" });
    let savedPath: string | null = null;
    if (this.opts.screenshotDir) {
      fs.mkdirSync(this.opts.screenshotDir, { recursive: true });
      const u = new URL(page.url());
      const slug = `${u.pathname}${u.search}`.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "page";
      const file = path.join(this.opts.screenshotDir, `${this.shotStamp}-${String(++this.shotSeq).padStart(3, "0")}-${slug}.png`);
      fs.writeFileSync(file, png);
      savedPath = path.relative(ROOT, file).split(path.sep).join("/");
    }
    return { png, savedPath };
  }

  async readPage(opts: { filter?: "interactive" | "all"; depth?: number; ref?: string; tabId?: string } = {}): Promise<string> {
    const page = await this.page(opts.tabId);
    const args = { filter: opts.filter ?? "all", depth: opts.depth ?? null, ref: opts.ref ?? null, maxChars: 14_000 };
    const res = (await page.evaluate(`${OUTLINE_SCRIPT}(${JSON.stringify(args)})`)) as { text?: string; error?: string };
    if (res.error) throw new Error(res.error);
    return res.text ?? "";
  }

  async find(query: string, tabId?: string): Promise<PageRef[]> {
    const page = await this.page(tabId);
    const res = (await page.evaluate(`${FIND_SCRIPT}(${JSON.stringify({ query, limit: 15 })})`)) as Array<
      PageRef & { field: string | null; href: string | null }
    >;
    return res.map((r) => ({
      ref: r.ref,
      role: r.role,
      name: [r.name, r.field ? `[data-field=${r.field}]` : "", r.href ? `[href=${r.href}]` : ""].filter(Boolean).join(" "),
    }));
  }

  async getPageText(tabId?: string): Promise<string> {
    const page = await this.page(tabId);
    const text = await page.evaluate("document.body ? document.body.innerText : ''");
    const s = String(text).replace(/\n{3,}/g, "\n\n").trim();
    return s.length > 20_000 ? s.slice(0, 20_000) + "\n… (truncated)" : s;
  }

  async wait(seconds: number): Promise<void> {
    const ms = Math.max(0, Math.min(10, seconds)) * 1000;
    await new Promise((r) => setTimeout(r, ms));
  }

  /* ------------------------------- acting -------------------------------- */

  private async locate(page: Page, ref: string) {
    if (!/^ref_\d+$/.test(ref)) throw new Error(`Invalid ref "${ref}" (expected ref_N from read_page/find)`);
    const loc = page.locator(`[data-agent-ref="${ref}"]`).first();
    if ((await loc.count()) === 0) {
      throw new Error(`Unknown ref ${ref} on this tab (refs reset when the page navigates); call read_page or find again.`);
    }
    return loc;
  }

  /** After an action that may navigate, let the page settle. */
  private async settle(page: Page, before: string): Promise<void> {
    await page.waitForTimeout(150);
    await page.waitForLoadState("load").catch(() => {});
    if (page.url() !== before) await page.waitForLoadState("load").catch(() => {});
  }

  async click(target: BrowserTarget, tabId?: string): Promise<string> {
    const page = await this.page(tabId);
    const before = page.url();
    if (target.type === "ref") {
      const loc = await this.locate(page, target.ref);
      await loc.click();
    } else {
      await page.mouse.click(target.x, target.y);
    }
    await this.settle(page, before);
    const after = page.url();
    return after !== before ? `Page is now ${after}` : "";
  }

  async type(text: string, tabId?: string): Promise<string> {
    const page = await this.page(tabId);
    await page.keyboard.type(text);
    return "";
  }

  async key(keys: string, tabId?: string): Promise<string> {
    const page = await this.page(tabId);
    const before = page.url();
    for (const k of toPlaywrightKeys(keys)) await page.keyboard.press(k);
    await this.settle(page, before);
    return page.url() !== before ? `Page is now ${page.url()}` : "";
  }

  async formInput(ref: string, value: string | number | boolean, tabId?: string): Promise<string> {
    const page = await this.page(tabId);
    const loc = await this.locate(page, ref);
    const info = {
      tag: (await loc.evaluate((el: Element) => el.tagName)).toLowerCase(),
      type: ((await loc.getAttribute("type")) ?? "").toLowerCase(),
    };
    if (info.tag === "select") await loc.selectOption(String(value));
    else if (info.type === "checkbox" || info.type === "radio") await loc.setChecked(Boolean(value));
    else await loc.fill(String(value));
    return "";
  }

  async scroll(target: BrowserTarget, direction: "up" | "down" | "left" | "right", amount = 3, tabId?: string): Promise<string> {
    const page = await this.page(tabId);
    if (target.type === "ref") {
      const loc = await this.locate(page, target.ref);
      await loc.scrollIntoViewIfNeeded();
      const box = await loc.boundingBox();
      if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    } else {
      await page.mouse.move(target.x, target.y);
    }
    const px = 100 * Math.max(1, Math.min(20, amount));
    const dx = direction === "left" ? -px : direction === "right" ? px : 0;
    const dy = direction === "up" ? -px : direction === "down" ? px : 0;
    await page.mouse.wheel(dx, dy);
    await page.waitForTimeout(100);
    return "";
  }

  /** Scroll a ref into view (used by the scroll_to toolset member). Not part of the frozen interface. */
  async scrollTo(ref: string, tabId?: string): Promise<string> {
    const page = await this.page(tabId);
    await (await this.locate(page, ref)).scrollIntoViewIfNeeded();
    return "";
  }

  /** Hover a target (used by the hover toolset member). Not part of the frozen interface. */
  async hover(target: BrowserTarget, tabId?: string): Promise<string> {
    const page = await this.page(tabId);
    if (target.type === "ref") await (await this.locate(page, target.ref)).hover();
    else await page.mouse.move(target.x, target.y);
    return "";
  }
}
