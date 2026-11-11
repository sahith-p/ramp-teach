/**
 * Credential vault + harness sign-in: the sign_in tool fills the form through the driver and neither the tool
 * result, the onStep events, the hooks, the next request to the model nor the engine trace carries the password.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta";
import type { BrowserTarget, PageRef, RunContext } from "@/contracts";
import { describeCredential, getCredential, type Credential } from "@/lib/vault";
import { FakeDriver } from "@/agent/test-fixtures/fake-driver";
import { runBrowserLoop, signInTool, traceInput, type BrowserLoopRequest, type MessagesClient, type ToolCallInfo } from "@/agent/providers/browser-loop";
import { invoiceReviewWorkflow as wf } from "@/workflows/invoice-review";
import { browserSystemPrompt, composeBrowserTask } from "@/agent/engine";
import { signInToPortal } from "./sign-in";

const origin = "http://localhost:3000";
const SECRET = "Vault-S3cret-pw!";
const vaultCred = (): Credential => ({ username: "vault.user", password: SECRET, source: "env" });

/** Fake portal sign-in form: the submit button signs in only with the vault credential. */
class LoginDriver extends FakeDriver {
  filled = new Map<string, unknown>();
  constructor(private expect: { username: string; password: string } = { username: "vault.user", password: SECRET }) {
    super(origin);
  }
  override async find(query: string): Promise<PageRef[]> {
    this.calls.push(["find", query]);
    if (/user/i.test(query)) return [{ ref: "ref_1", role: "textbox", name: "Username" }];
    if (/pass/i.test(query)) return [{ ref: "ref_2", role: "textbox (password)", name: "Password" }];
    return [{ ref: "ref_3", role: "button", name: "Sign in" }];
  }
  override async formInput(ref: string, value: string | number | boolean): Promise<string> {
    this.filled.set(ref, value);
    return super.formInput(ref, value);
  }
  override async click(target: BrowserTarget): Promise<string> {
    const r = await super.click(target);
    if (target.type === "ref" && target.ref === "ref_3" && this.filled.get("ref_1") === this.expect.username && this.filled.get("ref_2") === this.expect.password) {
      this.url = `${origin}/portal/invoices`;
    }
    return r;
  }
}

describe("lib/vault getCredential", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vault-"));
  afterEach(() => fs.rmSync(path.join(tmp, "vault.json"), { force: true }));

  it("env wins, then runtime/vault.json, then the fixture default (halcyon only)", () => {
    const file = path.join(tmp, "vault.json");
    const env = { RAMP_TEACH_VAULT_HALCYON_USERNAME: "env.user", RAMP_TEACH_VAULT_HALCYON_PASSWORD: "env-pw" };
    expect(getCredential("halcyon", { env, file })).toEqual({ username: "env.user", password: "env-pw", source: "env" });
    fs.writeFileSync(file, JSON.stringify({ halcyon: { username: "file.user", password: "file-pw" } }));
    expect(getCredential("halcyon", { env: {}, file })).toEqual({ username: "file.user", password: "file-pw", source: "file" });
    fs.rmSync(file);
    expect(getCredential("halcyon", { env: {}, file })).toMatchObject({ username: "ap.reviewer", source: "default" });
    expect(getCredential("halcyon", { env: {}, file, allowDefault: false })).toBeNull();
    expect(getCredential("other-portal", { env: {}, file })).toBeNull();
  });

  it("needs both env values and ignores a malformed vault file", () => {
    const file = path.join(tmp, "vault.json");
    fs.writeFileSync(file, "{not json");
    expect(getCredential("halcyon", { env: { RAMP_TEACH_VAULT_HALCYON_USERNAME: "only-user" }, file })?.source).toBe("default");
  });

  it("describeCredential never includes the password", () => {
    expect(JSON.stringify(describeCredential("halcyon", vaultCred()))).not.toContain(SECRET);
  });
});

