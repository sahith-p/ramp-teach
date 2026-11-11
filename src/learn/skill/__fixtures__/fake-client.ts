/**
 * Fake Anthropic client for the skill learner tests. Each method answers from a handler (or a queue) and records
 * the request, so tests can check request shapes (documents with citations, structured output formats, tools).
 */
import type { SkillClient } from "../client";

export type Handler = (params: Record<string, unknown>) => unknown | Promise<unknown>;

export interface FakeClient extends SkillClient {
  calls: { method: string; params: unknown }[];
  uploaded: { name: string; text: string }[];
  deleted: string[];
}

let n = 0;
export function message(over: Record<string, unknown>): Record<string, unknown> {
  n++;
  const msg: Record<string, unknown> = {
    id: `msg_fake_${n}`,
    model: "claude-opus-5-5",
    stop_reason: "end_turn",
    content: [],
    usage: { input_tokens: 100, output_tokens: 50 },
    container: null,
    ...over,
  };
  Object.defineProperty(msg, "_request_id", { value: `req_fake_${n}`, enumerable: false });
  return msg;
}

export function fakeClient(h: {
  create?: Handler;
  parse?: Handler;
  skillsCreate?: Handler;
  versionsCreate?: (id: string, params: Record<string, unknown>) => unknown;
}): FakeClient {
  const calls: FakeClient["calls"] = [];
  const uploaded: FakeClient["uploaded"] = [];
  const deleted: string[] = [];
  const need = (fn: Handler | undefined, name: string) => {
    if (!fn) throw new Error(`fake client: no handler for ${name}`);
    return fn;
  };
  return {
    calls,
    uploaded,
    deleted,
    beta: {
      messages: {
        create: async (params) => {
          calls.push({ method: "beta.messages.create", params });
          return need(h.create, "create")(params as never);
        },
        parse: async (params) => {
          calls.push({ method: "beta.messages.parse", params });
          return need(h.parse, "parse")(params as never);
        },
      },
    },
    files: {
      upload: async (params) => {
        const f = params.file as unknown as File;
        uploaded.push({ name: f.name, text: await f.text() });
        calls.push({ method: "files.upload", params: { name: f.name } });
        return { id: `file_fake_${uploaded.length}` };
      },
      delete: async (id) => {
        deleted.push(id);
        return { id, type: "file_deleted" };
      },
    },
    skills: {
      create: async (params) => {
        const files = params.files as unknown as File[];
        calls.push({ method: "skills.create", params: { names: files.map((f) => f.name), display_name: params.display_name } });
        return (h.skillsCreate ?? (() => ({ id: "skill_fake_1", latest_version_id: "skv_fake_1" })))(params as never) as never;
      },
      versions: {
        create: async (id, params) => {
          const files = params.files as unknown as File[];
          calls.push({ method: "skills.versions.create", params: { id, names: files.map((f) => f.name) } });
          return (h.versionsCreate ?? (() => ({ id: "skv_fake_2" })))(id, params as never) as never;
        },
      },
    },
  };
}
