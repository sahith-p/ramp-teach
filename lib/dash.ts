/**
 * Bill-pay dashboard state (server only): which invoices have "arrived", the agent review job per invoice,
 * the live activity feed (from agent/trace.jsonl) and the status each bill shows.
 *
 * The agent job is the same engine run as `npm run agent -- <id>`, started by the server when an invoice
 * arrives. It only reads and recommends; approve/dispute stays a human click (POST /api/decisions).
 * State files live in runtime/ (gitignored).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { billIdFor, type Bill, type Receipt } from "@/contracts";
import { loadInvoice, loadVendor } from "@/lib/data";
import { P, ROOT } from "@/lib/paths";
import { readBills } from "@/lib/store/bills";
import { readReceipt } from "@/lib/store/receipts";

const INBOX = path.join(P.runtime, "inbox.json");
const JOBS = path.join(P.runtime, "agent-jobs.json");
const JOB_LOGS = path.join(P.runtime, "agent-jobs");

export interface InboxState {
  /** Invoice ids not delivered yet (hidden from the dashboard). Empty / missing file = everything visible. */
  hidden: string[];
  /** When each invoice arrived (ISO). */
  arrived: Record<string, string>;
}

export interface AgentJob {
  status: "running" | "done" | "failed";
  started_at: string;
  finished_at?: string;
  exit_code?: number | null;
  pid?: number;
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(file: string, v: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(v, null, 2) + "\n");
}

export const readInbox = (): InboxState => ({ hidden: [], arrived: {}, ...readJson<Partial<InboxState>>(INBOX, {}) });
export const writeInbox = (s: InboxState) => writeJson(INBOX, s);

function pidAlive(pid?: number): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readJobs(): Record<string, AgentJob> {
  const jobs = readJson<Record<string, AgentJob>>(JOBS, {});
  // A job whose process is gone without reporting (e.g. server restart) is failed, not "running" forever.
  for (const [id, j] of Object.entries(jobs)) {
    if (j.status === "running" && !pidAlive(j.pid)) jobs[id] = { ...j, status: "failed", finished_at: new Date().toISOString() };
  }
  return jobs;
}
const writeJobs = (j: Record<string, AgentJob>) => writeJson(JOBS, j);

/** Demo setup: hide these invoices until delivered, and forget previous jobs. */
export function resetInbox(hidden: string[]) {
  writeInbox({ hidden, arrived: {} });
  writeJobs({});
}

/** Start the agent review for one invoice (no-op if one is already running). */
export function startAgentJob(invoiceId: string, baseUrl: string): AgentJob {
  const jobs = readJobs();
  if (jobs[invoiceId]?.status === "running") return jobs[invoiceId];
  fs.mkdirSync(JOB_LOGS, { recursive: true });
  const log = fs.openSync(path.join(JOB_LOGS, `${invoiceId}.log`), "w");
  const env: NodeJS.ProcessEnv = { ...process.env, BASE_URL: baseUrl };
  // Film capture (demo/video): record the agent's own browser when the server was started with RAMP_TEACH_FILM_DIR.
  if (process.env.RAMP_TEACH_FILM_DIR) env.RAMP_TEACH_RECORD_VIDEO_DIR = path.join(process.env.RAMP_TEACH_FILM_DIR, `agent-${invoiceId}`);
  const child = spawn("npx", ["tsx", "agent/cli.ts", invoiceId, "--base-url", baseUrl, "--quiet"], {
    cwd: ROOT,
    env,
    stdio: ["ignore", log, log],
  });
  const job: AgentJob = { status: "running", started_at: new Date().toISOString(), pid: child.pid };
  writeJobs({ ...jobs, [invoiceId]: job });
  child.on("exit", (code) => {
    const now = readJson<Record<string, AgentJob>>(JOBS, {});
    now[invoiceId] = { ...job, status: code === 0 ? "done" : "failed", finished_at: new Date().toISOString(), exit_code: code };
    writeJobs(now);
    fs.closeSync(log);
  });
  return job;
}

/** An invoice arrives in the inbox: show it and start the agent review. */
export function deliver(invoiceId: string, baseUrl: string): AgentJob {
  const inbox = readInbox();
  inbox.hidden = inbox.hidden.filter((h) => h !== invoiceId);
  inbox.arrived[invoiceId] = new Date().toISOString();
  writeInbox(inbox);
  return startAgentJob(invoiceId, baseUrl);
}

/* ------------------------------ activity feed ------------------------------ */

export interface ActivityStep {
  ts: string;
  text: string;
}

interface TraceLine {
  ts: string;
  run_id: string;
  stage: string;
  step: string;
  detail: Record<string, any>;
}

function traceSince(invoiceId: string, sinceIso: string): TraceLine[] {
  if (!fs.existsSync(P.agentTrace)) return [];
  const prefix = `invoice-review:${invoiceId}:`;
  return fs
    .readFileSync(P.agentTrace, "utf8")
    .split("\n")
    .filter((l) => l.includes(prefix))
    .map((l) => JSON.parse(l) as TraceLine)
    .filter((e) => e.run_id.startsWith(prefix) && e.ts >= sinceIso);
}

