import { z } from "zod";

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

/** Reads trace events back (from the coding agent's stdout or a result file). */
export const TraceEventSchema = z.union([
  z.object({
    kind: z.enum(["agent_text", "person_text"]),
    text: z.string(),
    at: z.number(),
  }),
  z.object({
    kind: z.literal("tool_call"),
    id: z.string(),
    tool: z.string(),
    input: z.record(z.string(), z.unknown()),
    at: z.number(),
  }),
  z.object({
    kind: z.literal("tool_result"),
    id: z.string(),
    tool: z.string(),
    isError: z.boolean(),
    code: z.string().nullable(),
    text: z.string(),
    at: z.number(),
  }),
  z.object({
    kind: z.literal("usage"),
    role: z.enum(["agent", "person", "judge"]),
    model: z.string(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheReadTokens: z.number(),
    cacheWriteTokens: z.number(),
  }),
]);

export const TraceSchema = z.object({
  events: z.array(TraceEventSchema),
  startedAt: z.number(),
  endedAt: z.number(),
  stopReason: z.string(),
});
