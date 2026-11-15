import { z } from "zod";
import { randomBase62, randomBase64Url, sha256Hex } from "../crypto";
import { clientIp, hourlyLimit } from "../limits";

const KEY_TTL_SECONDS = 30 * 24 * 60 * 60;
const KEYS_PER_IP_PER_HOUR = 5;

const SandboxKeySchema = z.object({ sandboxId: z.string() });
export type SandboxKey = z.infer<typeof SandboxKeySchema>;

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
  const allowed = await hourlyLimit(
    env.OAUTH_KV,
    `sandbox-keys:${clientIp(request)}`,
    KEYS_PER_IP_PER_HOUR,
  );
  if (!allowed) {
    return Response.json(
      {
        error: "rate_limited",
        error_description:
          "At most 5 sandbox keys per hour from one address. Reuse the key you have.",
      },
      { status: 429, headers: { "Retry-After": "3600" } },
    );
  }
  const apiKey = `mfy_test_${randomBase62(43)}`;
  const stored: SandboxKey = { sandboxId: `anon:${randomBase64Url(16)}` };
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
