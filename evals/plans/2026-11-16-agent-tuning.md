# Part 5: tune the MCP from the eval findings

Goal: fix what the v0 baseline (`evals/REPORT.md`, runs `baseline-v0`, `baseline-bare`) showed agents get wrong, then run the same evals on the tuned server as `v1` and report bare / v0 / v1.

Each change answers one measured failure. Server rules (consent check, budgets, quotes) do not change; what changes is what the agent is told, plus two protocol answers that misled it.

| # | Finding (baseline) | Change |
| --- | --- | --- |
| 1 | `consent-recovery` 1/5: a person's "no need to ask" said before any price makes the agent launch with `user_confirmed: true` without showing the price | Instructions for person connections, `generate_photos` and `user_confirmed` descriptions, and the `plan_photos` result for a person: only a yes given after seeing this price counts; an earlier "don't ask me" does not |
| 2 | `budget` 0/5: a bot over its per-session budget gives up instead of splitting the job | `plan_photos` result, when the plan is over the session budget: how many photos fit in one session and to launch smaller sessions one at a time within the daily budget; `BUDGET_EXCEEDED` next step says the same |
| 3 | Coding agent: `/device/code` over its hourly limit answers `{"error":"slow_down"}` (a token-polling error) and agents retry in a loop | Answer `429 {"error":"rate_limited","error_description":…}` with `Retry-After`, saying when to start again |
| 4 | Coding agent: an account's test key reads as "sandbox", and the agent thought it was the anonymous sandbox key | `get_account` summary says which key it is (anonymous sandbox key, a test key of the person's account, a live key, a connection) and what that means; field descriptions |
| 5 | Coding agent: `get_uploaded_photos` was read as having a `ready` field and the upload reported as rejected | The summary lists the ready upload ids and says to pass them as `upload_ids` to `plan_photos`; field descriptions |
| 6 | Docs said the same as the old text | `docs/keys.md`, `docs/errors.md`, `docs/credits.md` updated to match |

Then: a pinned local server at this branch's head (as for the baseline), `npm run eval` with `--arm v1` for both suites, report `baseline-bare baseline-v0 tuned-v1`. Owner's rules: one PR, independent review first.

Rulings:

- The agent layer keeps its option names (`v0` is "the shipped text", now the tuned one; `bare` strips it). The eval arm label `v1` names the server version measured, not a layer.
- v0 stays reproducible as a pinned local server at `a1bae80` (the eval server worktree) instead of a second text layer in code: same comparison, no duplicated text.
