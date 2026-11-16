import type Anthropic from "@anthropic-ai/sdk";
import type {
  BetaContentBlock,
  BetaMessage,
  BetaMessageParam,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import {
  AGENT_EFFORT,
  AGENT_MODEL,
  MAX_PERSON_TURNS,
  MCP_URL,
  WEB_FETCH_TOOL,
} from "../config.ts";
import type { ChatTask } from "../tasks/types.ts";
import type { Trace, TraceEvent, Usage } from "../trace.ts";
import { nextPersonTurn } from "./person.ts";

const MCP_BETA = "mcp-client-2025-11-20";
/** Server tool loops that pause are continued this many times at most. */
const MAX_PAUSES = 5;
/** A fetched page is kept in the trace up to this many characters. */
const MAX_FETCHED_CHARS = 20_000;

const SYSTEM_PERSON =
  "You are a store owner's assistant. You can use the Modelfy tools to create product photos for them.";
const SYSTEM_BOT =
  "You are an automated store bot with the Modelfy tools. Nobody reads your messages until the job is done, and nobody can answer your questions.";

function textOf(content: string | { type: "text"; text: string }[]): string {
  return typeof content === "string"
    ? content
    : content.map((part) => part.text).join("\n");
}

/** The Modelfy error code in a tool result's JSON (`{"error":{"code":…}}`). */
function errorCode(text: string): string | null {
  for (const line of text.split("\n")) {
    if (!line.startsWith("{")) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (
        typeof value === "object" &&
        value !== null &&
        "error" in value &&
        typeof value.error === "object" &&
        value.error !== null &&
        "code" in value.error &&
        typeof value.error.code === "string"
      ) {
        return value.error.code;
      }
    } catch {
      // Not JSON; keep looking
    }
  }
  return null;
}

/** Turns one response's content blocks into trace events. */
export function mapResponseBlocks(
  blocks: BetaContentBlock[],
  at: number,
): TraceEvent[] {
  const tools = new Map<string, string>();
  const events: TraceEvent[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "text":
        if (block.text.trim() !== "") {
          events.push({ kind: "agent_text", text: block.text, at });
        }
        break;
      case "mcp_tool_use":
      case "server_tool_use": {
        tools.set(block.id, block.name);
        const input =
          typeof block.input === "object" && block.input !== null
            ? Object.fromEntries(Object.entries(block.input))
            : {};
        events.push({
          kind: "tool_call",
          id: block.id,
          tool: block.name,
          input,
          at,
        });
        break;
      }
      case "mcp_tool_result": {
        const text = textOf(block.content);
        events.push({
          kind: "tool_result",
          id: block.tool_use_id,
          tool: tools.get(block.tool_use_id) ?? "unknown",
          isError: block.is_error,
          code: block.is_error ? errorCode(text) : null,
          text,
          at,
        });
        break;
      }
      case "web_fetch_tool_result": {
        const fetched = block.content;
        const isError = fetched.type === "web_fetch_tool_result_error";
        const text = isError
          ? fetched.error_code
          : fetched.content.source.type === "text"
            ? fetched.content.source.data.slice(0, MAX_FETCHED_CHARS)
            : `(${fetched.content.source.type} document from ${fetched.url})`;
        events.push({
          kind: "tool_result",
          id: block.tool_use_id,
          tool: tools.get(block.tool_use_id) ?? "web_fetch",
          isError,
          code: isError ? fetched.error_code : null,
          text,
          at,
        });
        break;
      }
      default:
        // Thinking and other blocks are not part of the trace
        break;
    }
  }
  return events;
}

function usageOf(response: BetaMessage): Usage {
  return {
    kind: "usage",
    role: "agent",
    model: response.model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
  };
}

/**
 * Runs one chat task: the Claude API with the Modelfy MCP connector, and the
 * simulated person answering until the job is done or the turns run out. The
 * sandbox key decides how the server behaves (acts_as, agent layer).
 */
export async function runChat(
  client: Anthropic,
  task: ChatTask,
  apiKey: string,
): Promise<Trace> {
  const startedAt = Date.now();
  const at = (): number => Date.now() - startedAt;
  const trace: Trace = {
    events: [],
    startedAt,
    endedAt: startedAt,
    stopReason: "",
  };
  const messages: BetaMessageParam[] = [{ role: "user", content: task.prompt }];
  trace.events.push({ kind: "person_text", text: task.prompt, at: 0 });

  for (let turn = 0; turn <= MAX_PERSON_TURNS; turn++) {
    let response: BetaMessage | null = null;
    for (let pause = 0; pause <= MAX_PAUSES; pause++) {
      response = await client.beta.messages.create({
        model: AGENT_MODEL,
        max_tokens: 16_000,
        system: task.persona === null ? SYSTEM_BOT : SYSTEM_PERSON,
        messages,
        mcp_servers: [
          {
            type: "url",
            url: MCP_URL,
            name: "modelfy",
            authorization_token: apiKey,
          },
        ],
        tools: [
          { type: "mcp_toolset", mcp_server_name: "modelfy" },
          { type: WEB_FETCH_TOOL, name: "web_fetch", max_uses: 5 },
        ],
        output_config: { effort: AGENT_EFFORT },
        betas: [MCP_BETA],
      });
      trace.events.push(
        ...mapResponseBlocks(response.content, at()),
        usageOf(response),
      );
      messages.push({ role: "assistant", content: response.content });
      if (response.stop_reason !== "pause_turn") break;
    }
    trace.stopReason = response?.stop_reason ?? "no_response";
    if (task.persona === null) break;
    if (turn === MAX_PERSON_TURNS) {
      trace.stopReason = "max_person_turns";
      break;
    }
    const next = await nextPersonTurn(client, task.persona, trace);
    trace.events.push(next.usage);
    if (next.done || next.reply === null) break;
    trace.events.push({ kind: "person_text", text: next.reply, at: at() });
    messages.push({ role: "user", content: next.reply });
  }
  trace.endedAt = Date.now();
  return trace;
}
