import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listEvalCases } from "@/lib/pillars";
import { ROOT } from "@/lib/paths";
import { loadCaseRecording, loadEvalCaseFiles, sampleCases } from "./cases";
import { checksOf } from "./concepts";
import { observedInRecording } from "./coverage";
import { normalizeField, normalizePage } from "./text";

const cases = loadEvalCaseFiles();

describe("committed eval cases (C1)", () => {
  it("has 8 cases covering every planned variant, readable through lib/pillars too", () => {
    expect(cases.map((c) => c.variant).sort()).toEqual(
      [
        "baseline",
        "consistency-paraphrase",
        "filler-talk",
        "reordered",
        "said-not-shown",
        "shown-not-said",
        "step-skipped",
        "stt-noise",
      ].sort(),
    );
    expect(listEvalCases()).toHaveLength(cases.length);
  });

  it("marks every case and recording as a hand-authored variant of the primary capture", () => {
    for (const c of cases) {
      expect(c.provenance.kind).toBe("hand_authored_variant");
      expect(c.provenance.derived_from).toBe("extension/recordings/portal-HSG-1010.json");
      const raw = JSON.parse(fs.readFileSync(path.join(ROOT, c.recording_path), "utf8"));
      expect(raw.provenance.capture).toBe("hand_authored_fixture");
    }
  });

  it("every recording parses, has word-timed scripted speech that matches its transcript", () => {
    for (const c of cases) {
      const rec = loadCaseRecording(c);
      expect(rec.speech?.provider).toBe("simulated");
      expect(rec.speech?.mode).toBe("scripted");
      const narr = rec.steps.filter((s) => s.kind === "narration").map((s) => s.detail.text);
      expect(rec.transcript).toEqual(narr);
      expect(rec.speech!.utterances.map((u) => u.text)).toEqual(rec.transcript);
      for (const u of rec.speech!.utterances) {
        expect(u.words.map((w) => w.text).join(" ")).toBe(u.text);
        for (let i = 1; i < u.words.length; i++) expect(u.words[i].start).toBeGreaterThan(u.words[i - 1].start);
        for (const r of u.step_refs) expect(rec.steps[r].kind).toBe("dom");
      }
      expect(c.reference_transcript).toBeTruthy();
    }
  });

  it("gold pages and fields equal what each recording visits and clicks", () => {
    for (const c of cases) {
      const obs = observedInRecording(loadCaseRecording(c));
      expect(new Set(obs.pages), c.id).toEqual(new Set(c.gold.pages.map(normalizePage)));
      expect(new Set(obs.fields), c.id).toEqual(new Set(c.gold.fields.map(normalizeField)));
    }
  });

  it("gold_checks agree with the gold rule texts (keyword mapping)", () => {
    for (const c of cases) {
      expect(c.gold.rules.map((r) => checksOf(r))).toEqual(c.gold_checks.map((x) => [x]));
      expect(checksOf(c.gold.decision_rule)).toEqual([]);
    }
  });

  it("variant gold differs where the recording does", () => {
    const by = Object.fromEntries(cases.map((c) => [c.id, c]));
    expect(by["step-skipped"].gold_checks).not.toContain("line_amounts_correct");
    expect(by["step-skipped"].gold_checks).not.toContain("total_matches_line_items");
    expect(by["said-not-shown"].gold.pages.some((p) => p.includes("employees"))).toBe(false);
    expect(by["said-not-shown"].gold_checks).toContain("hours_match_timecards");
    // shown-not-said: the hours rule is gold, yet no narration states the cap
    const sns = loadCaseRecording(by["shown-not-said"]);
    expect(sns.transcript.join(" ")).not.toMatch(/exceed|approved hours|billed hours/i);
    expect(by["shown-not-said"].gold_checks).toContain("hours_match_timecards");
    // stt-noise: planted errors are in the speech, not in the reference
    const noisy = loadCaseRecording(by["stt-noise"]);
    expect(noisy.transcript.join(" ")).toContain("for tea");
    expect(by["stt-noise"].reference_transcript).not.toContain("for tea");
    expect(by["baseline"].consistency_group).toBe(by["paraphrase"].consistency_group);
  });

  it("sampling is deterministic, starts at baseline and keeps consistency pairs together", () => {
    const s = sampleCases(cases, 1);
    expect(s.map((c) => c.id).sort()).toEqual(["baseline", "paraphrase"]);
    expect(sampleCases(cases, 3).map((c) => c.id)).toEqual(sampleCases(cases, 3).map((c) => c.id));
    expect(sampleCases(cases, null)).toHaveLength(cases.length);
  });

  it("committed files are exactly what evals/tools/build-recordings.ts builds", () => {
    const out = execFileSync("npx", ["tsx", "evals/tools/build-recordings.ts", "--check"], { cwd: ROOT, encoding: "utf8" });
    expect(out).not.toContain("differs");
  }, 60_000);

  it("no eval code reads the answer key", () => {
    const files = [
      ...fs.readdirSync(path.join(ROOT, "lib", "evals")).map((f) => path.join("lib", "evals", f)),
      "evals/cli.ts",
      "evals/learner.ts",
      "evals/tools/build-recordings.ts",
    ].filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    for (const f of files) expect(fs.readFileSync(path.join(ROOT, f), "utf8"), f).not.toMatch(/P\.answerKey|AnswerKeySchema|answer_key\.json["'`]/);
  });
});
