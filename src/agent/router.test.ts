import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RouteDecisionSchema, SkillVersionSchema, type SkillVersion } from "@/contracts";
import {
  builtinCatalogEntry,
  catalogEntryForSkill,
  routeInvoice,
  routerModel,
  scoreCandidate,
  skillDescription,
  summarizeInvoice,
  vendorSimilarity,
  type CatalogEntry,
  type RouterClient,
} from "./router";
import { readSpansFile, SpanRecorder } from "./spans";
import { loadInvoice } from "@/lib/data";

const FORBIDDEN = /simulat|deterministic|fallback/i;

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "router-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.RAMP_TEACH_ROUTER;
  delete process.env.RAMP_TEACH_ROUTER_MODEL;
});

const skill = (over: Partial<SkillVersion> = {}): SkillVersion =>
  SkillVersionSchema.parse({
    skill_id: "halcyon-invoice-review",
    version: 3,
    title: "Halcyon invoice review",
    created_at: "2026-11-11T00:00:00Z",
    mode: "real",
    recordings: ["rec_1"],
    vendor: "Halcyon Staffing Group",
    rules: [{ id: "r1", text: "Billed hours must not exceed approved timecard hours.", kind: "check", source: "said", citations: [] }],
    portal_map: [{ page: "/portal/employees/<employee_id>?week=<YYYY-MM-DD>", fields: [{ name: "approved_hours", selector: "[data-field=approved_hours]" }] }],
    open_questions: [],
    checks: [],
    stages: [],
    package_dir: "skills/halcyon-invoice-review/v3",
    anthropic_skill: null,
    status: "active",
    eval_run_id: null,
    ...over,
  });

const office: CatalogEntry = {
  workflow_id: "brightline-supplies",
  version: 1,
  title: "Office supplies check",
  vendor: "Brightline Office Supply",
  description: "Checks office supply invoices against the catalog price list.",
  rules: ["Unit prices must match the price list."],
  source: "skills/brightline-supplies/v1/skill.json",
};

