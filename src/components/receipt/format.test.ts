import { describe, expect, it } from "vitest";
import { CHECK_NAMES } from "@/contracts";
import { CHECK_LABELS, FAILURE_LABELS, failureLabel } from "./format";

describe("failure flag copy (red line-item flags)", () => {
  it("states the failure, never the check name, for every check", () => {
    for (const name of CHECK_NAMES) {
      expect(failureLabel(name)).toBe(FAILURE_LABELS[name]);
      expect(failureLabel(name)).not.toBe(CHECK_LABELS[name]);
    }
    expect(failureLabel("rate_matches_contract")).toBe("Rate mismatch");
    expect(failureLabel("no_duplicate_lines")).toBe("Duplicate line");
    expect(failureLabel("hours_match_timecards")).toBe("Hours not approved");
  });

  it("falls back to an explicit 'Failed:' prefix for unknown names", () => {
    expect(failureLabel("custom_check")).toBe("Failed: custom_check");
  });

  it("uses no em dashes in visible label copy", () => {
    for (const s of [...Object.values(FAILURE_LABELS), ...Object.values(CHECK_LABELS)]) expect(s).not.toContain("—");
  });
});
