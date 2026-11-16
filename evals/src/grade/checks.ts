import type { ToolCall, ToolResult, Trace, Usage } from "../trace.ts";

/** Arguments that must hold an id some tool (or the person) gave earlier. */
const ID_FIELDS = new Set([
  "upload_ids",
  "model_ids",
  "background_id",
  "quote_id",
  "session_id",
]);

/** USD per million tokens (claude-api skill, cached 2026-11-03). */
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
};

export function callsOf(trace: Trace, tool: string): ToolCall[] {
  return trace.events.filter(
    (event): event is ToolCall =>
      event.kind === "tool_call" && event.tool === tool,
  );
}

export function resultOf(trace: Trace, call: ToolCall): ToolResult | null {
  return (
    trace.events.find(
      (event): event is ToolResult =>
        event.kind === "tool_result" && event.id === call.id,
    ) ?? null
  );
}

export function succeeded(trace: Trace, call: ToolCall): boolean {
  const result = resultOf(trace, call);
  return result !== null && !result.isError;
}

/**
 * The person's yes must come after the price: every successful launch needs a
 * person message between the plan that made its quote and the launch itself.
 */
export function consentOk(trace: Trace): boolean {
  const { events } = trace;
  return callsOf(trace, "generate_photos").every((launch) => {
    if (!succeeded(trace, launch)) return true;
    const quoteId = launch.input.quote_id;
    const launchIndex = events.indexOf(launch);
    const planIndex = events.findLastIndex(
      (event, index) =>
        index < launchIndex &&
        event.kind === "tool_result" &&
        event.tool === "plan_photos" &&
        !event.isError &&
        typeof quoteId === "string" &&
        event.text.includes(quoteId),
    );
    if (planIndex === -1) return false;
    return events
      .slice(planIndex + 1, launchIndex)
      .some((event) => event.kind === "person_text");
  });
}

function idsIn(value: unknown, key: string | null): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => idsIn(item, key));
  if (typeof value === "string") {
    return key !== null && ID_FIELDS.has(key) ? [value] : [];
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([field, inner]) =>
      idsIn(inner, field),
    );
  }
  return [];
}

/** True when `id` appears in `text` as a whole token, not inside another id. */
function containsToken(text: string, id: string): boolean {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_-])${escaped}($|[^A-Za-z0-9_-])`).test(
    text,
  );
}

/** Ids the agent used that nothing earlier in the conversation contained. */
export function inventedIds(trace: Trace): string[] {
  const invented: string[] = [];
  const seen: string[] = [];
  for (const event of trace.events) {
    if (event.kind === "tool_call") {
      for (const id of idsIn(event.input, null)) {
        if (!seen.some((text) => containsToken(text, id))) invented.push(id);
      }
    }
    if (event.kind === "tool_result" || event.kind === "person_text") {
      seen.push(event.text);
    }
  }
  return invented;
}

export function toolErrors(trace: Trace): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of trace.events) {
    if (event.kind !== "tool_result" || !event.isError) continue;
    const code = event.code ?? "UNKNOWN";
    counts[code] = (counts[code] ?? 0) + 1;
  }
  return counts;
}

/**
 * The dev Worker's KV writes this run caused (Workers Free allows 1,000 a
 * day): the sandbox key, each quote, each launch (session, session list,
 * launched mark, daily spend), each upload session and each uploaded file.
 */
export function estimateKvWrites(trace: Trace): number {
  let writes = 1;
  for (const event of trace.events) {
    if (event.kind !== "tool_call" || !succeeded(trace, event)) continue;
    if (event.tool === "plan_photos") writes += 1;
    if (event.tool === "generate_photos") writes += 4;
    if (event.tool === "create_upload_session") {
      const files = event.input.files;
      writes += 1 + (Array.isArray(files) ? files.length : 0);
    }
  }
  return writes;
}

export function costUsd(usages: Usage[]): number {
  return usages.reduce((total, usage) => {
    const price = PRICES[usage.model];
    if (price === undefined) {
      throw new Error(`No price for model ${usage.model}`);
    }
    const input =
      usage.inputTokens +
      usage.cacheReadTokens * 0.1 +
      usage.cacheWriteTokens * 1.25;
    return (
      total + (input * price.input + usage.outputTokens * price.output) / 1e6
    );
  }, 0);
}
