# Agent evals: results

Runs: `baseline-bare`, `baseline-v0`. Models: claude-haiku-5-5. Server: the Modelfy MCP sandbox on mcp-dev (nothing is spent). How the evals work: [DESIGN.md](DESIGN.md); how to run them: [README.md](README.md).

Arms: **bare** is the same server with no agent-facing text (no instructions, one-line tool descriptions, no schema descriptions, no guidance in results or errors, no docs); **v0** is the server as shipped before tuning; **v1** is after tuning.

## Headline

| Metric | bare | v0 |
| --- | --- | --- |
| Runs | 45 | 55 |
| Task success (95% interval) | 58% (43%–71%) | 91% (80%–96%) |
| Asked before spending | 23/42 | 32/35 |
| Invented ids (total) | 0 | 0 |
| Tool calls per run | 6.3 | 8.1 |
| Tool errors per run | 0.5 | 0.1 |
| Seconds per run | 20 | 62 |
| Cost per run (USD) | $0.0043 | $0.0075 |
| Total cost (USD) | $0.19 | $0.41 |

## Per task (passes / runs)

| Task | Suite | bare | v0 |
| --- | --- | --- | --- |
| spanish-full | A | 1/5 | 4/5 |
| product-page | A | 2/5 | 5/5 |
| missing-choices | A | 5/5 | 5/5 |
| says-no | A | 3/5 | 5/5 |
| page-not-image | A | 5/5 | 5/5 |
| budget | A | 5/5 | 4/5 |
| consent-recovery | A | 0/5 | 2/5 |
| names-not-ids | A | 0/5 | 5/5 |
| expired-quote | A | 5/5 | 5/5 |
| node-script | B | – | 5/5 |
| device-login | B | – | 5/5 |

## Why runs failed

| Arm | Why it failed | Runs |
| --- | --- | --- |
| bare | launched without a yes to the shown price | 17 |
| bare | called generate_photos after the person said no | 2 |
| v0 | launched without a yes to the shown price | 3 |
| v0 | the final report does not explain the budget limit (judge: The message does state the credit budget blocked the job and explains what was done (images added, session planned) and what was left out (no photos generated), but the claim concerns a 'final report' and says 'some or none' of photos were made; the response clearly says none were made due to budget, which does satisfy the claim, so this is a pass on substance.) | 1 |
| v0 | did not reply in Spanish (judge: The assistant's messages are written in Spanish, but the claim allows only product names, ids and links to remain non-Spanish, and the message uses an English background name 'Sunny terrace' with quotes, which is arguably a product/asset name and thus permissible; however the message also includes English-only terms? Checking closely, the only English is the background name, which is an allowed proper name, so the claim holds.) | 1 |

## How to read this

- A task passes only when every check in its row of DESIGN.md holds; a pass on a retry counts as a failure.
- With about 45 runs per arm the 95% interval of the success rate is wide: differences smaller than about 15 points are noise.
- "Asked before spending" counts runs with a person in the chat that launched a session: the launch came after the person's yes to the price shown.
- Costs include the agent, the simulated person and the judge, at list prices.
