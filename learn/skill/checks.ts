/**
 * Stage 5, checks (Claude, real): Claude writes small Python check scripts that mirror CHECK_NAMES where the
 * skill's rules imply them (structured output). The scripts run in Anthropic's code execution sandbox
 * (code_execution_20260521) against the past invoices, the timecards and the vendor contract: the learner uploads
 * one runner file with the Files API, attaches it with a `container_upload` block and asks Claude to run it; the
 * runner prints one JSON line. Each sandbox result is compared with this repo's deterministic calc/ on the same
 * data and the agreement is recorded per check. calc/ stays authoritative; nothing here changes what calc decides.
 */
import { z } from "zod";
import { toFile } from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type Anthropic from "@anthropic-ai/sdk";
import { CHECK_NAMES, type CalcReport, type CheckName, type Invoice, type SkillRule, type Timecard, type VendorProfile } from "@/contracts";
import { runCalc } from "@/calc";
import { engineConfig } from "@/config/engine";
import { cacheKey, readCache, writeCache } from "@/lib/cache";
import { baseParams, modelCall, SkillModelError, type MessageLike, type SkillClient } from "./client";
import type { CallMeta } from "./types";

export const CHECK_DESCRIPTIONS: Record<CheckName, string> = {
  line_amounts_correct: "quantity * unit_rate equals amount, to the cent, for every line",
  total_matches_line_items: "the line amounts sum to the invoice total, to the cent",
  rate_matches_contract: "each labor line's unit_rate equals the contract rate-card bill_rate for the line's role",
  no_duplicate_lines: "no two labor lines bill the same employee for the same week",
  no_unknown_charges: "every non-labor line's description is an allowed charge and its amount is within max_amount (null = no cap)",
  hours_match_timecards: "each labor line's hours are <= the approved timecard hours for that employee and week (missing approved timecard = fail)",
};

export const ChecksApiSchema = z.object({
  scripts: z.array(
    z.object({
      check: z.enum(CHECK_NAMES),
      rule_ids: z.array(z.string()).describe("Ids of the skill rules this check implements"),
      code: z.string().describe("Python 3 source defining check(invoice, vendor, timecards) -> dict"),
    }),
  ),
});
export type ChecksApi = z.infer<typeof ChecksApiSchema>;

export const CHECKS_SYSTEM = `You write small, self-contained Python 3 check scripts (standard library only) for an invoice review skill.
Write a script only for a check that the skill's rules imply. Each script defines exactly:

  def check(invoice: dict, vendor: dict, timecards: list) -> dict

returning {"result": "pass" | "fail", "failing_lines": [0-based line indices that fail]} ("failing_lines" is [] for
checks about the whole invoice). Data shapes:
- invoice: {"invoice_id", "line_items": [{"description", "quantity", "unit_rate", "amount"}], "total", "currency"}.
  A labor line's description matches ^Labor: (.+) \\((.+)\\) - week ending (\\d{4}-\\d{2}-\\d{2})$ (name, role, week);
  quantity = hours, unit_rate = hourly rate. Any other line is a non-labor charge.
- vendor: {"contract": {"rate_card": [{"role", "bill_rate"}], "allowed_charges": [{"description", "max_amount" (number or null)}]},
  "employees": [{"employee_id", "name", "role"}]}. Match employees by name to get employee_id.
- timecards: [{"employee_id", "week_ending", "approved_hours", "approved_by", "status"}]; only status "approved" counts.
Compare money to the cent (round to 2 decimals). Do not read files, the network, or the environment.`;

export function checksPrompt(rules: SkillRule[]): string {
  return [
    "Skill rules:",
    rules.map((r) => `${r.id} [${r.kind}] ${r.text}`).join("\n"),
    "",
    "Check names you may implement (use these exact names):",
    CHECK_NAMES.map((n) => `- ${n}: ${CHECK_DESCRIPTIONS[n]}`).join("\n"),
  ].join("\n");
}

export interface SandboxRow {
  check: string;
  invoice_id: string;
  result?: "pass" | "fail";
  failing_lines?: number[];
  error?: string;
}

export const RUNNER_FILENAME = "ramp_skill_checks.py";
export const RESULT_MARKER = "RAMP_CHECKS_JSON:";

