/**
 * browser_toolset_20260801 members mapped onto the provider-neutral BrowserDriver, via the SDK helper
 * BetaAbstractBrowserToolset20260801 (it builds the wire tool_result blocks: toolset_name echo,
 * image blocks for screenshots, browser_state blocks, error text bounds).
 *
 * Served members: navigate, screenshot, left_click, double_click, triple_click, hover, scroll, scroll_to,
 * type, key, form_input, read_page, find, get_page_text, wait, list_tabs.
 * Everything else is reported to the API as disabled (the SDK does that for members not overridden);
 * javascript_exec / file_upload / read_console / read_network are additionally disabled explicitly.
 * The urlPolicy refuses non-localhost / non-allowed origins with ToolError; the driver enforces the
 * same rule again (navigation + request routing), so the toolset is not the only boundary.
 */
import { BetaAbstractBrowserToolset20260801, ToolError } from "@anthropic-ai/sdk/helpers/beta/toolsets";
import type { BetaBrowserNavigateResult, BetaScreenshotResult, BetaToolsetCallContext } from "@anthropic-ai/sdk/helpers/beta/toolsets";
import type {
  BetaBrowserClickTarget,
  BetaBrowserDoubleClickInput,
  BetaBrowserFindInput,
  BetaBrowserFormInputInput,
  BetaBrowserGetPageTextInput,
  BetaBrowserHoverInput,
  BetaBrowserKeyInput,
  BetaBrowserLeftClickInput,
  BetaBrowserListTabsInput,
  BetaBrowserNavigateInput,
  BetaBrowserReadPageInput,
  BetaBrowserScreenshotInput,
  BetaBrowserScrollInput,
  BetaBrowserScrollToInput,
  BetaBrowserStateTabEntry,
  BetaBrowserTripleClickInput,
  BetaBrowserTypeInput,
  BetaBrowserWaitInput,
} from "@anthropic-ai/sdk/resources/beta";
import type { BrowserDriver, BrowserTarget } from "@/contracts";
import { checkUrl, isLocalUrl, UrlRefusedError } from "@/agent/browser/url-policy";

type Ctx = BetaToolsetCallContext;

/** Optional driver extras (PlaywrightDriver has them); members fall back when absent. */
interface DriverExtras {
  scrollTo?(ref: string, tabId?: string): Promise<string>;
  hover?(target: BrowserTarget, tabId?: string): Promise<string>;
}

const tab = (t?: string | null) => t ?? undefined;
const toTarget = (t: BetaBrowserClickTarget): BrowserTarget =>
  t.type === "ref" ? { type: "ref", ref: t.ref } : { type: "coordinate", x: t.x, y: t.y };

export interface DriverBrowserToolsetOptions {
  allowedOrigins: string[];
  /** Called with every screenshot's saved path (never the bytes). */
  onScreenshot?: (savedPath: string | null) => void;
}

export class DriverBrowserToolset extends BetaAbstractBrowserToolset20260801 {
  private readonly driver: BrowserDriver & DriverExtras;
  private readonly allowedOrigins: string[];
  private readonly onShot?: (p: string | null) => void;

  constructor(driver: BrowserDriver, opts: DriverBrowserToolsetOptions) {
    super({
      browserState: async () => ({
        tabs: (await driver.tabs()).map((t) => ({ tab_id: t.tab_id, title: t.title, url: t.url, active: t.active })),
      }),
      urlPolicy: async (_ctx, url) => {
        let base: string | null = null;
        try {
          const cur = await driver.currentUrl();
          base = isLocalUrl(cur) ? cur : null;
        } catch {
          base = null;
        }
        try {
          checkUrl(url, { base: base ?? opts.allowedOrigins[0] ?? null, allowedOrigins: opts.allowedOrigins });
        } catch (e) {
          throw new ToolError(e instanceof UrlRefusedError ? e.message : `Navigation refused: ${String(e)}`);
        }
      },
      configs: {
        javascript_exec: { enabled: false },
        file_upload: { enabled: false },
        read_console: { enabled: false },
        read_network: { enabled: false },
      },
    });
    this.driver = driver as BrowserDriver & DriverExtras;
    this.allowedOrigins = opts.allowedOrigins;
    this.onShot = opts.onScreenshot;
  }

