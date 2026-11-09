import { describe, expect, it } from "vitest";
import type { Recording } from "@/contracts";
import {
  appFromTitle,
  extractOpenQuestions,
  extractProofSources,
  extractRules,
  fieldsFromSelector,
  locationTemplate,
  sentences,
} from "./deterministic";

describe("generic deterministic helpers", () => {
  it("templates URLs", () => {
    expect(locationTemplate("http://localhost:3000/portal/employees/E-101?week=2026-10-11")).toBe(
      "/portal/employees/<employee_id>?week=<YYYY-MM-DD>",
    );
    expect(locationTemplate("http://localhost:3000/portal/invoices/HSG-1010")).toBe("/portal/invoices/<invoice_id>");
    expect(locationTemplate("http://localhost:3000/shop/categories/c9?sort=asc")).toBe("/shop/categories/<category_id>?sort=<sort>");
  });

  it("reads app names, fields and sentences", () => {
    expect(appFromTitle("Invoices · Fixture vendor portal", undefined)).toBe("Fixture vendor portal");
    expect(appFromTitle(undefined, "http://localhost:3000/x")).toBe("localhost:3000");
    expect(fieldsFromSelector('[data-field="approved_hours"]')).toEqual(["approved_hours"]);
    expect(fieldsFromSelector("input[name=username]")).toEqual(["username"]);
    expect(sentences("Total is 12,449.00. Rate is 1.5 times. Ok?")).toEqual(["Total is 12,449.00.", "Rate is 1.5 times.", "Ok?"]);
  });

  it("works on a non-invoice recording", () => {
    const rec: Recording = {
      session_id: "s",
      started_at: "2026-01-01T00:00:00Z",
      transcript: [],
      steps: [
        { ts: "1", kind: "dom", detail: { event: "input", url: "http://localhost/login", selector: "input[name=password]", value: "[redacted]" } },
        { ts: "2", kind: "dom", detail: { event: "click", url: "http://localhost/orders/O-9", title: "Order · Shop admin", selector: '[data-field="status"]' } },
        { ts: "3", kind: "narration", detail: { text: "Rule one: shipped orders must have a tracking number. This one does." } },
        { ts: "4", kind: "narration", detail: { text: "Should refunds over 500 need a manager?" } },
      ],
    };
    expect(extractProofSources(rec)).toEqual([{ app: "Shop admin", location: "/orders/<order_id>", fields: ["status"] }]);
    expect(extractRules(rec)).toEqual(["Shipped orders must have a tracking number."]);
    expect(extractOpenQuestions(rec)).toEqual(["Should refunds over 500 need a manager?"]);
  });
});