describe("signInToPortal (harness)", () => {
  it("fills username + password from the vault and submits", async () => {
    const d = new LoginDriver();
    const r = await signInToPortal(d, { baseUrl: origin, portal: "halcyon", getCredential: vaultCred });
    expect(r).toEqual({ ok: true, portal: "halcyon", username: "vault.user", source: "env", landed: "/portal/invoices", alreadySignedIn: false });
    expect(d.calls).toContainEqual(["navigate", `${origin}/portal/login`]);
    expect(d.calls).toContainEqual(["formInput", "ref_1", "vault.user"]);
    expect(d.calls).toContainEqual(["formInput", "ref_2", SECRET]);
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });

  it("reports a rejected credential, an unknown portal and a missing credential without the password", async () => {
    const d = new LoginDriver({ username: "vault.user", password: "something-else" });
    const bad = await signInToPortal(d, { baseUrl: origin, portal: "halcyon", getCredential: vaultCred });
    expect(bad.ok).toBe(false);
    expect(JSON.stringify(bad)).not.toContain(SECRET);
    expect((await signInToPortal(d, { baseUrl: origin, portal: "nope", getCredential: vaultCred })).ok).toBe(false);
    const none = await signInToPortal(d, { baseUrl: origin, portal: "halcyon", getCredential: () => null });
    expect(none).toMatchObject({ ok: false, error: expect.stringMatching(/No credential/) });
  });

  it("redacts the password from a driver error", async () => {
    const d = new LoginDriver();
    d.formInput = async (_ref, value) => {
      throw new Error(`fill failed for value ${String(value)}`);
    };
    const r = await signInToPortal(d, { baseUrl: origin, portal: "halcyon", getCredential: vaultCred });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });
});

/* ----------------------------- sign_in in the loop ---------------------------- */

const msg = (content: Array<Record<string, unknown>>, stop_reason: string): BetaMessage =>
  ({ id: "msg", type: "message", role: "assistant", model: "claude-opus-5-5", content, stop_reason, usage: { input_tokens: 1, output_tokens: 1 } }) as unknown as BetaMessage;

function fakeClient(responses: BetaMessage[]) {
  const requests: Array<Record<string, unknown>> = [];
  const client: MessagesClient = {
    beta: {
      messages: {
        stream(params: Record<string, unknown>) {
          requests.push(JSON.parse(JSON.stringify(params)));
          const next = responses.shift();
          return {
            request_id: "req",
            async finalMessage() {
              if (!next) throw new Error("no more fake responses");
              return next;
            },
          };
        },
      },
    },
  };
  return { client, requests };
}

