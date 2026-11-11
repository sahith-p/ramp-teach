import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PlaywrightDriver, toPlaywrightKeys } from "./playwright-driver";
import { checkUrl, fixturePointerFor, isLocalUrl, UrlRefusedError } from "./url-policy";
import { parseDataFields } from "./outline";
import { startPortalStub } from "@/agent/test-fixtures/portal-stub";

describe("url policy (pure)", () => {
  it("allows only localhost / 127.0.0.1 http(s)", () => {
    expect(isLocalUrl("http://localhost:3000/portal/login")).toBe(true);
    expect(isLocalUrl("http://127.0.0.1:3014/x")).toBe(true);
    expect(isLocalUrl("https://example.com/")).toBe(false);
    expect(isLocalUrl("http://localhost.evil.com/")).toBe(false);
    expect(isLocalUrl("file:///etc/passwd")).toBe(false);
    expect(isLocalUrl("javascript:alert(1)")).toBe(false);
  });

  it("refuses external URLs and non-allowed local origins", () => {
    expect(() => checkUrl("https://example.com/")).toThrow(UrlRefusedError);
    expect(() => checkUrl("http://169.254.169.254/latest")).toThrow(UrlRefusedError);
    expect(() => checkUrl("http://localhost:4000/", { allowedOrigins: ["http://localhost:3000"] })).toThrow(/not one of the allowed/);
    expect(() => checkUrl("//example.com/x", { base: "http://localhost:3000/a" })).toThrow(UrlRefusedError);
    expect(checkUrl("/portal/login", { base: "http://localhost:3000/", allowedOrigins: ["http://localhost:3000/"] })).toBe(
      "http://localhost:3000/portal/login",
    );
  });

  it("builds fixture pointers from local URLs only", () => {
    expect(fixturePointerFor("http://localhost:3000/portal/employees/E-103?week=2026-10-18")).toBe(
      "fixture:/portal/employees/E-103?week=2026-10-18",
    );
    expect(fixturePointerFor("https://example.com/portal")).toBeNull();
  });

  it("maps xdotool-style keys", () => {
    expect(toPlaywrightKeys("ctrl+a")).toEqual(["Control+a"]);
    expect(toPlaywrightKeys("Return")).toEqual(["Enter"]);
  });
});

describe("PlaywrightDriver against the TEST STUB portal", () => {
  let stub: Awaited<ReturnType<typeof startPortalStub>>;
  let driver: PlaywrightDriver;

  beforeAll(async () => {
    stub = await startPortalStub(0);
    driver = new PlaywrightDriver({ allowedOrigins: [stub.url], screenshotDir: null });
  }, 30_000);

  afterAll(async () => {
    await driver?.close();
    await stub?.close();
  });

  it("refuses navigation to an external URL without touching the page", async () => {
    await driver.navigate(`${stub.url}/portal/login`);
    await expect(driver.navigate("https://example.com/")).rejects.toThrow(/Navigation refused/);
    expect(await driver.currentUrl()).toBe(`${stub.url}/portal/login`);
  });

  it("aborts sub-resource requests to non-local hosts", async () => {
    await driver.navigate(`${stub.url}/__stub/external-probe`);
    expect(driver.blockedRequests.some((u) => u.startsWith("https://example.com/"))).toBe(true);
  });

  it("logs in via refs, follows to a timecard, and exposes data-field markers", async () => {
    await driver.navigate(`${stub.url}/portal/login`);
    const user = (await driver.find("username"))[0];
    const pass = (await driver.find("password"))[0];
    expect(user && pass).toBeTruthy();
    await driver.formInput(user.ref, "ap.reviewer");
    await driver.formInput(pass.ref, "demo-only");
    const btn = (await driver.find("Sign in")).find((r) => r.role === "button")!;
    await driver.click({ type: "ref", ref: btn.ref });
    expect(await driver.currentUrl()).toBe(`${stub.url}/portal/invoices`);

    await driver.navigate("/portal/invoices/HSG-1011");
    const outline = await driver.readPage({ filter: "interactive" });
    expect(outline).toContain("View timecard");
    expect(outline).toMatch(/\[href=\/portal\/employees\/E-104\?week=2026-10-18\]/);

    await driver.navigate("/portal/employees/E-104?week=2026-10-18");
    const fields = parseDataFields(await driver.readPage({ filter: "all" }));
    expect(fields.employee_id).toBe("E-104");
    expect(fields.week_ending).toBe("2026-10-18");
    expect(Number(fields.approved_hours)).toBeGreaterThan(0);
    expect(fields.status).toBeTruthy();
    await expect(driver.click({ type: "ref", ref: "ref_99999" })).rejects.toThrow(/Unknown ref/);
  }, 30_000);
});
