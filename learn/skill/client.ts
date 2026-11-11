/**
 * The Anthropic client surface the skill learner uses, and the shared call wrapper (cache, usage ledger with
 * request ids, refusal / truncation checks). Tests pass a fake that implements SkillClient.
 *
 * API features used (docs: claude-api skill, TypeScript):
 *   client.beta.messages.create   claims (document citations) and checks (code_execution_20260521 + container_upload)
 *   client.beta.messages.parse    synthesize / critique / check scripts (structured outputs via betaZodOutputFormat)
 *   client.files.upload / delete  the sandbox runner file (Files API, GA)
 *   client.skills.create / client.skills.versions.create   package upload (Skills API, GA)
 * Every Messages call opts into server-side refusal fallback (beta server-side-fallback-2026-07-01,
 * fallbacks: "default"), adaptive thinking and the configured effort, like agent/providers/anthropic.ts.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Uploadable } from "@anthropic-ai/sdk";
import { anthropicBaseUrl, engineConfig, providerCredentialsPresent, resolveAnthropicKey } from "@/config/engine";
import { cacheKey, readCache, writeCache } from "@/lib/cache";
import { recordUsage } from "@/lib/usage";
import type { CallMeta } from "./types";

type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

/** Structural subset of the SDK client. The real `Anthropic` instance satisfies it. */
export interface SkillClient {
  beta: {
    messages: {
      create(params: CreateParams): PromiseLike<unknown>;
      parse(params: CreateParams): PromiseLike<unknown>;
    };
  };
  files: {
    upload(params: { file: Uploadable }): PromiseLike<{ id: string }>;
    delete(fileID: string): PromiseLike<unknown>;
  };
  skills: {
    create(params: { files: Uploadable[]; display_name?: string | null }): PromiseLike<{ id: string; latest_version_id: string }>;
    versions: { create(skillID: string, params: { files: Uploadable[] }): PromiseLike<{ id: string }> };
  };
}

/** Real client when credentials exist and offline mode is off; null otherwise (labeled offline mode). */
export function makeSkillClient(): SkillClient | null {
  if (!providerCredentialsPresent()) return null;
  const cred = resolveAnthropicKey();
  if (!cred) return null;
  // Key and base URL passed explicitly (the session exports ANTHROPIC_BASE_URL for Claude Code). Never logged.
  return new Anthropic({ apiKey: cred.key, baseURL: anthropicBaseUrl }) as unknown as SkillClient;
}

export const SKILL_MODEL = engineConfig.model;
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** Common request fields for every Messages call. */
export function baseParams(maxTokens = 16000) {
  return {
    model: SKILL_MODEL,
    max_tokens: maxTokens,
    thinking: { type: "adaptive" as const },
    betas: [FALLBACK_BETA],
    fallbacks: "default" as const,
  };
}

export class SkillModelError extends Error {
  constructor(message: string, public readonly meta?: Partial<CallMeta>) {
    super(message);
  }
}

/** Minimal shape of a Messages response the learner reads. */
export interface MessageLike {
  id?: string;
  model?: string;
  stop_reason?: string | null;
  stop_details?: { category?: string | null; explanation?: string | null } | null;
  content?: unknown[];
  usage?: Record<string, unknown>;
  parsed_output?: unknown;
  container?: { id?: string } | null;
  _request_id?: string | null;
}

export interface CallOptions {
  /** Ledger purpose, e.g. "skill-claims". */
  purpose: string;
  /** Cache namespace + parts; omit to never cache (e.g. calls with uploaded file ids). */
  cache?: { namespace: string; parts: unknown };
  noCache?: boolean;
  /** Accept these stop reasons besides end_turn (e.g. pause_turn handled by the caller). */
  allowStop?: string[];
}

interface CachedCall<T> {
  value: T;
  meta: CallMeta;
}

/**
 * Run one model call: read the cache, otherwise call, record usage (with request id), reject refusals and
 * truncation, extract the value, and cache it. `extract` turns the raw message into the stage value.
 */
export async function modelCall<T>(
  run: () => PromiseLike<unknown>,
  extract: (msg: MessageLike) => T,
  opts: CallOptions,
): Promise<{ value: T; meta: CallMeta; message: MessageLike | null }> {
  const key = opts.cache ? cacheKey(opts.cache.namespace, { model: SKILL_MODEL, effort: engineConfig.effort, parts: opts.cache.parts }) : null;
  if (key && !opts.noCache) {
    const hit = readCache<CachedCall<T>>(key);
    if (hit) return { value: hit.value, meta: { ...hit.meta, cache_hit: true }, message: null };
  }
  const msg = (await run()) as MessageLike;
  const meta: CallMeta = {
    model: msg.model ?? SKILL_MODEL,
    request_id: msg._request_id ?? null,
    message_id: msg.id ?? null,
    usage: msg.usage ?? null,
    cache_hit: false,
  };
  recordUsage(opts.purpose, meta.model ?? SKILL_MODEL, msg.usage, { request_id: meta.request_id, message_id: meta.message_id });
  if (msg.stop_reason === "refusal") {
    throw new SkillModelError(`Model declined (category: ${msg.stop_details?.category ?? "unknown"})`, meta);
  }
  if (msg.stop_reason === "max_tokens") throw new SkillModelError("Output truncated (max_tokens)", meta);
  if (msg.stop_reason && msg.stop_reason !== "end_turn" && !(opts.allowStop ?? []).includes(msg.stop_reason)) {
    throw new SkillModelError(`Unexpected stop_reason ${msg.stop_reason}`, meta);
  }
  const value = extract(msg);
  if (key && !opts.noCache) writeCache<CachedCall<T>>(key, { value, meta });
  return { value, meta, message: msg };
}

/** Usage record for a LearnStage (ids ride along so the stage names the API request). */
export function stageUsage(meta: CallMeta | null): Record<string, unknown> | null {
  if (!meta) return null;
  return { ...(meta.usage ?? {}), message_id: meta.message_id ?? null, cache_hit: meta.cache_hit ?? false };
}
