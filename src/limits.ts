const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

/**
 * Counts one use of `key` in the current window (an hour, a UTC day) and
 * says whether it is within `max`. KV is eventually consistent, so the limit
 * is approximate: enough to stop abuse of free sandbox keys, never used for
 * money.
 */
export async function windowLimit(
  kv: KVNamespace,
  key: string,
  max: number,
  windowMs: number,
  now: number = Date.now(),
): Promise<boolean> {
  const counterKey = `limit:${key}:${Math.floor(now / windowMs)}`;
  const used = Number((await kv.get(counterKey)) ?? "0");
  if (used >= max) return false;
  await kv.put(counterKey, String(used + 1), {
    expirationTtl: (2 * windowMs) / 1000,
  });
  return true;
}

/**
 * The address a limit counts. An IPv4 address as it is; an IPv6 address by
 * its /64, because one customer owns the whole /64 and can use any address
 * in it.
 */
export function limitAddress(ip: string): string {
  if (!ip.includes(":")) return ip;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped?.[1] !== undefined) return mapped[1];
  const [head = "", tail] = ip.toLowerCase().split("::");
  const groups = head === "" ? [] : head.split(":");
  if (tail !== undefined) {
    const last = tail === "" ? [] : tail.split(":");
    const zeros = Math.max(0, 8 - groups.length - last.length);
    groups.push(...Array.from({ length: zeros }, () => "0"), ...last);
  }
  const prefix = groups
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, ""))
    .join(":");
  return `${prefix}::/64`;
}

export function clientIp(request: Request): string {
  return limitAddress(request.headers.get("CF-Connecting-IP") ?? "unknown");
}

/**
 * Seconds this address must wait before asking for one more key or device
 * code; 0 when this request is allowed. Two checks: KEY_REQUESTS lets one
 * request through at a time, so requests fired together cannot all read the
 * same hourly count; then the hourly counter in KV. Both are approximate
 * (Cloudflare counts rate limits per location, without a global lock): they
 * bound abuse of free keys and are never used for money.
 */
export async function keyRequestWait(
  env: Env,
  request: Request,
  name: string,
  perHour: number,
): Promise<number> {
  const key = `${name}:${clientIp(request)}`;
  if (!(await env.KEY_REQUESTS.limit({ key })).success) return 60;
  return (await windowLimit(env.OAUTH_KV, key, perHour, HOUR_MS)) ? 0 : 3600;
}
