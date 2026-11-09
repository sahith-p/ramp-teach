/** receipts/decisions.jsonl — append-only log of human decisions (written by the decision API only). */
import fs from "node:fs";
import { DecisionRecordSchema, type DecisionRecord } from "@/contracts";
import { P } from "../paths";

export function appendDecision(rec: DecisionRecord): DecisionRecord {
  const parsed = DecisionRecordSchema.parse(rec);
  fs.mkdirSync(P.receipts, { recursive: true });
  fs.appendFileSync(P.decisions, JSON.stringify(parsed) + "\n");
  return parsed;
}

export function readDecisions(): DecisionRecord[] {
  if (!fs.existsSync(P.decisions)) return [];
  return fs
    .readFileSync(P.decisions, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => DecisionRecordSchema.parse(JSON.parse(l)));
}
