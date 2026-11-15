---
title: Quickstart
description: What the Modelfy MCP server does, its URL, and a first photo session in three steps.
order: 1
---

# Quickstart

Modelfy creates product photos: a product worn or held by a model in a real place, or the product alone on a studio background. This MCP server lets any AI agent do it for a person, with their Modelfy account and their credits.

```
https://mcp.modelfy.ai/mcp
```

Streamable HTTP. Sign-in with OAuth 2.1 (chat assistants) or a Bearer API key (bots and code).

## 1. Connect

In Claude Code:

```sh
claude mcp add --transport http --scope user modelfy https://mcp.modelfy.ai/mcp
```

Then run `/mcp`, pick `modelfy` and sign in with your Modelfy account. Other clients (claude.ai, ChatGPT, Cursor, VS Code, Codex, Gemini CLI, your own agent) are in [Connect your agent](connect.md).

No account yet? Get a free sandbox key and use it as a Bearer token. Nothing is spent and the photos are samples:

```sh
curl -X POST https://mcp.modelfy.ai/sandbox/keys
```

## 2. Ask for photos

> Make 4 photos of this dress, vertical, on a model in a café: https://shop.example.com/dress.jpg

The agent adds the product photos, picks a model and a place, and plans the session.

## 3. Say yes to the price

The agent shows the exact price in credits before anything is spent. After your yes it launches the session, waits, and shows the photos when they are ready. See [Credits and consent](credits.md).

## The tools

| Tool                                                     | What it does                                                               | Spends credits |
| -------------------------------------------------------- | -------------------------------------------------------------------------- | -------------- |
| `get_account`                                            | Balance, plan, price per photo; for live keys the budget and today's spend | no             |
| `list_models` · `list_backgrounds` · `get_photo_options` | People, places, formats, shot types                                        | no             |
| `add_product_photos`                                     | Product photos from public image links                                     | no             |
| `create_upload_session` · `get_uploaded_photos`          | Photos from code (presigned PUT) or from a page a person opens             | no             |
| `plan_photos`                                            | Plans a session; returns the exact price and a `quote_id`                  | no             |
| `generate_photos`                                        | Launches the planned session                                               | **yes**        |
| `get_photo_session`                                      | Progress and finished photos; can wait until done                          | no             |
| `list_recent_photos` · `cancel_photo_session`            | Recent photos; stop a session (unstarted photos are refunded)              | refunds        |
| `get_docs`                                               | These pages                                                                | no             |

Next: [Create photos](photos.md) for the whole workflow, [Keys and sign-in](keys.md) for every way to authenticate, [Errors](errors.md) for what each error code means.
