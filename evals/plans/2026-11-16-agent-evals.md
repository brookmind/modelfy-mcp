# Agent evals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (the owner's rules: implement in the main session, no implementer subagents). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A harness in `modelfy-mcp/evals/` that runs Claude Haiku 5.5 as a chat assistant and as a coding agent against the dev sandbox, grades the traces, and records the v0 and bare baselines in `evals/REPORT.md`.

**Architecture:** Two PRs. PR 1 (`feat/sandbox-eval-modes`, from `main`) changes the Worker: sandbox keys that act as a person or a budgeted bot, a demo product page, selectable agent-facing text (`v0` / `bare`), rate limits off KV. PR 2 (`feat/evals`, this branch) adds a Node package in `evals/` with two agent adapters writing one trace format, deterministic checks, a Haiku person simulator and judge, a runner with resume and a KV write budget, and a report generator.

**Tech Stack:** Cloudflare Workers, zod 4, `@modelcontextprotocol/server`, Vitest with `@cloudflare/vitest-plugin` (Worker); Node 22, `@anthropic-ai/sdk` (MCP connector beta `mcp-client-2025-11-20`), `@anthropic-ai/claude-agent-sdk`, `tsx`, Vitest (harness); `bwrap`.

**Spec:** `evals/DESIGN.md`.

## Global Constraints

- Agent model `claude-haiku-5-5`; person simulator and judge `claude-haiku-5-5`. Prices from the claude-api skill: Haiku 5.5 $0.10 / $0.50 per MTok (prompts up to 100K), cache writes 1.25x input, cache reads 0.1x input.
- Server under test: `https://mcp-dev.modelfy.ai`. Nothing runs against production.
- Workers Free: the runner stops before 900 estimated KV writes per UTC day.
- No secret in the repo, in results or in agentmemory: keys are redacted to `mfy_test_***`; `ANTHROPIC_API_KEY` and the dev refresh token come from the environment / a file outside the repo.
- Strict TypeScript: no `any`, no `as`, explicit return types on exported functions, interfaces for object shapes, async/await.
- Sandbox budget for `acts_as: "bot"`: 100 credits per session, 500 per UTC day. Sandbox price: 20 credits per photo (existing `SANDBOX_PRICE_PER_PHOTO`).
- English in every file. Prettier on every changed file.
- Each paid run (pilot, baseline) needs the owner's OK with a cost estimate first.

## Review Focus

- A sandbox key created with no body must behave exactly as today (existing clients, docs); test in Task 1.
- `acts_as` or `agent_layer` with an unknown value, or `agent_layer: "bare"` in production (`ALLOW_BARE_AGENT_LAYER` unset): 400 with a clear message, never a silent fallback; tests in Task 1.
- A bot key's daily spend must survive across connections (new MCP request = new isolate) and reset at 00:00 UTC; test in Task 2.
- A run that crashes mid-way (network, 529) must not leave a half-written result line nor rerun finished (task, rep) pairs; test in Task 8.
- A tool result or agent text that contains a sandbox key must never reach `results.jsonl` unredacted (the device-login task prints keys into `.env`, the coding agent may echo them); test in Task 8.

---

## PR 1: Worker changes (`feat/sandbox-eval-modes`, worktree from `origin/main`)

### Task 1: Sandbox key options

**Files:**

- Modify: `src/auth/sandbox-keys.ts`, `src/auth/props.ts`, `src/auth/external-token.ts:54-64`, `wrangler.jsonc` (vars `ALLOW_BARE_AGENT_LAYER`, `SANDBOX_KEYS_PER_HOUR`), `vitest.config.ts` (bindings), `worker-configuration.d.ts` (`npm run cf-typegen`)
- Test: `test/auth/keys.test.ts`

**Interfaces:**

- Produces: `GrantProps` gains `actsAs: "person" | "bot" | null` and `agentLayer: "v0" | "bare"` (both `.default(...)` in the schema so stored OAuth grants without them still parse: `actsAs` default `null`, `agentLayer` default `"v0"`). `SandboxKey` in KV gains the same two fields (defaults the same). For `actsAs: "bot"`, `resolveApiKey` sets `budget: { maxCreditsPerSession: 100, maxCreditsPerDay: 500 }`.
- Produces: `export const SANDBOX_BOT_BUDGET = { maxCreditsPerSession: 100, maxCreditsPerDay: 500 }` in `src/auth/sandbox-keys.ts`.