  protected override async navigate(_ctx: Ctx, input: BetaBrowserNavigateInput): Promise<BetaBrowserNavigateResult> {
    const line = await this.driver.navigate(input.url, tab(input.tab_id));
    const tabs = await this.driver.tabs();
    const active = tabs.find((t) => (input.tab_id ? t.tab_id === input.tab_id : t.active)) ?? tabs[0];
    const status = /\(HTTP (\d{3})\)/.exec(line)?.[1];
    return { url: active?.url ?? "", title: active?.title, status: status ? Number(status) : undefined };
  }

  protected override async screenshot(_ctx: Ctx, input: BetaBrowserScreenshotInput): Promise<BetaScreenshotResult> {
    const { png, savedPath } = await this.driver.screenshot(tab(input.tab_id));
    this.onShot?.(savedPath);
    return { data: png.toString("base64"), mediaType: "image/png" };
  }

  protected override async left_click(_ctx: Ctx, input: BetaBrowserLeftClickInput): Promise<string> {
    return this.driver.click(toTarget(input.target), tab(input.tab_id));
  }

  protected override async double_click(_ctx: Ctx, input: BetaBrowserDoubleClickInput): Promise<string> {
    await this.driver.click(toTarget(input.target), tab(input.tab_id));
    return this.driver.click(toTarget(input.target), tab(input.tab_id));
  }

  protected override async triple_click(_ctx: Ctx, input: BetaBrowserTripleClickInput): Promise<string> {
    // Usually "select all text in a field": click the target, then select its contents.
    await this.driver.click(toTarget(input.target), tab(input.tab_id));
    return this.driver.key("ctrl+a", tab(input.tab_id));
  }

  protected override async hover(_ctx: Ctx, input: BetaBrowserHoverInput): Promise<string> {
    if (!this.driver.hover) throw new ToolError("hover is not supported by this browser driver");
    return this.driver.hover(toTarget(input.target), tab(input.tab_id));
  }

  protected override async scroll(_ctx: Ctx, input: BetaBrowserScrollInput): Promise<string> {
    return this.driver.scroll(toTarget(input.target), input.scroll_direction, input.scroll_amount ?? undefined, tab(input.tab_id));
  }

  protected override async scroll_to(_ctx: Ctx, input: BetaBrowserScrollToInput): Promise<string> {
    if (this.driver.scrollTo) return this.driver.scrollTo(input.target.ref, tab(input.tab_id));
    return this.driver.scroll(toTarget(input.target), "down", 1, tab(input.tab_id));
  }

  protected override async type_(_ctx: Ctx, input: BetaBrowserTypeInput): Promise<string> {
    return this.driver.type(input.text, tab(input.tab_id));
  }

  protected override async key(_ctx: Ctx, input: BetaBrowserKeyInput): Promise<string> {
    const n = Math.max(1, Math.min(20, input.repeat ?? 1));
    let last = "";
    for (let i = 0; i < n; i++) last = await this.driver.key(input.text, tab(input.tab_id));
    return last;
  }

  protected override async form_input(_ctx: Ctx, input: BetaBrowserFormInputInput): Promise<string> {
    return this.driver.formInput(input.target.ref, input.value, tab(input.tab_id));
  }

  protected override async read_page(_ctx: Ctx, input: BetaBrowserReadPageInput): Promise<string> {
    return this.driver.readPage({
      filter: input.filter ?? undefined,
      depth: input.depth ?? undefined,
      ref: input.ref ?? undefined,
      tabId: tab(input.tab_id),
    });
  }

  protected override async find(_ctx: Ctx, input: BetaBrowserFindInput): Promise<string> {
    const refs = await this.driver.find(input.query, tab(input.tab_id));
    if (refs.length === 0) return `No elements matched "${input.query}".`;
    return refs.map((r) => `- ${r.role} ${JSON.stringify(r.name)} [ref=${r.ref}]`).join("\n");
  }

  protected override async get_page_text(_ctx: Ctx, input: BetaBrowserGetPageTextInput): Promise<string> {
    return (await this.driver.getPageText(tab(input.tab_id))) || "(page has no text)";
  }

  protected override async wait(_ctx: Ctx, input: BetaBrowserWaitInput): Promise<string> {
    await this.driver.wait(input.duration);
    return "";
  }

  protected override async list_tabs(_ctx: Ctx, _input: BetaBrowserListTabsInput): Promise<BetaBrowserStateTabEntry[]> {
    return (await this.driver.tabs()).map((t) => ({ tab_id: t.tab_id, title: t.title, url: t.url, active: t.active }));
  }

  get origins(): string[] {
    return [...this.allowedOrigins];
  }
}