/** The one file uploaded to the sandbox: data + scripts (base64 JSON) and a fixed loop that prints one JSON line. */
export function buildRunner(payload: { invoices: Invoice[]; vendor: VendorProfile; timecards: Timecard[]; scripts: { check: string; code: string }[] }): string {
  const b64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  return `# Ramp Teach skill checks runner (generated). Runs Claude-written check scripts on past invoices.
import base64, copy, json, traceback
P = json.loads(base64.b64decode("${b64}").decode("utf-8"))
rows = []
for s in P["scripts"]:
    ns = {}
    try:
        exec(s["code"], ns)
        fn = ns["check"]
    except Exception as e:
        for inv in P["invoices"]:
            rows.append({"check": s["check"], "invoice_id": inv["invoice_id"], "error": "load: " + repr(e)[:200]})
        continue
    for inv in P["invoices"]:
        try:
            r = fn(copy.deepcopy(inv), copy.deepcopy(P["vendor"]), copy.deepcopy(P["timecards"]))
            res = r.get("result")
            lines = sorted(int(x) for x in (r.get("failing_lines") or []))
            if res not in ("pass", "fail"):
                raise ValueError("bad result %r" % (res,))
            rows.append({"check": s["check"], "invoice_id": inv["invoice_id"], "result": res, "failing_lines": lines})
        except Exception as e:
            rows.append({"check": s["check"], "invoice_id": inv["invoice_id"], "error": repr(e)[:200]})
print("${RESULT_MARKER}" + json.dumps(rows))
`;
}

/** Find the runner's JSON line in the sandbox's bash (or Python) results. */
export function sandboxRowsFromContent(content: unknown[]): SandboxRow[] | null {
  for (const b of content as { type?: string; content?: { type?: string; stdout?: string } }[]) {
    const isResult = b.type === "bash_code_execution_tool_result" || b.type === "code_execution_tool_result";
    const stdout = isResult ? b.content?.stdout : undefined;
    if (typeof stdout !== "string") continue;
    const line = stdout.split("\n").find((l) => l.startsWith(RESULT_MARKER));
    if (line) return JSON.parse(line.slice(RESULT_MARKER.length)) as SandboxRow[];
  }
  return null;
}

export interface CheckAgreement {
  check: CheckName;
  file: string | null;
  rule_ids: string[];
  invoices: number;
  agree: number;
  agreement: number;
  disagreements: { invoice_id: string; sandbox: string; calc: string }[];
}

const calcLines = (r: CalcReport, check: CheckName) =>
  [...new Set((r.checks.find((c) => c.check === check)?.findings ?? []).map((f) => f.line_index).filter((x): x is number => x !== null))].sort((a, b) => a - b);

/** Compare sandbox rows with calc/ on the same invoices. Agreement = same result and, for fails, same failing lines. */
export function compareWithCalc(
  rows: SandboxRow[],
  scripts: { check: CheckName; rule_ids: string[]; file: string | null }[],
  invoices: { invoice: Invoice; path: string }[],
  vendor: VendorProfile,
  timecards: Timecard[],
  now = new Date(0),
): CheckAgreement[] {
  const reports = new Map(invoices.map(({ invoice, path }) => [invoice.invoice_id, runCalc({ invoice, vendor, timecards, invoicePath: path }, now)]));
  return scripts.map((s) => {
    const disagreements: CheckAgreement["disagreements"] = [];
    let agree = 0;
    for (const { invoice } of invoices) {
      const rep = reports.get(invoice.invoice_id)!;
      const calcRes = rep.checks.find((c) => c.check === s.check)?.result ?? "unverified";
      const cl = calcLines(rep, s.check);
      const calcStr = calcRes === "fail" && cl.length ? `fail [${cl.join(",")}]` : calcRes;
      const row = rows.find((r) => r.check === s.check && r.invoice_id === invoice.invoice_id);
      const sbStr = !row ? "missing" : row.error ? `error: ${row.error}` : row.result === "fail" && row.failing_lines?.length ? `fail [${row.failing_lines.join(",")}]` : (row.result ?? "missing");
      if (sbStr === calcStr) agree++;
      else disagreements.push({ invoice_id: invoice.invoice_id, sandbox: sbStr, calc: calcStr });
    }
    const n = invoices.length;
    return { check: s.check, file: s.file, rule_ids: s.rule_ids, invoices: n, agree, agreement: n ? agree / n : 0, disagreements };
  });
}