- [ ] **Step 1: Write the failing tests** in `test/auth/keys.test.ts`:
  - `creates a plain sandbox key with no body` → 200; MCP `get_account` with it returns `keyKind: "anonymous"`, `budget: null` (unchanged behaviour).
  - `creates a person key` → body `{"acts_as":"person"}`; the MCP server's instructions (`client.getInstructions()`) contain `"show them the credits from plan_photos and ask"`.
  - `creates a bot key with the default live budget` → `get_account.budget` equals `{ maxCreditsPerSession: 100, maxCreditsPerDay: 500, spentToday: 0, resetsAt: <next 00:00 UTC ISO> }`.
  - `rejects an unknown acts_as` → 400 `{ error: "invalid_request" }` with an `error_description` naming the allowed values.
  - `rejects agent_layer bare unless allowed` → with `ALLOW_BARE_AGENT_LAYER` unset: 400; with it `"true"` (test binding): 200.
  - `limits keys per address with SANDBOX_KEYS_PER_HOUR` → binding `"2"`: third key in the hour is 429.

- [ ] **Step 2: Run** `npx vitest run test/auth/keys.test.ts` — Expected: the new tests FAIL.

- [ ] **Step 3: Implement.** `createSandboxKey` parses an optional JSON body with zod (`acts_as`, `agent_layer`, both optional; empty body or no `Content-Type` = `{}`); the per-hour limit reads `env.SANDBOX_KEYS_PER_HOUR` (number, default 5). `wrangler.jsonc`: top-level vars `SANDBOX_KEYS_PER_HOUR: "5"`, `env.dev.vars`: `SANDBOX_KEYS_PER_HOUR: "200"`, `ALLOW_BARE_AGENT_LAYER: "true"`; production gets neither (defaults apply).

- [ ] **Step 4: Run** `npx vitest run test/auth` — Expected: PASS.

- [ ] **Step 5: Commit** `feat: sandbox keys can act as a person or a budgeted bot`.

### Task 2: Spending rule and sandbox budget

**Files:**

- Create: `src/mcp/spending.ts`
- Modify: `src/mcp/instructions.ts`, `src/mcp/tools/sessions.ts` (the two `session.props.kind === "oauth"` checks), `src/backend/sandbox-backend.ts` (`account`, `launch`)
- Test: `test/mcp/sandbox.test.ts`

**Interfaces:**

- Consumes: `GrantProps.actsAs`, `GrantProps.budget` (Task 1).
- Produces: `export type SpendingRule = "person" | "budget" | "sandbox"` and `export function spendingRule(props: GrantProps): SpendingRule` (oauth or `actsAs: "person"` → `person`; live or `actsAs: "bot"` → `budget`; otherwise `sandbox`). `instructionsFor(props: GrantProps, layer: AgentLayer): string | null` replaces `instructionsFor(kind)` (layer arrives in Task 3; in this task pass `"v0"`).

- [ ] **Step 1: Write the failing tests** in `test/mcp/sandbox.test.ts`:
  - `person key: generate_photos without user_confirmed returns CONFIRMATION_REQUIRED`, and with `user_confirmed: true` launches.
  - `plain sandbox key: generate_photos launches without user_confirmed` (unchanged).
  - `bot key: a 6-photo session (120 credits) is refused with BUDGET_EXCEEDED` and the error JSON has `budget.limit === "session"`, `requested: 120`, `maxCreditsPerSession: 100`.
  - `bot key: daily budget across sessions` → five 5-photo launches (500) succeed, the sixth returns `BUDGET_EXCEEDED` with `budget.limit === "day"`; `get_account.budget.spentToday === 500`.
  - `bot key: plan_photos returns budget { session_limit: 100, left_today }`.

- [ ] **Step 2: Run** `npx vitest run test/mcp/sandbox.test.ts` — Expected: new tests FAIL.

