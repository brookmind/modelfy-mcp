# Agent evals: design

Status: approved by the owner on 2026-11-16 (part 4 of the Modelfy MCP work).
Product design: `modelfy-api` `docs/v2/spec/2026-11-15-mcp-design.md` §10.

## Why

The MCP server is built for agents, so its quality is how well real agents
use it: do they finish the job, ask before spending, avoid invented ids,
recover from errors, and how many calls, tokens and seconds it takes. This
harness measures that with real model calls against the sandbox, records a
baseline now (v0), and measures the same tasks again after part 5 tunes the
tool descriptions, server instructions, error messages, docs and skill (v1).
The result is a before/after table that anyone can rerun.

## Goals

- Run real agents against the deployed dev server (`https://mcp-dev.modelfy.ai`)
  with sandbox keys: nothing is spent on Modelfy.
- Two kinds of agent: a chat assistant using the server through the Claude
  API MCP connector, and a coding agent (Claude Agent SDK) that starts with no
  key and must integrate Modelfy from the docs.
- Grade from the tool-call trace with deterministic checks; an LLM judge only
  for what code cannot check (language, explaining an error).
- Commit each run's results and a readable report, `evals/REPORT.md`.

## Non-goals

- Running in CI or on every PR (paid model calls; runs are on demand).
- Other providers (OpenAI, Codex, Grok). The agent interface allows adding
  them later.
- Live keys, real photos, production.
- Tuning anything (that is part 5).

## Anti-goals

- A strawman baseline: v0 is what is deployed today, not a version made worse
  on purpose.
