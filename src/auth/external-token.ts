import {
  ExternalTokenError,
  type ResolveExternalTokenInput,
  type ResolveExternalTokenResult,
} from "@cloudflare/workers-oauth-provider";
import { z } from "zod";
import { ApiFailure, ModelfyApi } from "../api/client";
import { ConnectionSchema } from "../backend/api-schemas";
import { sha256Hex } from "../crypto";
import { BudgetLimitsSchema, type GrantProps } from "./props";
import { readSandboxKey, SANDBOX_BOT_BUDGET } from "./sandbox-keys";

const KEY_PATTERN = /^mfy_(live|test)_[0-9A-Za-z]{43}$/;
const CACHE_SECONDS = 60;

function cacheKey(hash: string): string {
  return `api-key:${hash}`;
}

const CachedPropsSchema = z.object({
  kind: z.enum(["live", "test"]),
  userId: z.string(),
  budget: BudgetLimitsSchema.nullable(),
});

/**
 * API keys sent as a bearer token (design §4.1). Anonymous sandbox keys are
 * found in KV; account keys are checked with the API (cached 60 s). OAuth
 * connection tokens are never accepted this way: they live inside grants.
 */
export async function resolveApiKey(
  input: ResolveExternalTokenInput<Env>,
  resource: string,
): Promise<ResolveExternalTokenResult | null> {
  const { token, env } = input;
  if (!KEY_PATTERN.test(token)) return null;
  const hash = await sha256Hex(token);

  // Only a test key can be an anonymous sandbox key
  const sandbox = token.startsWith("mfy_test_")
    ? await readSandboxKey(env.OAUTH_KV, hash)
    : null;
  if (sandbox !== null) {
    const props: GrantProps = {
      kind: "anonymous",
      userId: null,
      apiToken: null,
      sandboxId: sandbox.sandboxId,
      budget: sandbox.actsAs === "bot" ? SANDBOX_BOT_BUDGET : null,
      actsAs: sandbox.actsAs,
      agentLayer: sandbox.agentLayer,
    };
    return { props, audience: resource };
  }

  const cached = CachedPropsSchema.safeParse(
    await env.OAUTH_KV.get(cacheKey(hash), "json"),
  );
  let resolved: z.infer<typeof CachedPropsSchema>;
  if (cached.success) {
    resolved = cached.data;
  } else {
    let current: z.infer<typeof ConnectionSchema>;
    try {
      current = await new ModelfyApi(env, token).get(
        "/v2/connections/me",
        ConnectionSchema,
      );
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 401) return null;
      if (error instanceof ApiFailure) {
        throw new ExternalTokenError("temporarily_unavailable", {
          description: "Modelfy could not check this key right now. Try again.",
          statusCode: 503,
          headers: { "Retry-After": "30" },
        });
      }
      throw error;
    }
    if (current.kind === "OAUTH") return null;
    // Parsing keeps the budget's limits and drops today's spend
    resolved = CachedPropsSchema.parse({
      kind: current.kind === "LIVE" ? "live" : "test",
      userId: current.userId,
      budget: current.budget,
    });
    await env.OAUTH_KV.put(cacheKey(hash), JSON.stringify(resolved), {
      expirationTtl: CACHE_SECONDS,
    });
  }

  const props: GrantProps = {
    kind: resolved.kind,
    userId: resolved.userId,
    apiToken: token,
    sandboxId: resolved.kind === "test" ? `user:${resolved.userId}` : null,
    budget: resolved.budget,
    actsAs: null,
    agentLayer: "v0",
  };
  return { props, audience: resource };
}