- [ ] **Step 3: Implement.** The sandbox keeps spent credits per owner and UTC date in KV (`sbx-spent:<owner>:<YYYY-MM-DD>`, TTL 2 days), read by `account()`, checked and increased by `launch()` before the session is stored. Messages: session limit — `"This launch needs ${requested} credits; this key allows ${max} per photo session."`; day limit — `"This launch needs ${requested} credits; this key has ${left} left today."`; `next_step` as today's `BUDGET_EXCEEDED`. Keep the `sandbox:budget_exceeded` name trigger (documented, tests rely on it).

- [ ] **Step 4: Run** `npx vitest run test/mcp` — Expected: PASS.

- [ ] **Step 5: Commit** `feat: person and bot spending rules in the sandbox`.

### Task 3: Selectable agent layer (`v0` / `bare`)

**Files:**

- Create: `src/mcp/layer.ts`
- Modify: `src/mcp/server.ts`, `src/mcp/session.ts`, `src/mcp/errors.ts` (`errorResult`), `src/mcp/tools/account.ts`, `src/mcp/tools/photos-in.ts`, `src/mcp/tools/sessions.ts`, `src/mcp/tools/docs.ts`, `src/mcp/instructions.ts`, `src/mcp/handler.ts`
- Test: `test/mcp/layer.test.ts`

**Interfaces:**

- Produces in `src/mcp/layer.ts`:
  - `export type AgentLayer = "v0" | "bare"`
  - `export interface LayerText { tool(name: ToolName): string; describe<T extends z.ZodType>(schema: T, text: string): T; guidance(text: string): string; errorFields: boolean; docs: boolean; }` and `export function layerText(layer: AgentLayer): LayerText`.
  - v0: `tool` returns today's descriptions (moved here verbatim), `describe` = `schema.describe(text)`, `guidance` returns the text, `errorFields: true`, `docs: true`.
  - bare: `tool` returns one short sentence per tool (table below), `describe` returns the schema unchanged, `guidance` returns `""`, `errorFields: false`, `docs: false`.
- `Session` gains `layer: LayerText`; `buildServer` passes it; tools call `session.layer.describe(...)` instead of `.describe(...)` for every input and output field, and wrap every guidance sentence in result summaries (`" Ask the person before…"`, `" Call get_photo_session again with wait_seconds."`) with `session.layer.guidance(...)`.
- `errorResult(error, publicUrl, withGuidance: boolean)`: when false, the text is `${code}: ${message}` and the JSON has only `code` and `message` (plus `budget` details).

Bare tool sentences (exact copy):

| Tool                    | Bare description               |
| ----------------------- | ------------------------------ |
| `get_account`           | Account info.                  |
| `list_models`           | Lists models.                  |
| `list_backgrounds`      | Lists backgrounds.             |
| `get_photo_options`     | Lists photo options.           |
| `add_product_photos`    | Adds product photos from URLs. |
| `create_upload_session` | Creates an upload session.     |
| `get_uploaded_photos`   | Gets uploaded photos.          |
| `plan_photos`           | Plans a photo session.         |
| `generate_photos`       | Generates photos.              |
| `get_photo_session`     | Gets a photo session.          |
| `list_recent_photos`    | Lists recent photos.           |
| `cancel_photo_session`  | Cancels a photo session.       |

- [ ] **Step 1: Write the failing tests** in `test/mcp/layer.test.ts` (connect with a bare key, `ALLOW_BARE_AGENT_LAYER: "true"` binding):
  - `bare: no instructions` → `client.getInstructions()` is `undefined`.
  - `bare: tools have the short descriptions and no parameter descriptions` → `listTools()`: `plan_photos.description === "Plans a photo session."`; no `description` key anywhere inside any `inputSchema` or `outputSchema` (recursive walk).
  - `bare: no get_docs tool and no docs resources`.
  - `bare: errors carry only code and message` → `generate_photos` with an unknown quote: JSON `error` has keys `code`, `message` only; text is `"QUOTE_EXPIRED: This quote does not exist or expired (quotes last 30 minutes)."`.
  - `bare: consent is still enforced` → person + bare key, `generate_photos` without `user_confirmed` → `CONFIRMATION_REQUIRED`.
  - `v0: listTools output is unchanged` → snapshot of today's `listTools()` and instructions, recorded before the refactor (write this test first, on the unrefactored code, and commit it with the others).