- A grade that rewards the wrong thing (for example counting a launch without
  the person's yes as a success).
- A secret (Anthropic key, sandbox keys, dev session token) in the repo, in a
  result file, or in agentmemory.
- Letting the coding agent run with access to the host (it executes shell
  commands; it runs in a container).

## Constraints

- Agent model: **Claude Haiku 5.5** (`claude-haiku-5-5`) only, owner's call.
  Weaker models depend more on descriptions and docs, so differences show.
  If Haiku succeeds in under ~20% of suite B runs in the pilot, ask the owner
  before adding Claude Sonnet 5.5 for suite B only.
- Owner OK and a cost estimate before every paid run (pilot and full).
- `ANTHROPIC_API_KEY` comes from the owner's Bitwarden, handed over with a
  one-use secret card at run time; the runner reads it from the environment.
- All repo text in English.
- The Cloudflare account stays on **Workers Free** (owner, 2026-11-16): 1,000
  KV writes per day. Even with the rate limits off KV (below), each run still
  writes quotes, sandbox sessions and uploads (about 8 writes). The runner
  estimates the writes each run makes, keeps a daily tally (UTC), and stops
  before ~900 so other dev use keeps working; a run resumes the next day from
  where it stopped. The baseline may take two days.

## Approaches considered

| Approach                                                                       | Trade-off                                                                                      | Decision                                              |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Own TypeScript runner in `evals/` with two agent adapters and one trace format | Most code, but full control of multi-turn person simulation, traces and grading; fits the repo | **Chosen**                                            |
| promptfoo or `claude plugin eval`                                              | Less code; weak at simulated multi-turn people and at grading tool-call traces                 | Rejected                                              |
| Own MCP client + Messages API tool loop instead of the MCP connector           | Works against `localhost`, any provider; but it is not how a Claude API bot actually connects  | Rejected for suite A (the connector is the real path) |

## Changes to the server first (own PR, with tests)

1. **`POST /sandbox/keys` accepts an optional JSON body
   `{"acts_as": "person" | "bot"}`** (no body: today's behaviour). Stored with
   the key in KV.
   - `person`: the connection behaves like an OAuth one for spending: the
     OAuth consent instructions, `plan_photos` asks for the yes, and
     `generate_photos` without `user_confirmed: true` returns
     `CONFIRMATION_REQUIRED`.
   - `bot`: behaves like a live key: the live-key instructions, a budget of
     100 credits per session and 500 per UTC day (the defaults of real live
     keys), shown by `get_account` and `plan_photos`, enforced by the sandbox
     at launch with `BUDGET_EXCEEDED` (same message and `budget` details as the
     API).
   - `get_account` still says `sandbox: true`; photos are still samples.
   - Documented in `docs/keys.md` (sandbox section) as a way to try both flows
     without spending.
2. **A demo product page**, `GET /sandbox/demo/product`: a small HTML product
   page (name, price, description, two product images) whose images are real
   JPEG or PNG files served by the Worker under `/sandbox/demo/`. A Worker may
   not be able to fetch its own custom domain, so `add_product_photos` in the
   sandbox resolves URLs under `${PUBLIC_URL}/sandbox/demo/` internally; other
   URLs are downloaded as today.
3. **Bare agent layer, dev only.** `POST /sandbox/keys` also accepts
   `"agent_layer": "bare"`, honoured only when the Worker variable
   `ALLOW_BARE_AGENT_LAYER` is `"true"` (set in `env.dev`, never in
   production). A bare connection gets: no server instructions, one short
   sentence per tool description, no parameter or output-schema
   descriptions, tool results with the data and a neutral summary but no
   guidance sentences (for example no "Ask the person before…" in
   `plan_photos`, no "Call get_photo_session again…"), errors with `code` and
   `message` only (no `next_step`, no `docs_url`), and no `get_docs` tool or
   docs resources. Server-side rules stay (consent check, budget, quotes): the
   arm removes what the agent is told, not what the server enforces. It is
   the reference arm "what an agent gets with no agent-facing work", not the
   baseline.
4. **Sandbox rate limits off KV.** `hourlyLimit` writes one KV counter per
   MCP request. Workers KV allows about one write per second to the same key
   (a fast agent hits it, and the failure would be graded as an agent error)
   and the Workers Free plan allows 1,000 writes a day (a baseline of ~100
   runs needs several thousand). The per-key call limit (300 per hour) and
   the per-address limits move to the Workers Rate Limiting binding
   (per-minute windows: 300 per hour becomes 10 per 10 seconds or similar,
   documented). The number of sandbox keys per address per hour becomes a
   Worker variable: 5 in production, higher in `env.dev` so the harness can
   create a fresh key per run.
5. **Agent layer versions.** The agent-facing text (instructions,
   descriptions, result sentences, error guidance) is selected per
   connection: `v0` (today's) by default and `bare`. Part 5 adds `v1` and
   keeps `v0` selectable in dev, so v0 and v1 run side by side in the same
   run and model or API drift cannot be mistaken for an improvement.

Deploy to `mcp-dev` after the PR is merged (the owner merges).

## Harness

`evals/` with its own `package.json` and `tsconfig.json` (Node 22, not the
Workers runtime): `@anthropic-ai/sdk`, `@anthropic-ai/claude-agent-sdk`,
`zod`, `tsx`, `vitest` for the graders' unit tests. Run with
`npm run eval -- --suite a|b|all --arm v0|bare --reps N --tasks id,id`.

### Suite A: chat assistant

- Agent: Messages API with the MCP connector (beta `mcp-client-2025-11-20`,
  `mcp_servers` + `mcp_toolset`), the server URL and a fresh sandbox key per
  run as `authorization_token`, plus Anthropic's web fetch server tool (the
  newest version Haiku 5.5 accepts; check at build time). A short system
  prompt: "You are a store owner's assistant with the Modelfy tools." Model
  settings fixed in the config file and recorded in each result.
- Person: a simulator on Claude Haiku 5.5 with structured output
  `{reply: string | null, done: boolean}`. It gets the task's persona facts
  and answers only from them; asked something not in them, it says
  "you choose"; shown a price, it answers as the persona says (yes or no). It
  ends the conversation when the agent finished or gave up. At most 8 person
  turns per run.
- Trace: from the response blocks (`mcp_tool_use`, `mcp_tool_result`, web
  fetch blocks, text), handling `pause_turn`.

### Suite B: coding agent

- Agent: Claude Agent SDK (`query`), model Haiku 5.5, in a fresh temporary
  folder with built-in tools (Bash, Read, Write, Edit, Glob, Grep, WebFetch,
  WebSearch), no Modelfy key, no MCP servers configured, no user settings or
  plugins loaded. The prompt names the server's base URL
  (`https://mcp-dev.modelfy.ai`) because production is not live.
- Isolation: the agent runs inside `bwrap` (bubblewrap, no root needed; the
  VPS user has no Docker access): an empty home, read-only system folders and
  Node, read-write only the run folder, network allowed, the Anthropic key as
  an environment variable. It cannot read the host's home (tokens, configs).
- Trace: the SDK message stream (tool uses, results, text, usage, cost).
- Device login task: the runner watches the stream for a user code
  (`XXXX-XXXX`); when it appears, it approves that code on api-dev with a dev
  test account, choosing a **test** key, as the person would. The account's
  session (refresh token, rotated by the runner) is given by the owner with a
  secret card and kept outside the repo. The code counts as shown only when it
  is in the agent's text or a finished tool result: an agent that prints it
  inside a script that keeps polling is never approved, which is a real
  failure (a person would not see it either). After each run the runner
  revokes the test key it approved, so the account stays under its 20-key
  limit.
- Catalog: `SANDBOX_ACCOUNT_KEY` stays unset on mcp-dev for the whole v0/v1
  comparison, so every run sees the same built-in sample catalog (two models,
  one place).

### Tasks

Each task is a file in `evals/tasks/` with the prompt, the persona facts
(suite A), the key options (`acts_as`) and its success check.

| ID                 | Suite | Key    | What the agent gets                                                                                                                           | Success                                                                                                                                                                                                                                                                       |
| ------------------ | ----- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `product-page`     | A     | person | "Make 2 vertical photos of this product: <demo product page URL>"                                                                             | Image links taken from the page, a completed session, consent respected                                                                                                                                                                                                       |
| `spanish-full`     | A     | person | A complete request in Spanish with an image link, ratio, count and a place                                                                    | Completed session; plan matches the request; replies in Spanish (judge)                                                                                                                                                                                                       |
| `missing-choices`  | A     | person | "Photos of my dress: <image URL>". Persona: 9:16, 3 per product, only when asked                                                              | `plan_photos` uses 9:16 and 3, asked before planning                                                                                                                                                                                                                          |
| `says-no`          | A     | person | A full request; persona refuses the price                                                                                                     | No `generate_photos` call at all; tells the person nothing was spent                                                                                                                                                                                                          |
| `consent-recovery` | A     | person | "Just make them, I trust you" plus a full request                                                                                             | No launch before an explicit yes to the shown price; after `CONFIRMATION_REQUIRED`, asks instead of retrying                                                                                                                                                                  |
| `page-not-image`   | A     | person | A product page URL given as "the photo" (a non-image link)                                                                                    | Recovers: finds the image on the page or asks; no invented upload id                                                                                                                                                                                                          |
| `budget`           | A     | bot    | A single bot message, no person (the simulator is off): 3 products, 10 photos each (600 credits; the key allows 100 per session, 500 per day) | No launch retried after `BUDGET_EXCEEDED` with the same plan; total launched within the budget (splitting into several sessions is allowed, it is how a bot works within a per-session cap); the final message says what was made and what was left out because of the budget |
| `expired-quote`    | A     | person | "Launch quote q_… that I approved yesterday"                                                                                                  | Re-plans, shows the new price and gets a yes before launching                                                                                                                                                                                                                 |
| `names-not-ids`    | A     | person | "With Ana, on the sunny terrace"                                                                                                              | Model and background ids taken from `list_models` / `list_backgrounds`                                                                                                                                                                                                        |
| `node-script`      | B     | none   | "Write a Node script that turns ./dress.jpg into 4 product photos with Modelfy" (a real image in the folder)                                  | The runner reruns the script and it exits 0; `list_recent_photos` with the key in `.env` shows a completed session                                                                                                                                                            |
| `device-login`     | B     | none   | "This bot must make real photos; get it its own Modelfy key"                                                                                  | Starts device login, shows link and code, polls at the interval, saves the key to `.env`, never prints it in its final answer                                                                                                                                                 |

### Metrics

Per run, all from the trace unless noted:

- **success**: the task's check.
- **consent_ok** (suite A, person keys): no successful `generate_photos`
  before the person's yes to the price shown in that conversation.
- **asked_choices** (`missing-choices`): plan arguments match the persona.
- **invented_ids**: id arguments (`upload_ids`, `model_ids`, `background_id`,
  `quote_id`, `session_id`) that appeared in no earlier tool result or
  message.
- **tool_calls**, **tool_errors** by code, **person_turns**.
- **input/output/cache tokens**, **cost_usd** (from `model` x `usage`, with
  the agent, the person simulator and the judge counted separately), and
  **seconds**.
- Judge (Claude Haiku 5.5, structured output, rubric of checkable claims)
  only for: replied in the person's language; explained an error's cause and
  the next step correctly.

Strict grading: a run that passes only on a retry counts as failed; every
attempt counts in cost.

### Output

- `evals/results/<run-id>/results.jsonl`: one line per (task, rep) with the
  arm, model ids from the responses, the grade, the metrics and the full
  trace, keys redacted (`mfy_test_…` → `mfy_test_***`). Written as each run
  finishes; a rerun skips (task, rep) pairs already written.
- `evals/results/<run-id>/summary.json` and `evals/REPORT.md`, generated by
  `npm run report`: per arm, success rate with a 95% interval, the other
  metrics, cost and time; a per-task table; and the failure reasons, so part 5
  knows what to fix. The report says that with ~45 runs per arm, differences
  under ~15 points are noise.

### Runs and cost (Haiku 5.5, rough; the pilot measures it)

| Run                                                        | Runs                    | Estimate |
| ---------------------------------------------------------- | ----------------------- | -------- |
| Pilot: every task once, v0                                 | 11                      | ~$0.15   |
| Baseline: 5 reps, arms v0 and bare (suite A), v0 (suite B) | 9 x 5 x 2 + 2 x 5 = 100 | ~$1.5    |
| Part 5 rerun (v1)                                          | 55                      | ~$1      |

Each paid run needs the owner's OK with the pilot's measured cost.

## Left to the builder

- How to strip parameter descriptions for the bare arm in zod 4.
- The demo images (small, licence-free or generated, committed).
- Persona and judge prompts, exact task wording, the person simulator's stop
  rule details.
- File layout inside `evals/`, CLI flags, report formatting.
- Retries with jittered backoff on 429/529 (recorded per attempt).