describe("sign_in tool in the browser loop", () => {
  it("is a strict custom tool that takes only a portal id", () => {
    const t = signInTool(["halcyon"]);
    expect(t).toMatchObject({ name: "sign_in", strict: true, input_schema: { required: ["portal"], additionalProperties: false } });
    expect(t.input_schema.properties.portal.enum).toEqual(["halcyon"]);
    expect(traceInput("sign_in", { portal: "halcyon", password: "x" })).toEqual({ portal: "halcyon" });
  });

  it("the harness fills the form; the model, onStep, hooks and next request never see the password", async () => {
    const driver = new LoginDriver();
    const { client, requests } = fakeClient([
      msg([{ type: "tool_use", id: "s1", name: "sign_in", input: { portal: "halcyon" } }], "tool_use"),
      msg([{ type: "text", text: "Signed in." }], "end_turn"),
    ]);
    const steps: unknown[] = [];
    const calls: ToolCallInfo[] = [];
    const req: BrowserLoopRequest = {
      system: "SYSTEM",
      task: "TASK",
      startUrl: `${origin}/portal/login`,
      allowedOrigins: [origin],
      maxTurns: 5,
      driver,
      onStep: (s) => steps.push(s),
      hooks: { onToolCall: (c) => calls.push(c) },
      getCredential: vaultCred,
    };
    const res = await runBrowserLoop(client, { model: "claude-opus-5-5", effort: "medium" }, req);
    expect(res.stopReason).toBe("end_turn");
    expect(driver.calls).toContainEqual(["formInput", "ref_2", SECRET]);
    expect(driver.url).toBe(`${origin}/portal/invoices`);

    const result = ((requests[1].messages as Array<{ content: unknown }>)[2].content as Array<{ content: string; is_error?: boolean }>)[0];
    expect(result.is_error).toBeFalsy();
    expect(result.content).toBe("Signed in as vault.user (halcyon). Now on /portal/invoices.");
    expect(calls[0]).toMatchObject({ tool: "sign_in", input: { portal: "halcyon" }, is_error: false });
    for (const blob of [JSON.stringify(requests), JSON.stringify(steps), JSON.stringify(calls), JSON.stringify(res)]) {
      expect(blob).not.toContain(SECRET);
    }
    // The tools list sent to the API carries the sign_in tool next to record_evidence.
    expect((requests[0].tools as Array<{ name?: string }>).map((t) => t.name).filter(Boolean)).toEqual(["record_evidence", "sign_in"]);
  });

  it("a failed sign-in is a tool error without the password", async () => {
    const driver = new LoginDriver({ username: "vault.user", password: "nope" });
    const { client, requests } = fakeClient([
      msg([{ type: "tool_use", id: "s1", name: "sign_in", input: { portal: "halcyon" } }], "tool_use"),
      msg([{ type: "text", text: "Could not sign in." }], "end_turn"),
    ]);
    await runBrowserLoop(client, { model: "m", effort: "low" }, {
      system: "S",
      task: "T",
      startUrl: `${origin}/portal/login`,
      allowedOrigins: [origin],
      maxTurns: 5,
      driver,
      onStep: () => {},
      getCredential: vaultCred,
    } as BrowserLoopRequest);
    const result = ((requests[1].messages as Array<{ content: unknown }>)[2].content as Array<{ content: string; is_error?: boolean }>)[0];
    expect(result.is_error).toBe(true);
    expect(JSON.stringify(requests)).not.toContain(SECRET);
  });
});

describe("browser prompts point the model at sign_in", () => {
  it("system prompt + task prompt say to use sign_in, never to type credentials", () => {
    const sys = browserSystemPrompt([origin]);
    expect(sys).toMatch(/call the sign_in tool/);
    expect(sys).not.toMatch(/demo credentials/);
    const s = wf.loadSubject("HSG-1011");
    const task = composeBrowserTask(wf.summarize(s), wf.evidencePlan(s, { vendor: "", proof_sources: [], rules: [], open_questions: [] }), {
      vendor: "",
      proof_sources: [],
      rules: [],
      open_questions: [],
    });
    expect(task).toContain('sign_in {"portal":"halcyon"}');
    expect(task).not.toContain("demo-only");
  });
});

describe("scripted evidence path signs in from the vault", () => {
  it("uses the vault credential and traces portal + username only", async () => {
    const driver = new LoginDriver({ username: "ap.reviewer", password: "demo-only" }); // fixture default
    const traced: unknown[] = [];
    const ctx: RunContext = { baseUrl: origin, runId: "t", runDir: "/tmp/none", trace: (step, mode, stage, detail) => traced.push({ step, mode, stage, detail }) };
    await wf.scriptedEvidence(wf.loadSubject("HSG-1011"), [], driver, ctx);
    expect(driver.calls).toContainEqual(["formInput", "ref_2", "demo-only"]);
    const login = traced.find((t) => (t as { step: string }).step === "scripted.login") as { detail: Record<string, unknown> };
    expect(login.detail).toMatchObject({ portal: "halcyon", username: "ap.reviewer", credential_source: "default" });
    expect(JSON.stringify(traced)).not.toContain("demo-only");
  });
});