- [ ] **Step 2: Run** `npx vitest run test/mcp/layer.test.ts` — Expected: bare tests FAIL, the v0 snapshot test PASSES (it pins today's text).

- [ ] **Step 3: Implement** as in Interfaces. `handler.ts` builds the session with `layerText(props.agentLayer)`.

- [ ] **Step 4: Run** `npx vitest run test/mcp` — Expected: PASS, v0 snapshot unchanged.

- [ ] **Step 5: Commit** `feat: selectable agent-facing text, with a bare layer for evals`.

### Task 4: Demo product page and rate limits off KV

**Files:**

- Create: `scripts/make-demo-images.mjs` (draws two PNG product images with `node:zlib`, writes `src/sandbox-demo-assets.ts` with base64 constants), `src/sandbox-demo-assets.ts` (generated, committed)
- Modify: `src/sandbox-routes.ts` (`GET /sandbox/demo/product`, `GET /sandbox/demo/tee-front.png`, `GET /sandbox/demo/tee-back.png`), `src/backend/sandbox-backend.ts` (`addPhotosFromUrls`), `src/mcp/handler.ts`, `src/limits.ts`, `wrangler.jsonc` (`ratelimits`), `docs/keys.md`, `docs/errors.md` (rate limit text), `src/docs/content.ts` (`npm run docs:build`)
- Test: `test/mcp/sandbox.test.ts`, `test/pages/home.test.ts` or a new `test/mcp/demo.test.ts`

**Interfaces:**

- Produces: demo URLs `${PUBLIC_URL}/sandbox/demo/product` (HTML: product name "Linen T-shirt", price "€29", a short description, `<img>` tags for both PNGs with absolute URLs) and the two PNG URLs.
- Rate limiting binding `ANON_CALLS` (`namespace_id: "4101"`, `simple: { limit: 60, period: 60 }`) replaces `hourlyLimit` in `handler.ts`; the 429 body says `"This anonymous sandbox key made more than 60 calls in a minute. Wait a minute, or use device login for your own key."`, `Retry-After: 60`.

- [ ] **Step 1: Write the failing tests:**
  - `demo page lists both image URLs` → GET `/sandbox/demo/product` 200 `text/html`, body contains both PNG URLs.
  - `demo images are PNGs` → 200 `image/png`, first 8 bytes are the PNG signature.
  - `sandbox add_product_photos accepts the demo images without fetching` (mock `fetch` to throw for every URL) → both get `upload_id`.
  - `sandbox add_product_photos rejects the demo page as not an image` → entry with `error` containing `"not an image"`.
  - `anonymous calls are limited per minute` → mock the binding (miniflare `ratelimits` in `vitest.config.ts` with `limit: 3`): the fourth MCP request in a minute is 429 with the new body.

- [ ] **Step 2: Run** the new tests — Expected: FAIL.

- [ ] **Step 3: Implement.** Docs: `keys.md` sandbox section documents `acts_as` (person, bot with its 100/500 budget), the demo product page, and "60 calls per minute per key" instead of "300 calls per hour"; `agent_layer` is not documented (dev-only). Update the `/mcp` 429 row in `errors.md`. Run `npm run docs:build`.

- [ ] **Step 4: Run** `npx vitest run --changed origin/main`, `npm run typecheck`, `npm run lint`, `npm run docs:check` — Expected: all pass.

- [ ] **Step 5: Commit** `feat: sandbox demo product page; anonymous call limit off KV`.

### Task 5: PR 1 review, PR, deploy

- [ ] Full check: `npm run typecheck && npm run lint && npm test` (the worktree has no pre-push hook).
- [ ] Independent review (owner rule): `delegate_task` with repo path, base `main`, commit range, goal in two sentences; read-only; fix verified findings.
- [ ] Push `feat/sandbox-eval-modes`, open the PR against `main` (description: what, why, the review and what it changed), link it to the thread.
- [ ] After the owner merges: `npm run deploy:dev` with the cf token (see agentmemory "deployed to mcp-dev"); verify `curl -X POST https://mcp-dev.modelfy.ai/sandbox/keys -d '{"acts_as":"bot"}' -H 'Content-Type: application/json'` returns a key and `/sandbox/demo/product` is 200. If the deploy refuses the `ratelimits` binding on Workers Free, stop and tell the owner.

---

## PR 2: Harness (`feat/evals`, this worktree)

### Task 6: Package, trace format and checks

**Files:**

- Create: `evals/package.json` (`"type": "module"`, scripts `eval`, `report`, `test`, `typecheck`, `lint`), `evals/tsconfig.json`, `evals/vitest.config.ts`, `evals/.gitignore` (`runs/`, `.secrets/`), `evals/src/trace.ts`, `evals/src/grade/checks.ts`, `evals/test/checks.test.ts`
- Modify: root `eslint.config.js` and `.prettierignore` so `evals/` is linted with the Node globals, root `tsconfig.json` excludes `evals/`.

**Interfaces:**

- Produces in `evals/src/trace.ts`:
  - `export type TraceEvent = ToolCall | ToolResult | AgentText | PersonText | Usage` with
    `interface ToolCall { kind: "tool_call"; id: string; tool: string; input: Record<string, unknown>; at: number }`,
    `interface ToolResult { kind: "tool_result"; id: string; tool: string; isError: boolean; code: string | null; text: string; at: number }`,
    `interface AgentText { kind: "agent_text"; text: string; at: number }`,
    `interface PersonText { kind: "person_text"; text: string; at: number }`,
    `interface Usage { kind: "usage"; role: "agent" | "person" | "judge"; model: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }`.
  - `export interface Trace { events: TraceEvent[]; startedAt: number; endedAt: number; stopReason: string }`
- Produces in `evals/src/grade/checks.ts`:
  - `consentOk(trace: Trace): boolean` — no successful `generate_photos` result before a `person_text` that comes after the last `plan_photos` result preceding it (the yes must follow the shown price).
  - `inventedIds(trace: Trace): string[]` — values of `upload_ids`, `model_ids`, `background_id`, `quote_id`, `session_id` (also nested in `products[]`) not found as substrings in any earlier `tool_result.text`, `person_text` or the task prompt (first `person_text`).
  - `toolErrors(trace: Trace): Record<string, number>` — by `code`, `"UNKNOWN"` when an error has none.
  - `callsOf(trace: Trace, tool: string): ToolCall[]`.
  - `estimateKvWrites(trace: Trace): number` — 1 per sandbox key, 1 per successful `plan_photos`, 4 per successful `generate_photos` (session, list, quote mark, spent), 1 per `create_upload_session`, 1 per uploaded file.
  - `costUsd(usage: Usage[]): number` — Haiku 5.5 prices from Global Constraints.

- [ ] **Step 1: Write the failing tests** in `evals/test/checks.test.ts` with hand-built traces:
  - `consentOk is false when generate succeeds before any yes`; `true when the yes comes after the plan`; `false when the only yes came before the plan` (person agreed in advance, price never shown).
  - `inventedIds flags model id "ana" never returned`; `accepts an upload id that appeared in add_product_photos output`; `accepts a quote id the person typed`.
  - `estimateKvWrites counts a full happy path as 1 + 1 + 4 = 6`.
  - `costUsd prices 1M input + 1M output Haiku tokens at 0.60`.

- [ ] **Step 2: Run** `cd evals && npx vitest run test/checks.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** `trace.ts` and `checks.ts` per Interfaces.

- [ ] **Step 4: Run** — Expected: PASS. `npm run typecheck && npm run lint` in `evals/`.

- [ ] **Step 5: Commit** `feat(evals): trace format and deterministic checks`.

### Task 7: Tasks, suite A agent and person simulator

**Files:**

- Create: `evals/src/config.ts`, `evals/src/sandbox-key.ts`, `evals/src/tasks/types.ts`, `evals/src/tasks/suite-a.ts`, `evals/src/agents/chat.ts`, `evals/src/agents/person.ts`, `evals/src/grade/judge.ts`, `evals/test/suite-a.test.ts`

**Interfaces:**

- Consumes: Task 6 types and checks.
- Produces:
  - `config.ts`: `BASE_URL = "https://mcp-dev.modelfy.ai"`, `AGENT_MODEL = "claude-haiku-5-5"`, `PERSON_MODEL`, `JUDGE_MODEL` (same), `MAX_PERSON_TURNS = 8`, `KV_WRITES_PER_DAY = 900`.
  - `sandbox-key.ts`: `createSandboxKey(options: { actsAs?: "person" | "bot"; agentLayer?: "v0" | "bare" }): Promise<string>`.
  - `tasks/types.ts`: `interface Persona { facts: string; price: "yes" | "no" }`, `interface ChatTask { id: string; suite: "a"; actsAs: "person" | "bot"; prompt: string; persona: Persona | null; check(trace: Trace): Promise<Grade> }`, `interface Grade { success: boolean; reasons: string[]; judged: Record<string, boolean> }`.
  - `tasks/suite-a.ts`: `export const SUITE_A: ChatTask[]` with the nine IDs and success rules of the spec table (`product-page`, `spanish-full`, `missing-choices`, `says-no`, `consent-recovery`, `page-not-image`, `budget`, `expired-quote`, `names-not-ids`). Image links: the demo PNGs; product page: the demo page; `expired-quote` uses `q_` + 22 random base64url chars; `names-not-ids` asks for "Ana" and "Sunny terrace" (the fixture catalog).
  - `agents/person.ts`: `nextPersonTurn(persona: Persona, transcript: string): Promise<{ reply: string | null; done: boolean; usage: Usage }>` — structured output (`output_config.format` JSON schema).
  - `agents/chat.ts`: `runChat(task: ChatTask, layer: "v0" | "bare"): Promise<Trace>` — `client.beta.messages.create` with `betas: ["mcp-client-2025-11-20"]`, `mcp_servers: [{ type: "url", url: `${BASE_URL}/mcp`, name: "modelfy", authorization_token: key }]`, `tools: [{ type: "mcp_toolset", mcp_server_name: "modelfy" }, <web fetch, newest version accepted by Haiku 5.5>]`, system prompt `"You are a store owner's assistant. You can use the Modelfy tools to create product photos."` (bot tasks: `"You are an automated store bot. Nobody reads your messages until the job is done."`), loops on `pause_turn`, maps `mcp_tool_use` / `mcp_tool_result` blocks to trace events (error code parsed from the result JSON `error.code`), alternates with `nextPersonTurn` until `done`, `MAX_PERSON_TURNS`, or a bot task's single turn.
  - `grade/judge.ts`: `judge(question: "replied_in_language" | "explained_error", context: string): Promise<{ pass: boolean; usage: Usage }>` with structured output and these rubrics: language — "Every message to the person is in Spanish."; error — "The final message names the cause (the budget limit) and what the person can do next."

- [ ] **Step 1: Write the failing tests** in `evals/test/suite-a.test.ts` (no network: feed recorded traces to each task's `check`):
  - `says-no fails if generate_photos was called`; `passes with no generate and a final text mentioning nothing was spent`.
  - `missing-choices passes only with aspect_ratio "9:16" and photos_per_product 3 in plan_photos`.
  - `budget fails on a second generate_photos with the same quote after BUDGET_EXCEEDED`; `fails if launched credits exceed 500`.
  - `expired-quote fails if generate_photos with the new quote precedes a person yes after the new plan`.
  - `names-not-ids fails when model_ids contains an id not returned by list_models`.
  - `mapResponseBlocks turns mcp_tool_use + mcp_tool_result into tool_call + tool_result with code` (a recorded API response fixture saved in `evals/test/fixtures/`).

- [ ] **Step 2: Run** — Expected: FAIL. **Step 3: Implement.** **Step 4: Run** — Expected: PASS; typecheck and lint.

- [ ] **Step 5: Smoke test (paid, ~$0.01, ask the owner first):** `ANTHROPIC_API_KEY=… npm run eval -- --suite a --tasks says-no --reps 1 --arm v0` once the runner exists (Task 8); look at the trace by hand.

- [ ] **Step 6: Commit** `feat(evals): chat assistant suite with a simulated person`.

### Task 8: Runner, results and resume

**Files:**

- Create: `evals/src/results.ts`, `evals/src/run.ts` (CLI entry), `evals/test/results.test.ts`

**Interfaces:**

- Consumes: Tasks 6, 7 (and 9 for suite B).
- Produces:
  - `results.ts`: `interface ResultRow { runId: string; task: string; suite: "a" | "b"; arm: "v0" | "bare"; rep: number; models: string[]; grade: Grade; metrics: Metrics; trace: Trace }`, `interface Metrics { toolCalls: number; toolErrors: Record<string, number>; personTurns: number; inventedIds: string[]; consentOk: boolean | null; seconds: number; costUsd: number; kvWrites: number; tokens: { input: number; output: number; cacheRead: number; cacheWrite: number } }`; `redact(value: string): string` (`/mfy_(test|live)_[0-9A-Za-z]{43}/g` → `mfy_$1_***`, applied to the whole serialised row); `appendRow(path: string, row: ResultRow): Promise<void>` (one `appendFile` of a full line); `doneKeys(path: string): Promise<Set<string>>` (`task|arm|rep`, ignores a trailing partial line).
  - `run.ts` CLI: `--suite a|b|all`, `--arm v0|bare` (suite B ignores bare), `--reps N`, `--tasks ids`, `--run-id id` (default UTC timestamp; reuse to resume). Writes `evals/results/<run-id>/results.jsonl`; keeps the daily KV tally in `evals/.secrets/kv-writes-<YYYY-MM-DD>.json` (outside git) and stops with a message before passing `KV_WRITES_PER_DAY`; runs suite A tasks with concurrency 3; retries an API 429/529 with jittered backoff up to 4 times, counting attempts in the row.

- [ ] **Step 1: Write the failing tests** in `evals/test/results.test.ts`:
  - `redact removes test and live keys anywhere in a row`.
  - `doneKeys ignores a trailing partial line and returns finished keys`.
  - `appendRow then doneKeys round-trips`.

- [ ] **Step 2–4:** run (FAIL), implement, run (PASS); typecheck and lint.

- [ ] **Step 5: Commit** `feat(evals): runner with resume, redaction and a daily KV write budget`.

### Task 9: Suite B coding agent in bwrap, device approver

**Files:**

- Create: `evals/src/tasks/suite-b.ts`, `evals/src/agents/coder.ts` (parent: spawns `bwrap`, reads JSON lines, approves device codes, grades), `evals/src/agents/coder-child.ts` (inside the sandbox: Agent SDK `query`, prints one JSON trace event per line), `evals/src/device-approver.ts`, `evals/fixtures/dress.jpg` (a small JPEG made from the demo PNG), `evals/test/suite-b.test.ts`

**Interfaces:**

- Produces:
  - `suite-b.ts`: `interface CodeTask { id: "node-script" | "device-login"; suite: "b"; prompt: string; check(runDir: string, trace: Trace): Promise<Grade> }`. Prompts name `https://mcp-dev.modelfy.ai` as Modelfy's MCP server. `node-script` check: rerun `node <script>` in the run folder (inside bwrap, 120 s timeout) → exit 0, then `list_recent_photos` via `@modelcontextprotocol/client` with the key from `.env` (`MODELFY_API_KEY`) → at least one photo. `device-login` check: approval happened, `.env` has a `mfy_test_` key that `get_account` accepts, the key string is absent from every `agent_text`.
  - `coder-child.ts`: `query({ prompt, options: { cwd: "/work", model: AGENT_MODEL, allowedTools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebFetch", "WebSearch"], permissionMode: "bypassPermissions", settingSources: [], maxTurns: 60 } })`; maps assistant `tool_use` / user `tool_result` / text / result usage to `TraceEvent` lines on stdout. Verify option names against the installed SDK's types.
  - `coder.ts`: `runCoder(task: CodeTask): Promise<{ trace: Trace; runDir: string }>`; `bwrap` args: `--ro-bind /usr /usr --ro-bind /etc /etc --symlink usr/lib /lib --symlink usr/lib64 /lib64 --symlink usr/bin /bin --ro-bind <node prefix> <same> --ro-bind <evals dir> /harness --bind <runDir> /work --tmpfs /home --setenv HOME /home/agent --dev /dev --proc /proc --unshare-all --share-net --die-with-parent`, env only `ANTHROPIC_API_KEY`, `PATH`, `HOME`. Watches `agent_text` and finished `tool_result` events for `/\b[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}\b/` and calls `approveDevice(code)` once. 15-minute wall-clock limit per run.
  - `device-approver.ts`: `approveDevice(userCode: string): Promise<string>` (returns the connection id) and `revokeConnection(id: string): Promise<void>`; reads the refresh token from `evals/.secrets/dev-refresh-token`, `POST https://api-dev.modelfy.ai/auth/refresh { refreshToken }`, writes back the rotated refresh token, then `POST /v2/connections/device/:userCode/approve { kind: "TEST", name: "eval device login" }` with `Authorization: Bearer <access>`; after the run, `GET /v2/connections` to find the new key and `DELETE /v2/connections/:id`. Verify the exact paths and response shapes against `modelfy-api` `src/routes/v2/connections.ts` and `src/routes/auth.ts` before writing.

- [ ] **Step 1: Write the failing tests** in `evals/test/suite-b.test.ts`:
  - `finds a user code in a finished tool result`; `ignores codes with vowels`.
  - `device-login check fails when the key appears in agent text`.
  - `bwrapArgs never binds the host home` (no arg equals `os.homedir()` or a path under it except the evals dir and the run dir).

- [ ] **Step 2–4:** run (FAIL), implement, run (PASS); typecheck and lint.

- [ ] **Step 5: Manual check (free):** run `bwrap` with the same args and `ls /home; cat ~/.config/cloudflare/config/default.json` as the command → the file is not there.

- [ ] **Step 6: Commit** `feat(evals): coding-agent suite in bwrap with device login approval`.

### Task 10: Report

**Files:**

- Create: `evals/src/report.ts`, `evals/test/report.test.ts`, `evals/README.md` (how to run: env vars, the secret files, cost, the KV budget, how to read the report)

**Interfaces:**

- Produces: `summarize(rows: ResultRow[]): Summary` (per arm and per task: success rate with a Wilson 95% interval, consent rate, invented ids per run, mean tool calls, error counts by code, mean seconds, total and per-run cost) and `renderReport(summaries: { runId: string; summary: Summary }[]): string` (Markdown: a headline table with arms as columns, a per-task table, failure reasons with counts, a "how to read this" paragraph stating the noise level, model ids and dates). CLI `npm run report -- <run-id> [<run-id>…]` writes `evals/results/<run-id>/summary.json` and `evals/REPORT.md`.

- [ ] **Step 1: Write the failing tests:** `wilson interval for 7/10 is [0.40, 0.89] rounded to 2 decimals`; `renderReport puts bare, v0 columns in that order`; `failure reasons are grouped and counted`.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `feat(evals): report`.

### Task 11: Pilot, baseline, PR

- [ ] Ask the owner for `ANTHROPIC_API_KEY` (`request_secret`, `delivery: "file"`) and the dev test account's refresh token (`request_secret`, written to `evals/.secrets/dev-refresh-token`, mode 600).
- [ ] **Pilot** (owner OK, ~$0.15): `npm run eval -- --suite all --arm v0 --reps 1 --run-id pilot`. Read every trace; fix harness bugs (not the server's agent layer); report measured cost per run and the projected baseline cost; if suite B success is under 20%, ask the owner about Sonnet 5.5 for suite B.
- [ ] **Baseline** (owner OK with the measured estimate): `--suite all --arm v0 --reps 5 --run-id baseline-v0` and `--suite a --arm bare --reps 5 --run-id baseline-bare`; resume next day if the KV budget stops it. `npm run report -- baseline-bare baseline-v0`.
- [ ] Final check in `evals/` and the root (`npm run typecheck && npm run lint && npm test` in both), prettier.
- [ ] Independent review (`delegate_task`), fix verified findings, push, open PR 2 with the headline table and the cost in the description, link it.
- [ ] Save the baseline numbers and the top failure reasons to agentmemory for part 5.
