/**
 * One run of an agent, as a list of events: what the person said, what the
 * agent said, every tool call and its result, and the tokens each model used.
 * Both agents (chat assistant and coding agent) write this same shape, so the
 * checks and the report never care which agent produced it.
 */
export type TraceEvent = ToolCall | ToolResult | AgentText | PersonText | Usage;

export interface ToolCall {
  kind: "tool_call";
  id: string;
  tool: string;
  input: Record<string, unknown>;
  /** Milliseconds since the run started */
  at: number;
}

export interface ToolResult {
  kind: "tool_result";
  /** The id of its tool_call */
  id: string;
  tool: string;
  isError: boolean;
  /** The Modelfy error code (`error.code`), when there is one */
  code: string | null;
  text: string;
  at: number;
}

export interface AgentText {
  kind: "agent_text";
  text: string;
  at: number;
}

export interface PersonText {
  kind: "person_text";
  text: string;
  at: number;
}

export interface Usage {
  kind: "usage";
  role: "agent" | "person" | "judge";
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface Trace {
  events: TraceEvent[];
  /** Epoch milliseconds */
  startedAt: number;
  endedAt: number;
  /** Why the run ended: the model's stop reason, "max_turns", "timeout"… */
  stopReason: string;
}
