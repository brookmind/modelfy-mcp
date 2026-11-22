---
title: Credits and consent
description: How a launch is priced, who must agree before credits are spent, key budgets, refunds and retries.
order: 5
---

# Credits and consent

Photos cost credits from the person's Modelfy account. The server makes sure no credit is spent without consent: a person's yes in a chat, or a budget the key's owner set.

## Every launch is quoted first

`plan_photos` returns the exact price (`credits`) and a `quote_id`. The server keeps that exact plan for 30 minutes, bound to the connection that made it. `generate_photos` launches only a quote: the agent cannot change the plan or the price between the person's yes and the launch.

The quote is also the idempotency key. A retry of `generate_photos` with the same `quote_id` (after a timeout, say) returns the session already launched and never charges twice.

## Who must agree

| Connection                 | Before `generate_photos`                                                                                                                                                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OAuth (a person in a chat) | Show the price and ask. Call it with `user_confirmed: true` only after the person said yes to that exact price, after seeing it: a "just do it, no need to ask" said before the price is not a yes. Without it the server answers `CONFIRMATION_REQUIRED`. |
| Live API key               | No confirmation needed: the key's budget is the consent. If a person is in the conversation, still show the price and ask.                                                                                                                                 |
| Test or sandbox key        | Nothing is spent.                                                                                                                                                                                                                                          |

A good question to the person: "4 photos for 80 credits (you have 880). Go ahead?"

## Live key budgets

Each live key has two limits, set by its owner in the Modelfy web:

- **Per photo session**: the most one launch can cost.
- **Per day**: the most the key can spend in a UTC day.

Modelfy checks both inside the same database transaction that reserves the credits, so two launches at once cannot go over. A launch that would go over fails with `BUDGET_EXCEEDED` and spends nothing; the error carries the budget and today's spend. `get_account` shows `budget.spentToday` and `budget.resetsAt`; `plan_photos` shows `budget.session_limit` and `budget.left_today` next to the price.

A job bigger than the budget per session is still allowed within the daily budget: split it into smaller sessions (fewer photos or products each) and launch them one at a time. When a plan is over the per-session budget, `plan_photos` says how many photos fit in one session.

## Refunds

- Photos that fail are refunded automatically.
- `cancel_photo_session` refunds photos that had not started.
- `get_photo_session` shows `credits.reserved`, `credits.charged` and `credits.refunded`.

## Not enough credits

`plan_photos` returns `enough_credits: false` before anything is tried, and a launch without enough credits fails with `INSUFFICIENT_CREDITS`. The person can buy credits or change plan at https://app.modelfy.ai/plans.
