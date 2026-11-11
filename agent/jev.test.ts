import { afterEach, describe, expect, it } from "vitest";
import { decisionFromJev, jevRequest, type JevResponse } from "./jev";
import { routeInvoice, routerProvider, type CatalogEntry } from "./router";

const catalog: CatalogEntry[] = [
  {
    workflow_id: "halcyon-invoice-review",
    version: 2,
    title: "Halcyon Staffing invoice review",
    vendor: "Halcyon Staffing",
    description: "Weekly staffing invoices: labor lines by employee and week.",
    rules: ["Billed hours must not exceed approved hours."],
    source: "skills/halcyon-invoice-review/v2/skill.json",
  },
];

const answer = (choice: string, pChoice: number, fit: number): JevResponse => ({
  model: "jev-1.13.0",
  answers: {
    workflow: { type: "choice", choice, confidence: pChoice, probabilities: { "halcyon-invoice-review": choice === "none" ? 1 - pChoice : pChoice, none: choice === "none" ? pChoice : 1 - pChoice } },
    fits: { type: "noul", noul: fit },
  },
  usage: { input_tokens: 310, output_tokens: 20 },
});

function fakeFetch(body: JevResponse, status = 200) {
  const calls: { url: string; init: { headers: Record<string, string>; body: string } }[] = [];
  const f = async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
    calls.push({ url, init });
    return {
      ok: status < 400,
      status,
      headers: { get: (n: string) => (n === "x-request-id" ? "req_jev_123" : null) },
      json: async () => body,
      text: async () => (status < 400 ? "" : "bad request"),
    };
  };
  return { f, calls };
}

afterEach(() => {
  delete process.env.TYPESAFE_API_KEY;
  delete process.env.RAMP_TEACH_ROUTER;
});

describe("Jev routing", () => {
  it("builds a Choice + companion Noul request, with a none option when there is one workflow", () => {
    const inv = { invoice_id: "HSG-1011", vendor: "Halcyon Staffing Group", currency: "USD", total: 15677, line_count: 1, labor_lines: 1, lines: [{ description: "Labor: Maya Chen (Senior Recruiter) - week ending 2026-10-18", quantity: 40, unit_rate: 105, amount: 4200 }] };
    const req = jevRequest(inv, catalog, "jev-latest");
    expect(req.model).toBe("jev-latest");
    expect(req.questions.workflow.type).toBe("choice");
    expect(Object.keys(req.questions.workflow.criteria)).toEqual(["halcyon-invoice-review", "none"]);
    expect(req.questions.fits.type).toBe("noul");
    expect(req.state.workflows[0].id).toBe("halcyon-invoice-review");
  });

  it("routes to the chosen workflow when it fits", () => {
    const d = decisionFromJev("HSG-1011", catalog, { response: answer("halcyon-invoice-review", 0.97, 0.98), request_id: "req_1" });
    expect(d.workflow_id).toBe("halcyon-invoice-review");
    expect(d.version).toBe(2);
    expect(d.mode).toBe("real");
    expect(d.model).toBe("jev-1.13.0");
    expect(d.confidence).toBeCloseTo(0.97);
    expect(d.reason).not.toMatch(/simulat|deterministic|fallback/i);
  });

  it("sends to manual review when nothing fits", () => {
    const d = decisionFromJev("OFS-2201", catalog, { response: answer("halcyon-invoice-review", 0.6, 0.04), request_id: null });
    expect(d.workflow_id).toBeNull();
    expect(d.confidence).toBeCloseTo(0.96);
    expect(d.reason).toMatch(/manual review/);
  });

  it("picks Jev when TYPESAFE_API_KEY is set, the code path when forced", () => {
    process.env.TYPESAFE_API_KEY = "ts_test_key";
    expect(routerProvider()).toBe("jev");
    process.env.RAMP_TEACH_ROUTER = "deterministic";
    expect(routerProvider()).toBe("plain");
  });

  it("routeInvoice calls the System One endpoint with a bearer key and saves the decision", async () => {
    process.env.TYPESAFE_API_KEY = "ts_test_key";
    const { f, calls } = fakeFetch(answer("halcyon-invoice-review", 0.97, 0.98));
    const d = await routeInvoice("HSG-1011", { catalog, outFile: false, jevFetch: f });
    expect(calls[0].url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(calls[0].init.headers.Authorization).toBe("Bearer ts_test_key");
    expect(JSON.parse(calls[0].init.body).questions.fits.type).toBe("noul");
    expect(d.workflow_id).toBe("halcyon-invoice-review");
    expect(d.request_id).toBe("req_jev_123");
  });

  it("falls back to the code path when Jev errors", async () => {
    process.env.TYPESAFE_API_KEY = "ts_test_key";
    const { f } = fakeFetch(answer("x", 0, 0), 400);
    const d = await routeInvoice("HSG-1011", { catalog, outFile: false, jevFetch: f });
    expect(d.mode).toBe("deterministic");
  });
});
