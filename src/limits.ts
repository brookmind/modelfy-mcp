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

/**
 * The address a limit counts. An IPv4 address as it is; an IPv6 address by
 * its /64, because one customer owns the whole /64 and can use any address
 * in it.
 */
export function limitAddress(ip: string): string {
  if (!ip.includes(":")) return ip;
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
 * Whether this address may ask for one more key or device code. Two checks:
 * a per-minute one that counts exactly, so requests fired at the same moment
 * cannot all pass the hourly counter; then the hourly counter in KV.
 */
export async function keyRequestAllowed(
  env: Env,
  request: Request,
  name: string,
  perHour: number,
): Promise<boolean> {
  const key = `${name}:${clientIp(request)}`;
  if (!(await env.KEY_REQUESTS.limit({ key })).success) return false;
  return hourlyLimit(env.OAUTH_KV, key, perHour);
}
