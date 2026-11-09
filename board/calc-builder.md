# Outbox — calc-builder (append-only)

[2026-11-09T08:30:46Z] calc-builder | CLAIM | T-11 | Building calc/{parse,checks,index}.ts + calc/calc.test.ts (deterministic, no LLM)
[2026-11-09T08:33:24Z] calc-builder | DONE | T-11 | calc/{parse,checks,index}.ts + calc/calc.test.ts. Evidence: npx tsc --noEmit exit 0; npx vitest run calc -> 1 file, 30/30 passed. runCalc(input, now?) returns 6 checks in CHECK_NAMES order; planted-error-type invoice fails exactly rate/duplicate/hours; timecards null -> hours unverified; all finding evidence passes isValidEvidencePointer; CalcReportSchema.parse OK. No LLM/network/fs; no data/ or answer_key reads. Note: rate check uses the line's stated role (per spec), it does not cross-check against the roster role.
