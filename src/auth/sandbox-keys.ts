import { z } from "zod";
import { randomBase62, randomBase64Url, sha256Hex } from "../crypto";
import { keyRequestAllowed } from "../limits";
import { ActsAsSchema, AgentLayerSchema } from "./props";

const KEY_TTL_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_KEYS_PER_IP_PER_HOUR = 5;

/** The budget of a sandbox key that acts as a bot: a new live key's defaults */
export const SANDBOX_BOT_BUDGET = {
  maxCreditsPerSession: 100,
  maxCreditsPerDay: 500,
};

const SandboxKeySchema = z.object({
  sandboxId: z.string(),
  // Keys created before these options existed have neither
  actsAs: ActsAsSchema.nullable().default(null),
  agentLayer: AgentLayerSchema.default("v0"),
});
export type SandboxKey = z.infer<typeof SandboxKeySchema>;

const CreateBodySchema = z.object({
  acts_as: ActsAsSchema.optional(),
  agent_layer: AgentLayerSchema.optional(),
});

/** The bare agent layer is for evals: only where the Worker allows it. */
export function bareLayerAllowed(setting: string | undefined): boolean {
  return setting === "true";
}

export function sandboxKeysPerHour(setting: string | undefined): number {
  const value = Number.parseInt(setting ?? "", 10);
  return Number.isInteger(value) && value > 0
    ? value
    : DEFAULT_KEYS_PER_IP_PER_HOUR;
}

function invalidRequest(description: string): Response {
  return Response.json(
    { error: "invalid_request", error_description: description },
    { status: 400 },
  );
}

/**
 * The optional JSON body. Anything that is not a JSON object (no body, a
 * form, `null`) means no options, as before options existed; an object with
 * a wrong value is a 400.
 */
async function readOptions(
  request: Request,
): Promise<z.infer<typeof CreateBodySchema> | Response> {
  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return {};
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {};
  }
  const parsed = CreateBodySchema.safeParse(body);
  if (!parsed.success) {
    return invalidRequest(
      'acts_as must be "person" or "bot"; agent_layer must be "v0" or "bare".',
    );
  }
  return parsed.data;
}

function keyName(hash: string): string {
  return `sandbox-key:${hash}`;
}

export async function readSandboxKey(
  kv: KVNamespace,
  hash: string,
): Promise<SandboxKey | null> {
  const parsed = SandboxKeySchema.safeParse(
    await kv.get(keyName(hash), "json"),
  );
  return parsed.success ? parsed.data : null;
}

/**
 * POST /sandbox/keys: a free test key with no account (design §4.5), so an
 * agent can build and try an integration before anyone signs in.
 */
export async function createSandboxKey(
  request: Request,
  env: Env,
): Promise<Response> {
  const options = await readOptions(request);
  if (options instanceof Response) return options;
  if (
    options.agent_layer === "bare" &&
    !bareLayerAllowed(env.ALLOW_BARE_AGENT_LAYER)
  ) {
    return invalidRequest('agent_layer "bare" is not available here.');
  }
  const perHour = sandboxKeysPerHour(env.SANDBOX_KEYS_PER_HOUR);
  const allowed = await keyRequestAllowed(
    env,
    request,
    "sandbox-keys",
    perHour,
  );
  if (!allowed) {
    return Response.json(
      {
        error: "rate_limited",
        error_description: `At most ${perHour} sandbox keys per hour from one address. Reuse the key you have.`,
      },
      { status: 429, headers: { "Retry-After": "3600" } },
    );
  }
  const apiKey = `mfy_test_${randomBase62(43)}`;
  const stored: SandboxKey = {
    sandboxId: `anon:${randomBase64Url(16)}`,
    actsAs: options.acts_as ?? null,
    agentLayer: options.agent_layer ?? "v0",
  };
  await env.OAUTH_KV.put(
    keyName(await sha256Hex(apiKey)),
    JSON.stringify(stored),
    {
      expirationTtl: KEY_TTL_SECONDS,
    },
  );
  return Response.json(
    {
      api_key: apiKey,
      expires_at: new Date(Date.now() + KEY_TTL_SECONDS * 1000).toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