/** Fake client: returns one parsed response and records the request. */
function fakeClient(parsed: unknown, extra: Record<string, unknown> = {}) {
  const requests: Array<Record<string, unknown>> = [];
  const client: RouterClient = {
    beta: {
      messages: {
        async parse(params) {
          requests.push(params);
          return {
            stop_reason: "end_turn",
            parsed_output: parsed,
            model: "claude-opus-5-5",
            id: "msg_route",
            _request_id: "req_route",
            usage: { input_tokens: 1200, output_tokens: 150, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
            ...extra,
          };
        },
      },
    },
  };
  return { client, requests };
}

describe("router: plain-code path", () => {
  it("routes the Halcyon invoice to invoice-review (rules/workflow_spec.json) when no skill is active", async () => {
    const out = path.join(tmp, "route.json");
    const d = await routeInvoice("HSG-1011", { offline: true, catalog: [builtinCatalogEntry()], outFile: out });
    expect(d).toMatchObject({ invoice_id: "HSG-1011", workflow_id: "invoice-review", version: null, mode: "deterministic", model: null, request_id: null });
    expect(d.confidence).toBeGreaterThanOrEqual(0.9);
    expect(d.reason).toBe(
      "Matches Halcyon Staffing service invoice review (rules from rules/workflow_spec.json): same vendor, labor lines by employee and week.",
    );
    expect(d.reason).not.toMatch(FORBIDDEN);
    expect(RouteDecisionSchema.parse(JSON.parse(fs.readFileSync(out, "utf8")))).toEqual(d);
  });

  it("sends the office-supply invoice to manual review (no workflow fits)", async () => {
    const d = await routeInvoice("OFS-2201", { offline: true, catalog: [builtinCatalogEntry()], outFile: false });
    expect(d.workflow_id).toBeNull();
    expect(d.version).toBeNull();
    expect(d.mode).toBe("deterministic");
    expect(d.reason).toContain("Brightline Office Supply");
    expect(d.reason).toContain("manual review");
    expect(d.reason).not.toMatch(FORBIDDEN);
    expect(d.candidates).toHaveLength(1);
    expect(d.candidates[0].score).toBeLessThan(0.6);
    expect(d.confidence).toBeGreaterThan(0.9);
  });

  it("prefers the matching skill among several and scores every candidate", async () => {
    const cat = [catalogEntryForSkill(skill(), tmp), office];
    const hsg = await routeInvoice("HSG-1012", { offline: true, catalog: cat, outFile: false });
    expect(hsg).toMatchObject({ workflow_id: "halcyon-invoice-review", version: 3 });
    expect(hsg.reason).toBe("Matches Halcyon invoice review v3: same vendor, labor lines by employee and week.");
    expect(hsg.candidates.map((c) => c.workflow_id)).toEqual(["halcyon-invoice-review", "brightline-supplies"]);
    const ofs = await routeInvoice("OFS-2201", { offline: true, catalog: cat, outFile: false });
    expect(ofs).toMatchObject({ workflow_id: "brightline-supplies", version: 1 });
  });

  it("vendor similarity and scoring", () => {
    expect(vendorSimilarity("Halcyon Staffing Group", "halcyon staffing")).toBe(1);
    expect(vendorSimilarity("Halcyon Staffing Group", "Brightline Office Supply")).toBe(0);
    const s = scoreCandidate(summarizeInvoice(loadInvoice("OFS-2201")!), builtinCatalogEntry());
    expect(s.score).toBeLessThan(0.1);
    expect(s.why).toContain("different vendor");
  });

  it("RAMP_TEACH_ROUTER=deterministic forces the plain-code path even with a client", async () => {
    process.env.RAMP_TEACH_ROUTER = "deterministic";
    const { client, requests } = fakeClient({ workflow_id: "none", confidence: 1, reason: "x", candidates: [] });
    const d = await routeInvoice("HSG-1011", { client, catalog: [builtinCatalogEntry()], outFile: false });
    expect(requests).toHaveLength(0);
    expect(d).toMatchObject({ mode: "deterministic", model: null, workflow_id: "invoice-review" });
    expect(d.reason).not.toMatch(FORBIDDEN);
  });
});

describe("router: real path (fake client)", () => {
  it("sends one structured-output call at low effort with refusal fallback, and records a model span", async () => {
    const { client, requests } = fakeClient({
      workflow_id: "halcyon-invoice-review",
      confidence: 0.97,
      reason: "Same vendor and the same weekly staffing invoice.",
      candidates: [{ workflow_id: "halcyon-invoice-review", score: 0.97, why: "same vendor" }],
    });
    const rec = new SpanRecorder({ invoiceId: "HSG-1011", traceId: "run-1", file: path.join(tmp, "spans.jsonl") });
    rec.reset();
    const traces: string[] = [];
    const d = await routeInvoice("HSG-1011", {
      client,
      catalog: [catalogEntryForSkill(skill(), tmp), office],
      outFile: false,
      spans: { recorder: rec, parentId: "sp_root" },
      trace: (step) => traces.push(step),
    });
    expect(d).toMatchObject({
      workflow_id: "halcyon-invoice-review",
      version: 3,
      confidence: 0.97,
      mode: "real",
      model: "claude-opus-5-5",
      request_id: "req_route",
    });
    // Every catalog entry is scored; one the model skipped gets 0.
    expect(d.candidates).toEqual([
      { workflow_id: "halcyon-invoice-review", score: 0.97, why: "same vendor" },
      { workflow_id: "brightline-supplies", score: 0, why: "not scored" },
    ]);
    const req = requests[0];
    expect(req.model).toBe("claude-opus-5-5");
    expect(req.thinking).toEqual({ type: "adaptive" });
    expect((req.output_config as { effort: string; format: { type: string } }).effort).toBe("low");
    expect((req.output_config as { format: { type: string } }).format.type).toBe("json_schema");
    expect(req.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(req.fallbacks).toBe("default");
    expect(req).not.toHaveProperty("tool_choice");
    expect(String((req.messages as Array<{ content: string }>)[0].content)).toContain("Brightline Office Supply");
    expect(traces).toEqual(["route.start", "route.decided"]);

    const spans = readSpansFile(path.join(tmp, "spans.jsonl"));
    const route = spans.find((s) => s.name === "route")!;
    const model = spans.find((s) => s.name === "route.model")!;
    expect(route).toMatchObject({ parent_id: "sp_root", trace_id: "run-1", kind: "run", mode: "real" });
    expect(model).toMatchObject({ parent_id: route.span_id, kind: "model", mode: "real" });
    expect(model.attrs).toMatchObject({ model: "claude-opus-5-5", request_id: "req_route", message_id: "msg_route", input_tokens: 1200, output_tokens: 150 });
    expect(model.attrs.cost_usd).toBeCloseTo((1200 * 4 + 150 * 20) / 1e6, 9);
  });

  it("maps 'none' to manual review, and uses RAMP_TEACH_ROUTER_MODEL", async () => {
    process.env.RAMP_TEACH_ROUTER_MODEL = "claude-sonnet-5-5";
    expect(routerModel()).toBe("claude-sonnet-5-5");
    const { client, requests } = fakeClient({ workflow_id: "none", confidence: 0.9, reason: "Office supplies; no workflow covers this vendor.", candidates: [] });
    const d = await routeInvoice("OFS-2201", { client, catalog: [builtinCatalogEntry()], outFile: false });
    expect(requests[0].model).toBe("claude-sonnet-5-5");
    expect(d).toMatchObject({ workflow_id: null, version: null, mode: "real" });
  });

  it("an unknown workflow id or a refusal falls back to the plain-code decision (mode deterministic, traced)", async () => {
    const traces: Array<[string, Record<string, unknown>]> = [];
    const bad = fakeClient({ workflow_id: "made-up", confidence: 1, reason: "x", candidates: [] });
    const d = await routeInvoice("HSG-1011", { client: bad.client, catalog: [builtinCatalogEntry()], outFile: false, trace: (s, _m, det) => traces.push([s, det]) });
    expect(d).toMatchObject({ mode: "deterministic", workflow_id: "invoice-review", model: null });
    expect(traces.find(([s]) => s === "route.real_failed")?.[1].error).toContain("made-up");

    const refused = fakeClient(null, { stop_reason: "refusal", stop_details: { category: "cyber" } });
    const r = await routeInvoice("OFS-2201", { client: refused.client, catalog: [builtinCatalogEntry()], outFile: false });
    expect(r).toMatchObject({ mode: "deterministic", workflow_id: null });
  });
});

describe("router: catalog", () => {
  it("reads the description from the skill package's SKILL.md frontmatter", () => {
    expect(skillDescription("---\nname: x\ndescription: Reviews Halcyon invoices.\n---\n# body")).toBe("Reviews Halcyon invoices.");
    expect(skillDescription("---\ndescription: >\n  Folded\n  text\nname: y\n---")).toBe("Folded text");
    expect(skillDescription("# no frontmatter")).toBeNull();
    const dir = path.join(tmp, "skills/halcyon-invoice-review/v3");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), '---\nname: halcyon-invoice-review\ndescription: "Weekly staffing invoices from Halcyon."\n---\n');
    const e = catalogEntryForSkill(skill(), tmp);
    expect(e).toMatchObject({ workflow_id: "halcyon-invoice-review", version: 3, vendor: "Halcyon Staffing Group", description: "Weekly staffing invoices from Halcyon." });
    expect(e.rules).toEqual(["Billed hours must not exceed approved timecard hours."]);
  });

  it("the built-in entry covers the contract vendor with the spec's rules", () => {
    const b = builtinCatalogEntry();
    expect(b).toMatchObject({ workflow_id: "invoice-review", version: null, vendor: "Halcyon Staffing Group", source: "rules/workflow_spec.json" });
    expect(b.rules.length).toBeGreaterThan(0);
  });
});
