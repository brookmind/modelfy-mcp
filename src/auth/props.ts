import { z } from "zod";

export const TokenKindSchema = z.enum(["oauth", "live", "test", "anonymous"]);
export type TokenKind = z.infer<typeof TokenKindSchema>;

const BudgetSchema = z.object({
  maxCreditsPerSession: z.number(),
  maxCreditsPerDay: z.number(),
});

/**
 * What every authenticated request carries (OAuth grant props, or the props
 * resolved from an API key). `apiToken` is the user's Modelfy token; it never
 * leaves the Worker except towards the Modelfy API.
 */
export const GrantPropsSchema = z.object({
  kind: TokenKindSchema,
  userId: z.string().nullable(),
  apiToken: z.string().nullable(),
  /** The token's id on the API side (quotes are bound to it); null for anonymous keys */
  tokenId: z.string().nullable(),
  sandboxId: z.string().nullable(),
  budget: BudgetSchema.nullable(),
});
export type GrantProps = z.infer<typeof GrantPropsSchema>;

export function parseProps(value: unknown): GrantProps | null {
  const parsed = GrantPropsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
