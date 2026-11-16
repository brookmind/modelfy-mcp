# Agent evals

Real agents run real tasks against the Modelfy MCP server's sandbox on `https://mcp-dev.modelfy.ai`, and the harness grades what they did from the tool-call trace. Nothing is spent on Modelfy; the model calls cost money (see [Cost](#cost)). Design and task list: [DESIGN.md](DESIGN.md). Latest results: [REPORT.md](REPORT.md).

## Two kinds of agent

| Suite             | Agent                                                                                                                              | Starts with                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| A, chat assistant | Claude API with the MCP connector and web fetch, plus a simulated person (Claude Haiku 5.5) who answers only from the task's facts | A fresh sandbox key that acts as a person in a chat (`acts_as: "person"`) or as a budgeted bot (`acts_as: "bot"`) |
| B, coding agent   | Claude Agent SDK in an empty folder, inside `bwrap`                                                                                | No key, no MCP config: it must find the docs and get a key itself                                                 |

Arms: `v0` is the server as shipped; `bare` (suite A only) is the same server with no agent-facing text, a reference for what the tool descriptions, instructions and docs are worth.

## Run

```sh
cd evals
npm ci --legacy-peer-deps
export ANTHROPIC_API_KEY=…            # never commit it
npm run eval -- --suite a --arm v0 --reps 1 --run-id pilot
npm run eval -- --suite all --arm v0 --reps 5 --run-id baseline-v0
npm run eval -- --suite a --arm bare --reps 5 --run-id baseline-bare
# after tuning, against the tuned server (EVALS_BASE_URL)
npm run eval -- --suite all --arm v1 --reps 5 --run-id tuned-v1
npm run report -- baseline-bare baseline-v0 tuned-v1
```

- `--arm`: `bare` strips all agent-facing text, `v0` is the server as first shipped, `v1` the server after tuning (same sandbox key as v0; the server measured differs, recorded in each run's `meta.json`).

- `--tasks id,id` runs only some tasks; `--concurrency N` (default 3) runs N at a time.
- Reuse `--run-id` to resume: finished (task, arm, rep) runs are skipped, and a run that crashed is tried again.
- Results go to `results/<run-id>/results.jsonl` (one line per run with the grade, the metrics and the whole trace; Modelfy and Anthropic keys are redacted).
- Write the server version the run measured in `results/<run-id>/meta.json` (`{"server": "mcp-dev Worker version …"}`; `npx wrangler deployments list --env dev` shows it). The report prints it: a run is only comparable with another on the same version, or as a before/after.
- `npm run regrade -- <run-id>` grades stored chat runs again with the current graders (only the judge is called), for a grader fix that must not need new agent runs. Commit the results before and after, so the change is visible.

### Suite B needs

- `bwrap` (bubblewrap) that can create user namespaces. On Ubuntu 24.04 that needs an AppArmor profile for `/usr/bin/bwrap` with `userns,` (the default restricts it).
- `slirp4netns` (`apt install slirp4netns`): the sandbox's own network, internet only, without the host's loopback.
- For `device-login`: the refresh token of a dev test account in `.secrets/dev-refresh-token` (mode 600, outside git). The harness plays the person: it approves the device code with a **test** key and revokes that key after the run.

## The dev Worker's KV budget

The dev Worker runs on Workers Free (1,000 KV writes a day). The runner estimates the writes of each run, keeps a daily tally in `.secrets/`, and stops before 900; resume the next day with the same `--run-id`.

## Cost

Claude Haiku 5.5 at list prices: suite A runs cost about a cent or less each, suite B runs a few cents. `REPORT.md` shows the measured cost per run. Every paid run needs the owner's OK.

## Develop

```sh
npm test            # graders, results, report (no network, no model calls)
npm run typecheck && npm run lint
```
