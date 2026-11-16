// Runs inside bwrap (see coder.ts): the Claude Agent SDK in /work with no
// Modelfy key and no user settings. Prints one JSON trace event per line on
// stdout; after each turn prints {"kind":"turn_end"} and reads one line on
// stdin: "continue <message>" for another turn, or "stop".
import { query } from "@anthropic-ai/claude-agent-sdk";
import { createInterface } from "node:readline";
import { AGENT_MODEL } from "../config.ts";
import type { TraceEvent } from "../trace.ts";

const MAX_AGENT_TURNS = 60;
const MAX_CONVERSATION_TURNS = 4;
const TOOLS = [
  "Bash",
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
];

const startedAt = Date.now();
const at = (): number => Date.now() - startedAt;

function emit(
  event: TraceEvent | { kind: "turn_end"; stopReason: string },
): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function textOfContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part: unknown) =>
      typeof part === "object" &&
      part !== null &&
      "text" in part &&
      typeof part.text === "string"
        ? [part.text]
        : [],
    )
    .join("\n");
}

const lines = createInterface({ input: process.stdin })[Symbol.asyncIterator]();
const tools = new Map<string, string>();
let prompt = process.argv[2] ?? "";
let sessionId: string | undefined;

for (let turn = 0; turn < MAX_CONVERSATION_TURNS; turn++) {
  let stopReason = "unknown";
  for await (const message of query({
    prompt,
    options: {
      cwd: "/work",
      model: AGENT_MODEL,
      allowedTools: TOOLS,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      settingSources: [],
      maxTurns: MAX_AGENT_TURNS,
      ...(sessionId !== undefined ? { resume: sessionId } : {}),
    },
  })) {
    if (message.type === "assistant") {
      sessionId = message.session_id;
      for (const block of message.message.content) {
        if (block.type === "text" && block.text.trim() !== "") {
          emit({ kind: "agent_text", text: block.text, at: at() });
        }
        if (block.type === "tool_use") {
          tools.set(block.id, block.name);
          const input =
            typeof block.input === "object" && block.input !== null
              ? Object.fromEntries(Object.entries(block.input))
              : {};
          emit({
            kind: "tool_call",
            id: block.id,
            tool: block.name,
            input,
            at: at(),
          });
        }
      }
    }
    if (message.type === "user" && Array.isArray(message.message.content)) {
      for (const block of message.message.content) {
        if (typeof block === "object" && block.type === "tool_result") {
          emit({
            kind: "tool_result",
            id: block.tool_use_id,
            tool: tools.get(block.tool_use_id) ?? "unknown",
            isError: block.is_error === true,
            code: null,
            text: textOfContent(block.content),
            at: at(),
          });
        }
      }
    }
    if (message.type === "result") {
      stopReason = message.subtype;
      for (const [model, usage] of Object.entries(message.modelUsage)) {
        emit({
          kind: "usage",
          role: "agent",
          model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens: usage.cacheReadInputTokens,
          cacheWriteTokens: usage.cacheCreationInputTokens,
        });
      }
    }
  }
  emit({ kind: "turn_end", stopReason });
  const answer = await lines.next();
  const line = answer.done === true ? "stop" : answer.value;
  if (!line.startsWith("continue ")) break;
  prompt = line.slice("continue ".length);
  emit({ kind: "person_text", text: prompt, at: at() });
}
process.exit(0);
