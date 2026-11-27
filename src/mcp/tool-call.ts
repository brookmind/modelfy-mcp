import { AsyncLocalStorage } from "node:async_hooks";

/** The MCP tool call an API request belongs to. */
export interface ToolCall {
  tool: string;
  id: string;
}

const current = new AsyncLocalStorage<ToolCall>();

/**
 * Runs one tool call's body so every Modelfy API request made inside it
 * carries the tool name and one call id (`X-Mcp-Tool`, `X-Mcp-Call`); the API
 * counts the first request of each call as one `mcp_tool_called`.
 */
export function runToolCall<T>(
  tool: string,
  body: () => Promise<T>,
): Promise<T> {
  return current.run({ tool, id: crypto.randomUUID() }, body);
}

/** The tool call running now, if any. */
export function currentToolCall(): ToolCall | undefined {
  return current.getStore();
}
