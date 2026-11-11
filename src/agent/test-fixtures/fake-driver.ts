/**
 * TEST FAKE BrowserDriver (no browser). Records calls; serves a tiny scripted page model so the
 * toolset mapping, the browser loop and the scripted evidence path can be unit-tested offline.
 */
import type { BrowserDriver, BrowserTab, BrowserTarget, PageRef } from "@/contracts";
import { checkUrl } from "@/agent/browser/url-policy";

export class FakeDriver implements BrowserDriver {
  calls: Array<[string, ...unknown[]]> = [];
  url = "about:blank";
  /** path → readPage outline. */
  pages: Record<string, string> = {};
  shots = 0;

  constructor(public origin: string) {}

  async navigate(url: string): Promise<string> {
    const abs = checkUrl(url, { base: this.url.startsWith("http") ? this.url : this.origin, allowedOrigins: [this.origin] });
    this.calls.push(["navigate", abs]);
    this.url = abs;
    return `Navigated to ${abs} — Fake (HTTP 200)`;
  }
  async screenshot(): Promise<{ png: Buffer; savedPath: string | null }> {
    this.calls.push(["screenshot"]);
    this.shots++;
    return { png: Buffer.from("PNGDATA"), savedPath: `runs/TEST/screenshots/${String(this.shots).padStart(3, "0")}.png` };
  }
  async click(target: BrowserTarget): Promise<string> {
    this.calls.push(["click", target]);
    if (target.type === "ref" && target.ref === "ref_404") throw new Error("Unknown ref ref_404 on this tab; call read_page or find again.");
    return "";
  }
  async type(text: string): Promise<string> {
    this.calls.push(["type", text]);
    return "";
  }
  async key(keys: string): Promise<string> {
    this.calls.push(["key", keys]);
    return "";
  }
  async formInput(ref: string, value: string | number | boolean): Promise<string> {
    this.calls.push(["formInput", ref, value]);
    return "";
  }
  async scroll(target: BrowserTarget, direction: string): Promise<string> {
    this.calls.push(["scroll", target, direction]);
    return "";
  }
  async readPage(): Promise<string> {
    this.calls.push(["readPage"]);
    const path = this.url.startsWith("http") ? new URL(this.url).pathname + new URL(this.url).search : "";
    return (
      this.pages[path] ??
      ['Page: Fake', '- textbox "Username" [ref=ref_1] [name=username] [value=""]', '- textbox (password) "Password" [ref=ref_2] [name=password] [value=(empty)]', '- button "Sign in" [ref=ref_3]'].join("\n")
    );
  }
  async find(query: string): Promise<PageRef[]> {
    this.calls.push(["find", query]);
    return [{ ref: "ref_3", role: "button", name: "Sign in" }];
  }
  async getPageText(): Promise<string> {
    this.calls.push(["getPageText"]);
    return "Fake page text";
  }
  async wait(): Promise<void> {}
  async tabs(): Promise<BrowserTab[]> {
    return [{ tab_id: "tab_1", title: "Fake", url: this.url, active: true }];
  }
  async currentUrl(): Promise<string> {
    return this.url;
  }
  async close(): Promise<void> {
    this.calls.push(["close"]);
  }
}
