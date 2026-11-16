import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  callsOf,
  consentOk,
  costUsd,
  estimateKvWrites,
  inventedIds,
  toolErrors,
} from "./grade/checks.ts";
import type { AgentLayer } from "./sandbox-key.ts";
import type { Grade } from "./tasks/types.ts";
import type { Trace, Usage } from "./trace.ts";

export interface Metrics {
  toolCalls: number;
  toolErrors: Record<string, number>;
  personTurns: number;
  inventedIds: string[];
  /** null when the run launched nothing */
  consentOk: boolean | null;
  seconds: number;
  costUsd: number;
  /** Agent tokens only; the person and judge are in costUsd */
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  kvWrites: number;
}

export interface ResultRow {
  runId: string;
  task: string;
  suite: "a" | "b";
  arm: AgentLayer;
  rep: number;
  /** Model ids as the API reported them */
  models: string[];
  grade: Grade;
  metrics: Metrics;
  trace: Trace;
}

const KEY_PATTERN = /mfy_(test|live)_[0-9A-Za-z]{20,}/g;

/** Sandbox and live keys never reach a result file. */
export function redact(text: string): string {
  return text.replace(KEY_PATTERN, "mfy_$1_***");
}

export function rowKey(task: string, arm: AgentLayer, rep: number): string {
  return `${task}|${arm}|${rep}`;
}

export function metricsOf(trace: Trace, extraUsages: Usage[]): Metrics {
  const usages = [
    ...trace.events.filter((event): event is Usage => event.kind === "usage"),
    ...extraUsages,
  ];
  const agent = usages.filter((usage) => usage.role === "agent");
  return {
    toolCalls: trace.events.filter((event) => event.kind === "tool_call")
      .length,
    toolErrors: toolErrors(trace),
    // The first person message is the task itself
    personTurns: Math.max(
      0,
      trace.events.filter((event) => event.kind === "person_text").length - 1,
    ),
    inventedIds: inventedIds(trace),
    consentOk:
      callsOf(trace, "generate_photos").length === 0 ? null : consentOk(trace),
    seconds: (trace.endedAt - trace.startedAt) / 1000,
    costUsd: costUsd(usages),
    tokens: {
      input: agent.reduce((sum, usage) => sum + usage.inputTokens, 0),
      output: agent.reduce((sum, usage) => sum + usage.outputTokens, 0),
      cacheRead: agent.reduce((sum, usage) => sum + usage.cacheReadTokens, 0),
      cacheWrite: agent.reduce((sum, usage) => sum + usage.cacheWriteTokens, 0),
    },
    kvWrites: estimateKvWrites(trace),
  };
}

/**
 * One full line per finished run. If a crash left half a line, the new row
 * starts on a line of its own, so it stays readable.
 */
export async function appendRow(path: string, row: ResultRow): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  let existing = "";
  try {
    existing = await readFile(path, "utf8");
  } catch {
    // A new file
  }
  const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";
  await appendFile(path, `${separator}${redact(JSON.stringify(row))}\n`);
}

function isRowKey(
  value: unknown,
): value is { task: string; arm: AgentLayer; rep: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    "task" in value &&
    typeof value.task === "string" &&
    "arm" in value &&
    (value.arm === "v0" || value.arm === "bare") &&
    "rep" in value &&
    typeof value.rep === "number"
  );
}

/** The (task, arm, rep) runs already written, so a rerun resumes. */
export async function doneKeys(path: string): Promise<Set<string>> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return new Set();
  }
  const keys = new Set<string>();
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const value: unknown = JSON.parse(line);
      if (isRowKey(value)) keys.add(rowKey(value.task, value.arm, value.rep));
    } catch {
      // A partial last line from a crash: that run is done again
    }
  }
  return keys;
}
