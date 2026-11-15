import { z } from "zod";
import { randomBase64Url } from "../crypto";
import type { StoredPlan } from "../backend/types";

const QUOTE_TTL_SECONDS = 1800;

const QuoteSchema = z.object({
  owner: z.string(),
  plan: z.object({
    launchBody: z.record(z.string(), z.unknown()),
    credits: z.number(),
    photos: z.number(),
  }),
  /** Set once launched: a retry returns this session instead of launching again */
  sessionId: z.string().nullable(),
});
export type Quote = z.infer<typeof QuoteSchema>;

function key(id: string): string {
  return `quote:${id}`;
}

export interface SavedQuote {
  id: string;
  expiresAt: string;
}

export async function saveQuote(
  kv: KVNamespace,
  owner: string,
  plan: StoredPlan,
): Promise<SavedQuote> {
  const id = randomBase64Url(16);
  const quote: Quote = { owner, plan, sessionId: null };
  await kv.put(key(id), JSON.stringify(quote), {
    expirationTtl: QUOTE_TTL_SECONDS,
  });
  return {
    id,
    expiresAt: new Date(Date.now() + QUOTE_TTL_SECONDS * 1000).toISOString(),
  };
}

export async function readQuote(
  kv: KVNamespace,
  owner: string,
  id: string,
): Promise<Quote | "expired" | "not_yours"> {
  const parsed = QuoteSchema.safeParse(await kv.get(key(id), "json"));
  if (!parsed.success) return "expired";
  return parsed.data.owner === owner ? parsed.data : "not_yours";
}

export async function markLaunched(
  kv: KVNamespace,
  id: string,
  quote: Quote,
  sessionId: string,
): Promise<void> {
  const launched: Quote = { ...quote, sessionId };
  await kv.put(key(id), JSON.stringify(launched), {
    expirationTtl: QUOTE_TTL_SECONDS,
  });
}
