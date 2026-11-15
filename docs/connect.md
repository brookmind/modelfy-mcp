---
title: Connect your agent
description: Step-by-step setup for Claude Code (plus the optional plugin), claude.ai, ChatGPT, Cursor, VS Code, Codex, Antigravity, Zed, Cline, and your own agent through any MCP SDK or model API.
order: 2
---

# Connect your agent

```
https://mcp.modelfy.ai/mcp
```

Every client needs only that URL. How you sign in:

- **OAuth (recommended):** the client opens the Modelfy web, you sign in once and allow it. Nothing to copy, and you are not asked again. See [Keys and sign-in](keys.md#oauth).
- **API key:** for clients without OAuth, and for bots. Send `Authorization: Bearer mfy_live_…` (or a free `mfy_test_…` sandbox key). See [Keys and sign-in](keys.md).

To check it works, ask your agent: _"What's my Modelfy balance?"_ It should call `get_account`.

## Claude Code

### The usual way

```sh
claude mcp add --transport http --scope user modelfy https://mcp.modelfy.ai/mcp
```

Then, inside Claude Code, run `/mcp`, pick `modelfy` and sign in in the browser. From a shell, `claude mcp login modelfy` does the same. Tokens refresh on their own.

`--scope user` makes it available in all your projects. Leave it out to add it to the current project only, or use `--scope project` to write a `.mcp.json` your team shares (each person signs in with their own account).

With an API key instead of OAuth:

```sh
claude mcp add --transport http --scope user modelfy https://mcp.modelfy.ai/mcp \
  --header "Authorization: Bearer mfy_live_…"
```

### Optional: the plugin

The plugin brings the same server plus a skill that teaches Claude the whole photo workflow: what to ask the person, when to ask before spending, how to upload local files, and what to do after each error.

```
/plugin marketplace add brookmind/modelfy-mcp
/plugin install modelfy@modelfy
```

The plugin includes the server, so you do not need `claude mcp add` too (if you already added it, `claude mcp remove modelfy` avoids two copies). In `/mcp` it shows as `plugin:modelfy:modelfy`; sign in there.

## claude.ai and Claude Desktop

1. **Customize** → **Connectors** → **+ Add** → **Add custom connector**.
2. Name: `Modelfy`. URL: `https://mcp.modelfy.ai/mcp`.
3. Keep the default sign-in and OAuth client options, and add it. Sign in with your Modelfy account when asked.
4. In a conversation, turn it on from **+** → **Connectors**.

Custom connectors are available on Free (one connector), Pro, Max, Team and Enterprise. On Team and Enterprise an owner adds it in **Organization settings** → **Connectors**, and each member then clicks **Connect**. Connectors you add on claude.ai also work in Claude Desktop.

## ChatGPT

1. Open [chatgpt.com/plugins](https://chatgpt.com/plugins) → **+** → **Add custom MCP server**.
2. Name: `Modelfy`. Server URL: `https://mcp.modelfy.ai/mcp`. Authentication: **OAuth**.
3. Accept the warning, **Create**, and install it. Sign in with your Modelfy account.
4. In a chat, call it with `@Modelfy`.

ChatGPT connects with OAuth only (no API key field), on the web. Custom MCP servers depend on your plan and, in workspaces, on an admin setting; some accounts need **Developer mode** in Settings.

## Cursor

[Add to Cursor](https://cursor.com/install-mcp?name=modelfy&config=eyJ1cmwiOiJodHRwczovL21jcC5tb2RlbGZ5LmFpL21jcCJ9) (one click), or add this to `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project):

```json
{
  "mcpServers": {
    "modelfy": { "url": "https://mcp.modelfy.ai/mcp" }
  }
}
```

Cursor asks you to sign in the first time it uses the server. With an API key, add `"headers": { "Authorization": "Bearer ${env:MODELFY_API_KEY}" }` and set `MODELFY_API_KEY` in your environment.

## VS Code (GitHub Copilot)

Run **MCP: Add Server** from the Command Palette, choose **HTTP**, paste `https://mcp.modelfy.ai/mcp`, name it `modelfy` and save it to **Copilot Global**. Or write `~/.copilot/mcp-config.json`:

```json
{
  "mcpServers": {
    "modelfy": {
      "type": "http",
      "url": "https://mcp.modelfy.ai/mcp",
      "tools": ["*"]
    }
  }
}
```

Then click **Authenticate** in the server's actions and sign in. With an API key, add `"headers": { "Authorization": "Bearer ${MODELFY_API_KEY}" }` (the braces are required).

## Codex (CLI and IDE extension)

```sh
codex mcp add modelfy --url https://mcp.modelfy.ai/mcp
```

Codex starts the sign-in right away. To sign in again later: `codex mcp login modelfy`. With an API key kept in an environment variable:

```sh
codex mcp add modelfy --url https://mcp.modelfy.ai/mcp --bearer-token-env-var MODELFY_API_KEY
```

Both write `~/.codex/config.toml`, which the CLI and the IDE extension share:

```toml
[mcp_servers.modelfy]
url = "https://mcp.modelfy.ai/mcp"
# bearer_token_env_var = "MODELFY_API_KEY"   # only with an API key
```

In the IDE extension you can also use the gear → **MCP servers** → **Add server** → **Streamable HTTP**, then **Authenticate**.

## Antigravity (formerly Gemini CLI)

Add this to `~/.gemini/config/mcp_config.json` (all workspaces) or `.agents/mcp_config.json` (one workspace), then run `/mcp` in the CLI to reload:

```json
{
  "mcpServers": {
    "modelfy": { "serverUrl": "https://mcp.modelfy.ai/mcp" }
  }
}
```

Sign-in starts on its own the first time. With an API key, add `"headers": { "Authorization": "Bearer mfy_live_…" }`.

## Zed

In your settings, under `context_servers`:

```json
{
  "context_servers": {
    "modelfy": { "url": "https://mcp.modelfy.ai/mcp" }
  }
}
```

Without an `Authorization` header Zed signs you in with OAuth; with an API key, add `"headers": { "Authorization": "Bearer mfy_live_…" }`.

## Cline

In **MCP Servers** → **Remote Servers**, or in `cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "modelfy": {
      "type": "streamableHttp",
      "url": "https://mcp.modelfy.ai/mcp",
      "headers": { "Authorization": "Bearer mfy_live_…" }
    }
  }
}
```

## Your own agent or bot

First get a key: a free [sandbox key](keys.md#sandbox-keys) to build and test, then a live key with [device login](keys.md#device-login) (nobody copies it) or [by hand](keys.md#api-keys-by-hand). Then pick one of these.

### Any MCP SDK

TypeScript, with `@modelcontextprotocol/client`:

```ts
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

const client = new Client({ name: "store-bot", version: "1.0.0" });
await client.connect(
  new StreamableHTTPClientTransport(new URL("https://mcp.modelfy.ai/mcp"), {
    requestInit: {
      headers: { Authorization: `Bearer ${process.env.MODELFY_API_KEY}` },
    },
  }),
);
const account = await client.callTool({ name: "get_account", arguments: {} });
```

Read `client.getInstructions()` once: the server sends its workflow and spending rules there.

### Anthropic Messages API (Claude)

The API connects to the server for you. The token goes in `authorization_token`, without `Bearer`:

```sh
curl https://api.anthropic.com/v1/messages \
  -H "content-type: application/json" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2026-10-21" \
  -H "anthropic-beta: mcp-client-2025-11-20" \
  -d '{
    "model": "claude-opus-5-5",
    "max_tokens": 1024,
    "messages": [{ "role": "user", "content": "What is my Modelfy balance?" }],
    "mcp_servers": [{
      "type": "url",
      "url": "https://mcp.modelfy.ai/mcp",
      "name": "modelfy",
      "authorization_token": "mfy_live_…"
    }],
    "tools": [{ "type": "mcp_toolset", "mcp_server_name": "modelfy" }]
  }'
```

### OpenAI Responses API

The token goes in `authorization`, without `Bearer`, on every request. With a live key its budget limits what the bot can spend; use `"require_approval": "always"` if a person should approve each call:

```json
{
  "model": "gpt-6-astra",
  "input": "What is my Modelfy balance?",
  "tools": [
    {
      "type": "mcp",
      "server_label": "modelfy",
      "server_url": "https://mcp.modelfy.ai/mcp",
      "authorization": "mfy_live_…",
      "require_approval": "never"
    }
  ]
}
```

### xAI API (Grok)

`POST https://api.x.ai/v1/responses`:

```json
{
  "model": "grok-4.7",
  "input": [{ "role": "user", "content": "What is my Modelfy balance?" }],
  "tools": [
    {
      "type": "mcp",
      "server_label": "modelfy",
      "server_url": "https://mcp.modelfy.ai/mcp",
      "headers": { "Authorization": "Bearer mfy_live_…" }
    }
  ]
}
```

### Any other client

If it speaks MCP over Streamable HTTP, give it the URL: it either signs in with OAuth (discovered from the server's `401`) or sends the `Authorization: Bearer` header.
