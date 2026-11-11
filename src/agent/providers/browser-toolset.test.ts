import { describe, expect, it } from "vitest";
import type { BetaToolUseBlock } from "@anthropic-ai/sdk/resources/beta";
import { DriverBrowserToolset } from "./browser-toolset";
import { FakeDriver } from "@/agent/test-fixtures/fake-driver";

const use = (name: string, input: Record<string, unknown>, id = `tu_${name}`): BetaToolUseBlock =>
  ({ type: "tool_use", id, name, input, toolset_name: "browser" }) as BetaToolUseBlock;

type Block = { type: string; text?: string; source?: { type: string; media_type: string; data: string }; tabs?: unknown[] };
const blocks = (content: unknown): Block[] => (typeof content === "string" ? [{ type: "text", text: content }] : (content as Block[]));
const texts = (content: unknown) => blocks(content).filter((b) => b.type === "text").map((b) => b.text).join("\n");

describe("DriverBrowserToolset (SDK helper over a fake BrowserDriver)", () => {
  const origin = "http://localhost:3000";

  it("declares the toolset with unsafe members disabled", () => {
    const ts = new DriverBrowserToolset(new FakeDriver(origin), { allowedOrigins: [origin] });
    const json = ts.toJSON();
    expect(json.type).toBe("browser_toolset_20260801");
    const cfg = json.configs as Record<string, { enabled?: boolean }>;
    for (const m of ["javascript_exec", "file_upload", "read_console", "read_network", "new_tab", "zoom"]) {
      expect(cfg[m]?.enabled).toBe(false);
    }
    expect(cfg.navigate?.enabled).not.toBe(false);
  });

  it("navigate: echoes toolset_name, reports the landing URL, appends browser_state", async () => {
    const d = new FakeDriver(origin);
    const ts = new DriverBrowserToolset(d, { allowedOrigins: [origin] });
    const r = await ts.toolResult(use("navigate", { url: `${origin}/portal/login` }));
    expect(r.toolset_name).toBe("browser");
    expect(r.tool_use_id).toBe("tu_navigate");
    expect(r.is_error).toBeFalsy();
    expect(texts(r.content)).toContain(`${origin}/portal/login`);
    expect(blocks(r.content).some((b) => b.type === "browser_state")).toBe(true);
    expect(d.calls).toContainEqual(["navigate", `${origin}/portal/login`]);
  });

  it("navigate: urlPolicy refuses external URLs with is_error and never reaches the driver", async () => {
    const d = new FakeDriver(origin);
    const ts = new DriverBrowserToolset(d, { allowedOrigins: [origin] });
    const r = await ts.toolResult(use("navigate", { url: "https://example.com/steal" }));
    expect(r.is_error).toBe(true);
    expect(r.toolset_name).toBe("browser");
    expect(texts(r.content)).toMatch(/not localhost|refused/i);
    expect(d.calls.find((c) => c[0] === "navigate")).toBeUndefined();
  });

  it("screenshot: returns an image block (base64 png)", async () => {
    const ts = new DriverBrowserToolset(new FakeDriver(origin), { allowedOrigins: [origin] });
    const r = await ts.toolResult(use("screenshot", {}));
    const img = blocks(r.content).find((b) => b.type === "image");
    expect(img?.source?.type).toBe("base64");
    expect(img?.source?.media_type).toBe("image/png");
    expect(img?.source?.data).toBe(Buffer.from("PNGDATA").toString("base64"));
  });

  it("left_click / form_input / read_page / find map onto the driver", async () => {
    const d = new FakeDriver(origin);
    const ts = new DriverBrowserToolset(d, { allowedOrigins: [origin] });
    const click = await ts.toolResult(use("left_click", { target: { type: "ref", ref: "ref_2" } }));
    expect(click.is_error).toBeFalsy();
    expect(texts(click.content)).toMatch(/Clicked/);
    await ts.toolResult(use("form_input", { target: { type: "ref", ref: "ref_1" }, value: "ap.reviewer" }));
    expect(d.calls).toContainEqual(["formInput", "ref_1", "ap.reviewer"]);
    const page = await ts.toolResult(use("read_page", { filter: "interactive" }));
    expect(texts(page.content)).toContain("[ref=ref_1]");
    const found = await ts.toolResult(use("find", { query: "sign in" }));
    expect(texts(found.content)).toContain('button "Sign in" [ref=ref_3]');
  });

  it("driver errors become is_error results; disabled members are refused", async () => {
    const d = new FakeDriver(origin);
    const ts = new DriverBrowserToolset(d, { allowedOrigins: [origin] });
    const bad = await ts.toolResult(use("left_click", { target: { type: "ref", ref: "ref_404" } }));
    expect(bad.is_error).toBe(true);
    expect(texts(bad.content)).toContain("Unknown ref ref_404");
    const js = await ts.toolResult(use("javascript_exec", { code: "alert(1)" }));
    expect(js.is_error).toBe(true);
    expect(d.calls.some((c) => c[0] === "javascript_exec")).toBe(false);
  });
});
