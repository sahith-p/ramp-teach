# Claude API notes for this repo (read before writing any Anthropic SDK code)

Extracted from the Claude API reference available to the orchestrator. The SDK is
`@anthropic-ai/sdk` (installed, v1.6.x). **Never guess SDK names — read the .d.ts in
node_modules/@anthropic-ai/sdk when unsure, and let `npx tsc --noEmit` tell you.**

## Defaults
- Model: `claude-opus-5-5` (export it from one place per lane; env override `RAMP_TEACH_MODEL`).
- Thinking: `thinking: { type: "adaptive" }` (or omit). **Never** `{type:"disabled"}` or `budget_tokens` — 400 on Opus 5.5.
- Effort: set explicitly, `output_config: { effort: "medium" }` (default on Opus 5.5 is medium).
- No assistant prefill (400). No forced `tool_choice` `any`/`tool` (400) — use `auto` + prompt.
- No `temperature`/`top_p`/`top_k`.
- Always check `stop_reason` before reading content; handle `"refusal"` (read `stop_details`).
- Refusal fallback opt-in (beta): `client.beta.messages.*` with `betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`.
- Only call the API when `process.env.ANTHROPIC_API_KEY` is set. Without it, run the labeled offline mode.

## Structured outputs (Zod) — used by learn + receipt synthesis
```ts
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
const client = new Anthropic();
const res = await client.messages.parse({
  model: "claude-opus-5-5",
  max_tokens: 16000,
  thinking: { type: "adaptive" },
  output_config: { effort: "medium", format: zodOutputFormat(MySchema) },
  messages: [{ role: "user", content: "..." }],
});
if (res.stop_reason === "refusal") { /* handle */ }
const out = res.parsed_output; // null if parsing failed — guard, then re-validate with MySchema.parse
```
Always re-validate the parsed output against the frozen contract schema (`ReceiptSchema.parse`,
`WorkflowSpecSchema.parse`). If structured-output schema conversion rejects a schema feature,
define an API-facing schema with the same fields and map it.

## Browser use toolset — `browser_toolset_20260801` (agent lane)
Declared as a tools entry with no name: `{ "type": "browser_toolset_20260801" }`, optional
`configs: { <member>: { enabled: boolean } }`. No beta header documented for the API; the SDK helper classes are beta.
Do NOT send the `fine-grained-tool-streaming-2025-05-14` header with it.

Claude returns member `tool_use` blocks: `{ type:"tool_use", id, name:"navigate", toolset_name:"browser", input:{ url } }`.
Several per turn = a batch; run in order. Every member call needs one `tool_result` in the next user message,
with `tool_use_id` and **`toolset_name: "browser"` echoed**.

Members (27 enabled by default): `navigate {url|"back"|"forward"|"reload", tab_id?}`, `screenshot`, `zoom {region:[x0,y0,x1,y1]}`,
`left_click|right_click|middle_click|double_click|triple_click {target, modifiers?}`, `hover {target}`,
`left_click_drag {from, target}`, `mouse_move {target}`, `scroll {target, scroll_direction, scroll_amount?}`,
`scroll_to {target: RefTarget}`, `type {text}`, `key {text, repeat?}`, `wait {duration}`,
`read_page {filter?: "interactive"|"all", depth?, ref?}`, `find {query}`, `get_page_text`,
`form_input {target: RefTarget, value}`, `new_tab`, `list_tabs`, `switch_tab {tab_id}`, `close_tab {tab_id}`.
Disabled by default: `file_upload`, `read_console`, `read_network`, `javascript_exec` (keep them disabled), and `left_mouse_down/up`, `hold_key` are optional.
Targets: `{type:"coordinate", x, y}` (viewport px) or `{type:"ref", ref:"ref_2"}` (from `read_page`/`find`, tab-scoped).

Results: text (`"Clicked element ref_2."`), `screenshot`/`zoom` must return an `image` block
(`{type:"image", source:{type:"base64", media_type:"image/png", data}}`). Results may contain only
`text`, `image`, `browser_state` blocks. Tab-management results: exactly one `browser_state` block
(`{type:"browser_state", tabs:[{tab_id,title,url,active}]}`). Errors: `is_error: true` + specific text.
Halt rule: after a failure in a batch, answer each later call with `is_error: true` and text
`Not executed: an earlier action in this turn failed.`

### SDK helper (preferred)
`node_modules/@anthropic-ai/sdk/helpers/beta/toolsets/browser.d.ts` exports
`BetaAbstractBrowserToolset20260801` (import from `@anthropic-ai/sdk/helpers/beta/toolsets`).
Subclass it and override the members your Playwright driver supports (`navigate`, `screenshot`,
`left_click`, `type_`, `read_page`, `find`, `get_page_text`, ...). Constructor options:
`browserState` (required: report tabs), `urlPolicy` (use it to refuse any non-localhost URL by
throwing `ToolError`), `configs`. Use `toolset.toJSON()` as the tools entry and either the beta tool runner
or a manual loop calling `toolset.toolResult(toolUse)`. Source is in `node_modules/@anthropic-ai/sdk/src/helpers/beta/toolsets/`.
If the helper does not work, map members to Playwright calls by hand using the wire shapes above.

### Safety for this repo
- The agent's browser may reach ONLY `http://localhost:<port>` fixture pages: enforce in `urlPolicy`
  AND with Playwright request routing (abort any request whose host is not localhost/127.0.0.1).
- The agent never approves, pays, submits, or attaches anything. It only reads fixture pages.