export async function writeCheckScripts(
  client: SkillClient,
  rules: SkillRule[],
  opts: { noCache?: boolean } = {},
): Promise<{ api: ChecksApi; meta: CallMeta }> {
  const prompt = checksPrompt(rules);
  const { value, meta } = await modelCall(
    () =>
      client.beta.messages.parse({
        ...baseParams(16000),
        output_config: { effort: engineConfig.effort, format: betaZodOutputFormat(ChecksApiSchema) },
        system: CHECKS_SYSTEM,
        messages: [{ role: "user", content: prompt }],
      }),
    (msg) => {
      if (msg.parsed_output == null) throw new SkillModelError("Structured output failed to parse");
      const api = ChecksApiSchema.parse(msg.parsed_output);
      // One script per check name (first wins).
      return { scripts: api.scripts.filter((s, i) => api.scripts.findIndex((x) => x.check === s.check) === i) };
    },
    { purpose: "skill-checks-write", cache: { namespace: "skill-checks-write", parts: { system: CHECKS_SYSTEM, prompt } }, noCache: opts.noCache },
  );
  return { api: value, meta };
}

export const SANDBOX_INSTRUCTION = `A Python file named ${RUNNER_FILENAME} is attached to your container. Find it and run it, exactly once, with:
python3 "$(find / -name ${RUNNER_FILENAME} -not -path '/proc/*' 2>/dev/null | head -1)"
Do not change or rewrite it. After it runs, reply with the single word: done.`;

/**
 * Run the runner in the code execution sandbox. Handles pause_turn by sending the turn back (up to 3 times).
 * Cached by runner content (same scripts + data -> same sandbox output); the uploaded file is deleted after.
 */
export async function runInSandbox(
  client: SkillClient,
  runner: string,
  opts: { noCache?: boolean } = {},
): Promise<{ rows: SandboxRow[]; metas: CallMeta[]; container_id: string | null; file_id: string | null; cache_hit: boolean }> {
  const key = cacheKey("skill-checks-sandbox", { runner, model: baseParams().model });
  if (!opts.noCache) {
    const hit = readCache<{ rows: SandboxRow[]; metas: CallMeta[]; container_id: string | null; file_id: string | null }>(key);
    if (hit) return { ...hit, metas: hit.metas.map((m) => ({ ...m, cache_hit: true })), cache_hit: true };
  }
  const file = await client.files.upload({ file: await toFile(Buffer.from(runner, "utf8"), RUNNER_FILENAME, { type: "text/x-python" }) });
  const metas: CallMeta[] = [];
  let container_id: string | null = null;
  try {
    const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [
      {
        role: "user",
        content: [
          { type: "text", text: SANDBOX_INSTRUCTION },
          { type: "container_upload", file_id: file.id },
        ],
      },
    ];
    let rows: SandboxRow[] | null = null;
    for (let turn = 0; turn < 4 && !rows; turn++) {
      const { value, meta } = await modelCall(
        () =>
          client.beta.messages.create({
            ...baseParams(16000),
            output_config: { effort: engineConfig.effort },
            ...(container_id ? { container: container_id } : {}),
            tools: [{ type: "code_execution_20260521", name: "code_execution" }],
            messages,
          }),
        (msg: MessageLike) => msg,
        { purpose: "skill-checks-sandbox", allowStop: ["pause_turn"] },
      );
      metas.push(meta);
      container_id = value.container?.id ?? container_id;
      rows = sandboxRowsFromContent(value.content ?? []);
      if (rows || value.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: (value.content ?? []) as Anthropic.Beta.Messages.BetaContentBlockParam[] });
    }
    if (!rows) throw new SkillModelError("The sandbox run printed no results");
    const out = { rows, metas, container_id, file_id: file.id };
    if (!opts.noCache) writeCache(key, out);
    return { ...out, cache_hit: false };
  } finally {
    try {
      await client.files.delete(file.id);
    } catch {
      /* best effort */
    }
  }
}
