const HOUR_MS = 60 * 60 * 1000;

/**
 * Counts one use of `key` in the current hour and says whether it is within
 * `max`. KV is eventually consistent, so the limit is approximate: enough to
 * stop abuse of free sandbox keys, never used for money.
 */
export async function hourlyLimit(
  kv: KVNamespace,
  key: string,
  max: number,
  now: number = Date.now(),
): Promise<boolean> {
  const window = Math.floor(now / HOUR_MS);
  const counterKey = `limit:${key}:${window}`;
  const used = Number((await kv.get(counterKey)) ?? "0");
  if (used >= max) return false;
  await kv.put(counterKey, String(used + 1), { expirationTtl: 2 * 60 * 60 });
  return true;
}

export function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}