/** Plain-language steps of the latest agent run for this invoice, and the URL its browser is on. */
export function activity(invoiceId: string): { steps: ActivityStep[]; url: string | null } {
  const job = readJobs()[invoiceId];
  if (!job) return { steps: [], url: null };
  const names = Object.fromEntries(loadVendor().employees.map((e) => [e.employee_id, e.name]));
  const steps: ActivityStep[] = [];
  const push = (ts: string, text: string) => {
    if (steps[steps.length - 1]?.text !== text && !steps.some((s) => s.text === text)) steps.push({ ts, text });
  };
  let url: string | null = null;
  for (const e of traceSince(invoiceId, job.started_at)) {
    const d = e.detail ?? {};
    switch (e.step) {
      case "calc.initial":
        push(e.ts, "Checked the math and contract rates");
        break;
      case "browser.start":
        push(e.ts, "Opened the vendor portal");
        url = String(d.start_url ?? url);
        break;
      case "browser.action": {
        const tool = String(d.tool ?? "");
        if (tool === "browser.navigate" && typeof d.input?.url === "string") {
          url = d.input.url;
          const m = /\/portal\/employees\/(E-\d+)\?week=/.exec(d.input.url);
          if (m) push(e.ts, `Opened ${names[m[1]] ?? m[1]}'s timecard`);
          else if (/\/portal\/invoices\/[^/?]+$/.test(d.input.url)) push(e.ts, `Opened invoice ${d.input.url.split("/").pop()}`);
        } else if (tool === "browser.form_input" || tool === "browser.left_click") push(e.ts, "Signed in");
        break;
      }
      case "browser.result": {
        const page = (d.content as string[] | undefined)?.find((c) => c.startsWith("Page is now "));
        if (page) url = page.replace("Page is now ", "").trim();
        break;
      }
      case "browser.evidence":
        if (d.key === "approved_hours") push(e.ts, `${names[d.subject_ref?.employee_id] ?? d.subject_ref?.employee_id}: ${d.value} h approved`);
        break;
      case "calc.with_evidence":
        push(e.ts, "Compared billed hours to timecards");
        break;
      case "synthesis.start":
        push(e.ts, "Writing the recommendation");
        break;
      case "receipt.written":
        push(e.ts, "Done");
        break;
    }
  }
  return { steps, url };
}

/* ------------------------------- bill views -------------------------------- */

export type DashStatus = "new" | "reviewing" | "needs_review" | "ready" | "approved" | "disputed" | "failed";

export interface DashBill {
  bill_id: string;
  invoice_id: string;
  vendor: string;
  amount: number;
  currency: string;
  issue_date: string | null;
  due_date: string | null;
  status: DashStatus;
  arrived_at: string | null;
  recommendation: Receipt["recommendation"] | null;
  issues: number;
}

export function dashStatus(bill: Bill, receipt: Receipt | null, job: AgentJob | undefined): DashStatus {
  if (job?.status === "running") return "reviewing";
  if (bill.status === "approved") return "approved";
  if (bill.status === "disputed") return "disputed";
  if (job?.status === "failed") return "failed";
  if (receipt && (!job || job.status === "done")) return receipt.recommendation === "approve" ? "ready" : "needs_review";
  return "new";
}

export function listDashBills(): DashBill[] {
  const inbox = readInbox();
  const jobs = readJobs();
  return readBills()
    .map((b): DashBill | null => {
      const invoiceId = b.bill_id.replace(/^bill_/, "");
      if (inbox.hidden.includes(invoiceId)) return null;
      const inv = loadInvoice(invoiceId);
      const receipt = readReceipt(invoiceId);
      const job = jobs[invoiceId];
      const status = dashStatus(b, receipt, job);
      const fresh = status === "needs_review" || status === "ready" || status === "approved" || status === "disputed";
      return {
        bill_id: b.bill_id,
        invoice_id: invoiceId,
        vendor: b.vendor,
        amount: b.amount,
        currency: inv?.currency ?? "USD",
        issue_date: inv?.issue_date ?? null,
        due_date: inv?.due_date ?? null,
        status,
        arrived_at: inbox.arrived[invoiceId] ?? null,
        recommendation: fresh && receipt ? receipt.recommendation : null,
        issues: fresh && receipt ? receipt.checks.filter((c) => c.result === "fail").length : 0,
      };
    })
    .filter((x): x is DashBill => x !== null)
    .sort((a, b) => (b.issue_date ?? "").localeCompare(a.issue_date ?? ""));
}

export function dashBill(billId: string) {
  const bill = listDashBills().find((b) => b.bill_id === billId);
  if (!bill) return null;
  const receipt = readReceipt(bill.invoice_id);
  const showReceipt = bill.status !== "new" && bill.status !== "reviewing" && bill.status !== "failed";
  return {
    bill,
    invoice: loadInvoice(bill.invoice_id),
    receipt: showReceipt ? receipt : null,
    activity: activity(bill.invoice_id),
  };
}

export const billIdForInvoice = billIdFor;
