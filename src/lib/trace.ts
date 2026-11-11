/** Append-only JSONL tracing. Every agent/learn/demo step writes one TraceEvent. */
import fs from "node:fs";
import path from "node:path";
import { TraceEventSchema, type TraceEvent } from "@/contracts";
import { P } from "./paths";

export function trace(ev: Omit<TraceEvent, "ts"> & { ts?: string }, file: string = P.agentTrace): TraceEvent {
  const full = TraceEventSchema.parse({ ts: new Date().toISOString(), ...ev });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(full) + "\n");
  return full;
}
