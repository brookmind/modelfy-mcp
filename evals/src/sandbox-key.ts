import { z } from "zod";
import { BASE_URL } from "./config.ts";

export type ActsAs = "person" | "bot";
export type AgentLayer = "v0" | "bare";

export interface SandboxKeyOptions {
  actsAs?: ActsAs;
  agentLayer?: AgentLayer;
}

const Created = z.object({ api_key: z.string() });

/** A fresh anonymous sandbox key, so every run starts from a clean account. */
export async function createSandboxKey(
  options: SandboxKeyOptions,
): Promise<string> {
  const response = await fetch(`${BASE_URL}/sandbox/keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(options.actsAs !== undefined ? { acts_as: options.actsAs } : {}),
      ...(options.agentLayer !== undefined
        ? { agent_layer: options.agentLayer }
        : {}),
    }),
  });
  if (!response.ok) {
    throw new Error(
      `POST /sandbox/keys answered ${response.status}: ${await response.text()}`,
    );
  }
  return Created.parse(await response.json()).api_key;
}
