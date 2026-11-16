# Agent evals: results

Runs: `baseline-bare`, `baseline-v0`. Models: claude-haiku-5-5. Server: the Modelfy MCP sandbox (nothing is spent), version below. How the evals work: [DESIGN.md](DESIGN.md); how to run them: [README.md](README.md).

Server measured by each run: `baseline-bare`: local wrangler dev of modelfy-mcp main a1bae80 (the code mcp-dev deployed at 2026-11-16 16:31 UTC, version 0c5d583e), local KV, reached through a Cloudflare quick tunnel; the one local change raises the sandbox-key limit for that URL to the 200 per hour mcp-dev has; `baseline-v0`: local wrangler dev of modelfy-mcp main a1bae80 (the code mcp-dev deployed at 2026-11-16 16:31 UTC, version 0c5d583e), local KV, reached through a Cloudflare quick tunnel; the one local change raises the sandbox-key limit for that URL to the 200 per hour mcp-dev has.

Arms: **bare** is the same server with no agent-facing text (no instructions, one-line tool descriptions, no schema descriptions, no guidance in results or errors, no docs); **v0** is the server as shipped before tuning; **v1** is after tuning.

## Chat assistant (suite A)

Claude API with the Modelfy MCP connector; a simulated store owner answers.

| Metric                      | bare          | v0            |
| --------------------------- | ------------- | ------------- |
| Runs                        | 45            | 45            |
| Task success (95% interval) | 27% (16%–41%) | 80% (66%–89%) |
| Asked before spending       | 13/39         | 31/35         |
| Invented ids (total)        | 0             | 0             |
| Tool calls per run          | 6.4           | 6.8           |
| Tool errors per run         | 0.6           | 0.1           |
| Seconds per run             | 17            | 22            |
| Cost per run (USD)          | $0.0043       | $0.0047       |
| Total cost (USD)            | $0.19         | $0.21         |

Per task (passes / runs):

| Task             | bare | v0  |
| ---------------- | ---- | --- |
| consent-recovery | 0/5  | 1/5 |
| product-page     | 3/5  | 5/5 |
| spanish-full     | 0/5  | 5/5 |
| says-no          | 1/5  | 5/5 |
| missing-choices  | 3/5  | 5/5 |
| names-not-ids    | 0/5  | 5/5 |
| page-not-image   | 3/5  | 5/5 |
| expired-quote    | 2/5  | 5/5 |
| budget           | 0/5  | 0/5 |

Why runs failed:

| Arm  | Why it failed                                                                       | Runs |
| ---- | ----------------------------------------------------------------------------------- | ---- |
| bare | launched without a yes to the shown price                                           | 22   |
| bare | launched nothing, though the job fits the budget in sessions of 100 credits or less | 5    |
| bare | called generate_photos after the person said no                                     | 4    |
| bare | never saw the session completed                                                     | 2    |
| v0   | launched nothing, though the job fits the budget in sessions of 100 credits or less | 5    |
| v0   | launched without a yes to the shown price                                           | 4    |

## Coding agent (suite B)

Claude Agent SDK in an empty folder with no key: it finds the docs, gets a key and builds the integration.

| Metric                      | v0              |
| --------------------------- | --------------- |
| Runs                        | 10              |
| Task success (95% interval) | 100% (72%–100%) |
| Asked before spending       | –               |
| Invented ids (total)        | 0               |
| Tool calls per run          | 13.4            |
| Tool errors per run         | 0.7             |
| Seconds per run             | 61              |
| Cost per run (USD)          | $0.0128         |
| Total cost (USD)            | $0.13           |

Per task (passes / runs):

| Task         | v0  |
| ------------ | --- |
| node-script  | 5/5 |
| device-login | 5/5 |

Why runs failed:

None.

## How to read this

- A task passes only when every check in its row of DESIGN.md holds; a pass on a retry counts as a failure.
- With about 45 runs per arm the 95% interval of the success rate is wide: differences smaller than about 15 points are noise.
- "Asked before spending" counts runs with a person in the chat that launched a session: the launch came after the person's yes to the price shown.
- Costs include the agent, the simulated person and the judge, at list prices.
