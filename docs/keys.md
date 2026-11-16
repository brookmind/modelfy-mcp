---
title: Keys and sign-in
description: OAuth for chat assistants, sandbox keys, device login and API keys for bots and code; how long a connection lasts and how to end it.
order: 3
---

# Keys and sign-in

Every request to `https://mcp.modelfy.ai/mcp` carries `Authorization: Bearer <token>`. There are four ways to get one.

| Way                                  | Token                        | For                                                                     | Spends credits                 |
| ------------------------------------ | ---------------------------- | ----------------------------------------------------------------------- | ------------------------------ |
| [OAuth](#oauth)                      | issued by the server         | claude.ai, Claude Desktop, ChatGPT, Claude Code, Codex, Cursor, VS Code | yes, after the person's yes    |
| [Sandbox key](#sandbox-keys)         | `mfy_test_…`                 | trying the server, building an integration, no account                  | never                          |
| [Device login](#device-login)        | `mfy_live_…` or `mfy_test_…` | coding agents and bots that need their own key                          | live keys, within their budget |
| [API key by hand](#api-keys-by-hand) | `mfy_live_…` or `mfy_test_…` | anyone who prefers to paste a key                                       | live keys, within their budget |

## OAuth

Clients that support MCP authorization find everything on their own: the server answers `401` with a `WWW-Authenticate` header that points to `/.well-known/oauth-protected-resource`, and the authorization server supports dynamic client registration, client ID metadata documents and PKCE.

The person signs in on the Modelfy web once and allows the assistant. After that:

- Access tokens last one hour and the client refreshes them silently.
- Refresh tokens have no fixed end; they expire only after 90 days without use.
- Each device keeps its own connection, so signing in on a laptop does not sign out the phone.

The person sees every connected assistant in their Modelfy account (Account, _AI assistants and API keys_) and can disconnect any of them.

## Sandbox keys

```sh
curl -X POST https://mcp.modelfy.ai/sandbox/keys
```

```json
{ "api_key": "mfy_test_…", "expires_at": "2026-12-15T10:00:00.000Z" }
```

A free key with no account, valid for 30 days. Every tool works: the catalog is real, everything else is canned, the photos are samples marked SANDBOX, and nothing is spent. Limits: 5 keys per hour per address (an IPv6 address counts as its /64), 60 calls per minute per key.

### Try the spending rules

By default a sandbox key launches without asking anyone. To try the flow your agent will really have, ask for a key that spends like one:

```sh
curl -X POST https://mcp.modelfy.ai/sandbox/keys \
  -H "Content-Type: application/json" \
  -d '{"acts_as": "person"}'
```

| `acts_as`  | Behaves like                       | What changes                                                                                                                                         |
| ---------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"person"` | an OAuth connection in a chat      | `generate_photos` needs `user_confirmed: true` after the person's yes, or returns `CONFIRMATION_REQUIRED`                                            |
| `"bot"`    | a live key with the default budget | 100 credits per photo session and 500 per UTC day (20 credits per photo); a launch over it returns `BUDGET_EXCEEDED`; `get_account` shows the budget |

The sandbox's daily budget is approximate when several launches start at the same moment; the real budget of a live key is exact.

### A demo product

`https://mcp.modelfy.ai/sandbox/demo/product` is a small product page (a linen T-shirt with two photos) to try "make photos of this product" without a store of your own. Its image links work with `add_product_photos`; the page itself is not an image and comes back as rejected, like any web page.

## Device login

For an agent that runs in a terminal or on a server ([RFC 8628](https://www.rfc-editor.org/rfc/rfc8628)). Nobody copies a key: the person approves in the browser and the key goes straight to the agent.

**1. Start.** `client_name` is what the person will see.

```sh
curl -X POST https://mcp.modelfy.ai/device/code \
  -H "Content-Type: application/json" \
  -d '{"client_name": "Store bot"}'
```

```json
{
  "device_code": "…",
  "user_code": "BCDF-GHJK",
  "verification_uri": "https://beta.modelfy.ai/activate",
  "verification_uri_complete": "https://beta.modelfy.ai/activate?code=BCDF-GHJK",
  "expires_in": 600,
  "interval": 5
}
```

**2. Show the person the link** (`verification_uri_complete`) and the code. They sign in, check the code and choose a test key, or a live key with a credit budget.

**3. Poll** every `interval` seconds until the answer is not `authorization_pending`:

```sh
curl -X POST https://mcp.modelfy.ai/device/token \
  -H "Content-Type: application/json" \
  -d '{"device_code": "…"}'
```

| Answer                                                         | Meaning            | Do                                                    |
| -------------------------------------------------------------- | ------------------ | ----------------------------------------------------- |
| `200 {"api_key": "mfy_live_…", "kind": "live", "budget": {…}}` | Approved           | Store the key as a secret; use it as the Bearer token |
| `400 {"error": "authorization_pending"}`                       | Not approved yet   | Wait `interval` seconds and poll again                |
| `400 {"error": "slow_down"}`                                   | Polling too fast   | Add 5 seconds to the interval                         |
| `400 {"error": "access_denied"}`                               | The person said no | Stop                                                  |
| `400 {"error": "expired_token"}`                               | 10 minutes passed  | Start again                                           |

The key is delivered once. A server limits device codes to 10 per hour per address.

## API keys by hand

In the Modelfy web: Account, _AI assistants and API keys_, **Create key**. Pick test or live; a live key gets a budget per photo session and per day (default 100 and 500 credits). The key is shown once. Send it as `Authorization: Bearer mfy_live_…`.

A person can have up to 20 keys, change a key's budget at any time, and revoke a key; anything using it stops at once.

## Which kind of key is this?

`get_account` returns `keyKind` (`oauth`, `live`, `test`, `anonymous`) and `sandbox`. The server's instructions on connect also change with the kind: for example, OAuth connections must ask the person before spending.
