import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LiveStatusWriter, startLiveView } from "./live";
import { PlaywrightDriver } from "./browser/playwright-driver";
import { startPortalStub } from "@/agent/test-fixtures/portal-stub";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "live-"));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const status = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, "status.json"), "utf8"));

describe("LiveStatusWriter", () => {
  it("writes status.json, throttles frames to the fps, and marks the run finished", () => {
    let now = 1_000_000;
    const dir = path.join(tmp, "live");
    const w = new LiveStatusWriter(dir, { fps: 5, now: () => now });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "frame.jpg"), "old frame of a previous run");
    w.begin("http://localhost:3000/portal/login");
    expect(fs.existsSync(path.join(dir, "frame.jpg"))).toBe(false);
    expect(status(dir)).toMatchObject({ running: true, url: "http://localhost:3000/portal/login", step: 0 });

    expect(w.frame(Buffer.from("F1"), "http://localhost:3000/portal/invoices")).toBe(true);
    now += 100; // < 200 ms at 5 fps
    expect(w.frame(Buffer.from("F2"))).toBe(false);
    now += 150;
    expect(w.frame(Buffer.from("F3"))).toBe(true);
    expect(fs.readFileSync(path.join(dir, "frame.jpg"), "utf8")).toBe("F3");
    expect(w.frames).toBe(2);
    expect(status(dir).url).toBe("http://localhost:3000/portal/invoices");

    w.step(4, "http://localhost:3000/portal/employees/E-104?week=2026-10-18");
    expect(status(dir)).toMatchObject({ running: true, step: 4, url: "http://localhost:3000/portal/employees/E-104?week=2026-10-18" });
    w.finish();
    const s = status(dir);
    expect(s).toMatchObject({ running: false, step: 4 });
    expect(Number.isNaN(Date.parse(s.updated_at))).toBe(false);
    expect(fs.readdirSync(dir).sort()).toEqual(["frame.jpg", "status.json"]); // no temp files left
  });

  it("without a screencast-capable driver still writes status and finishes", async () => {
    const w = new LiveStatusWriter(path.join(tmp, "live"));
    const stop = await startLiveView({}, w);
    expect(status(w.dir).running).toBe(true);
    await stop();
    expect(status(w.dir).running).toBe(false);
  });
});

describe("live view over a CDP screencast (Playwright + TEST STUB portal)", () => {
  let stub: Awaited<ReturnType<typeof startPortalStub>>;
  beforeAll(async () => {
    stub = await startPortalStub(0);
  }, 30_000);
  afterAll(async () => {
    await stub?.close();
  });

  it("keeps the latest JPEG frame and the page URL while the browser moves", async () => {
    const driver = new PlaywrightDriver({ allowedOrigins: [stub.url], screenshotDir: null });
    const w = new LiveStatusWriter(path.join(tmp, "live"), { fps: 30 });
    try {
      await driver.navigate(`${stub.url}/portal/login`);
      const stop = await startLiveView(driver, w);
      await driver.navigate(`${stub.url}/portal/login?error=1`);
      for (let i = 0; i < 40 && w.frames === 0; i++) await new Promise((r) => setTimeout(r, 50));
      await stop();
      expect(w.frames).toBeGreaterThan(0);
      const jpg = fs.readFileSync(w.framePath);
      expect(jpg[0]).toBe(0xff); // JPEG SOI marker
      expect(jpg[1]).toBe(0xd8);
      expect(status(w.dir)).toMatchObject({ running: false });
      expect(String(status(w.dir).url)).toContain("/portal/login");
    } finally {
      await driver.close();
    }
  }, 30_000);
});
