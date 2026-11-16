import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import type { Usage } from "../trace.ts";

export interface StructuredAnswer<T> {
  value: T;
  usage: Usage;
}

/** One Claude call whose answer must match a JSON schema (structured output). */
export async function structured<T>(
  client: Anthropic,
  request: {
    model: string;
    role: Usage["role"];
    system: string;
    prompt: string;
    jsonSchema: Record<string, unknown>;
    parse: z.ZodType<T>;
  },
): Promise<StructuredAnswer<T>> {
  const response = await client.beta.messages.create({
    model: request.model,
    max_tokens: 4000,
    system: request.system,
    messages: [{ role: "user", content: request.prompt }],
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: request.jsonSchema },
    },
  });
  const text = response.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("");
  const value = request.parse.parse(JSON.parse(text));
  return {
    value,
    usage: {
      kind: "usage",
      role: request.role,
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    },
  };
}
