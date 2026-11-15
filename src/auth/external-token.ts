import {
  ExternalTokenError,
  type ResolveExternalTokenInput,
  type ResolveExternalTokenResult,
} from "@cloudflare/workers-oauth-provider";
import { z } from "zod";
import { ApiFailure, ModelfyApi } from "../api/client";
import { sha256Hex } from "../crypto";
import type { GrantProps } from "./props";
import { readSandboxKey } from "./sandbox-keys";

const KEY_PATTERN = /^mfy_(live|test)_[0-9A-Za-z]{43}$/;
const CACHE_SECONDS = 60;

export const CurrentConnectionSchema = z.object({
  userId: z.string(),
  kind: z.enum(["LIVE", "TEST", "OAUTH"]),
  name: z.string(),
  budget: z
    .object({
      maxCreditsPerSession: z.number(),
      maxCreditsPerDay: z.number(),
      spentToday: z.number(),
      resetsAt: z.string(),
    })
    .nullable(),
});

function cacheKey(hash: string): string {
  return `api-key:${hash}`;
}

const CachedPropsSchema = z.object({
  kind: z.enum(["live", "test"]),
  userId: z.string(),
  budget: z
    .object({ maxCreditsPerSession: z.number(), maxCreditsPerDay: z.number() })
    .nullable(),
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

  const sandbox = await readSandboxKey(env.OAUTH_KV, hash);
  if (sandbox !== null) {
    const props: GrantProps = {
      kind: "anonymous",
      userId: null,
      apiToken: null,
      sandboxId: sandbox.sandboxId,
      budget: null,
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
    let current: z.infer<typeof CurrentConnectionSchema>;
    try {
      current = await new ModelfyApi(env, token).get(
        "/v2/connections/me",
        CurrentConnectionSchema,
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
    resolved = {
      kind: current.kind === "LIVE" ? "live" : "test",
      userId: current.userId,
      budget:
        current.budget === null
          ? null
          : {
              maxCreditsPerSession: current.budget.maxCreditsPerSession,
              maxCreditsPerDay: current.budget.maxCreditsPerDay,
            },
    };
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
  };
  return { props, audience: resource };
}
