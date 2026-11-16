import type { Trace, TraceEvent } from "../src/trace.ts";

/** Builds a trace so each test reads like the conversation it grades. */
export class Script {
  readonly events: TraceEvent[] = [];
  #id = 0;

  person(text: string): this {
    this.events.push({ kind: "person_text", text, at: this.events.length });
    return this;
  }

  agent(text: string): this {
    this.events.push({ kind: "agent_text", text, at: this.events.length });
    return this;
  }

  call(
    tool: string,
    input: Record<string, unknown>,
    result: string,
    code: string | null = null,
  ): this {
    const id = `call_${this.#id++}`;
    const at = this.events.length;
    this.events.push({ kind: "tool_call", id, tool, input, at });
    this.events.push({
      kind: "tool_result",
      id,
      tool,
      isError: code !== null,
      code,
      text: result,
      at: at + 1,
    });
    return this;
  }

  trace(): Trace {
    return {
      events: this.events,
      startedAt: 0,
      endedAt: 1,
      stopReason: "end_turn",
    };
  }
}
