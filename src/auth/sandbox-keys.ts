import { z } from "zod";
import { randomBase62, randomBase64Url, sha256Hex } from "../crypto";
import {
  DAY_MS,
  keyRequestWait,
  secondsToUtcMidnight,
  windowLimit,
} from "../limits";
import { ActsAsSchema, AgentLayerSchema } from "./props";

const KEY_TTL_SECONDS = 30 * 24 * 60 * 60;
const PRODUCTION_URL = "https://mcp.modelfy.ai";
/** Where the agent evals run: they ask for many keys from one address */
const EVALS_URL = "https://mcp-dev.modelfy.ai";
/** All addresses together get this many times one address's hourly keys in a UTC day */
const DAILY_TOTAL_FACTOR = 20;

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

/** The bare agent layer is for evals: never in production. */
export function bareLayerAllowed(publicUrl: string): boolean {
  return publicUrl !== PRODUCTION_URL;
}

/** Sandbox keys one address may get in an hour. */
export function sandboxKeysPerHour(publicUrl: string): number {
  return publicUrl === EVALS_URL ? 200 : 5;
}

function tooMany(description: string, retryAfter: number): Response {
  return Response.json(
    { error: "rate_limited", error_description: description },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
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
  if (options.agent_layer === "bare" && !bareLayerAllowed(env.PUBLIC_URL)) {
    return invalidRequest('agent_layer "bare" is not available here.');
  }
  const perHour = sandboxKeysPerHour(env.PUBLIC_URL);
  const wait = await keyRequestWait(env, request, "sandbox-keys", perHour);
  if (wait > 0) {
    return tooMany(
      `At most ${perHour} sandbox keys per hour from one address, one request at a time. Reuse the key you have.`,
      wait,
    );
  }
  // All addresses together: free keys cannot use up the storage sign-ins need
  const perDay = perHour * DAILY_TOTAL_FACTOR;
  if (!(await windowLimit(env.OAUTH_KV, "sandbox-keys-all", perDay, DAY_MS))) {
    return tooMany(
      "No more free sandbox keys today (the daily total resets at 00:00 UTC). Reuse a key you have, or get your own with device login (POST /device/code).",
      secondsToUtcMidnight(),
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
