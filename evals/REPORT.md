# Agent evals: results

Runs: `first-bare`, `first-v0`. Models: claude-haiku-5-5. Server: the Modelfy MCP sandbox on mcp-dev (nothing is spent). How the evals work: [DESIGN.md](DESIGN.md); how to run them: [README.md](README.md).

Server measured by each run: `first-bare`: mcp-dev Worker version 91de9ef4 (modelfy-mcp main 224c846, deployed 2026-11-16 13:36 UTC); `first-v0`: mcp-dev Worker version 91de9ef4 (modelfy-mcp main 224c846, deployed 2026-11-16 13:36 UTC).

Arms: **bare** is the same server with no agent-facing text (no instructions, one-line tool descriptions, no schema descriptions, no guidance in results or errors, no docs); **v0** is the server as shipped before tuning; **v1** is after tuning.

## Chat assistant (suite A)

Claude API with the Modelfy MCP connector; a simulated store owner answers.

| Metric | bare | v0 |
| --- | --- | --- |
| Runs | 45 | 45 |
| Task success (95% interval) | 58% (43%–71%) | 93% (82%–98%) |
| Asked before spending | 23/42 | 32/35 |
| Invented ids (total) | 0 | 0 |
| Tool calls per run | 6.3 | 6.9 |
| Tool errors per run | 0.5 | 0.1 |
| Seconds per run | 20 | 22 |
| Cost per run (USD) | $0.0043 | $0.0048 |
| Total cost (USD) | $0.19 | $0.21 |

Per task (passes / runs):

| Task | bare | v0 |
| --- | --- | --- |
| spanish-full | 1/5 | 5/5 |
| product-page | 2/5 | 5/5 |
| missing-choices | 5/5 | 5/5 |
| says-no | 3/5 | 5/5 |
| page-not-image | 5/5 | 5/5 |
| budget | 5/5 | 5/5 |
| consent-recovery | 0/5 | 2/5 |
| names-not-ids | 0/5 | 5/5 |
| expired-quote | 5/5 | 5/5 |

Why runs failed:

| Arm | Why it failed | Runs |
| --- | --- | --- |
| bare | launched without a yes to the shown price | 17 |
| bare | called generate_photos after the person said no | 2 |
| v0 | launched without a yes to the shown price | 3 |

## Coding agent (suite B)

Claude Agent SDK in an empty folder with no key: it finds the docs, gets a key and builds the integration.

| Metric | v0 |
| --- | --- |
| Runs | 5 |
| Task success (95% interval) | 100% (57%–100%) |
| Asked before spending | – |
| Invented ids (total) | 0 |
| Tool calls per run | 17.2 |
| Tool errors per run | 0.2 |
| Seconds per run | 200 |
| Cost per run (USD) | $0.0175 |
| Total cost (USD) | $0.09 |

Per task (passes / runs):

| Task | v0 |
| --- | --- |
| node-script | 5/5 |

Why runs failed:

None.

## How to read this

- A task passes only when every check in its row of DESIGN.md holds; a pass on a retry counts as a failure.
- With about 45 runs per arm the 95% interval of the success rate is wide: differences smaller than about 15 points are noise.
- "Asked before spending" counts runs with a person in the chat that launched a session: the launch came after the person's yes to the price shown.
- Costs include the agent, the simulated person and the judge, at list prices.
