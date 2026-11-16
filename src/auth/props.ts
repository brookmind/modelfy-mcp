import { z } from "zod";

export const TokenKindSchema = z.enum(["oauth", "live", "test", "anonymous"]);
export type TokenKind = z.infer<typeof TokenKindSchema>;

/** A sandbox key that spends like a person in a chat or like a budgeted bot */
export const ActsAsSchema = z.enum(["person", "bot"]);
export type ActsAs = z.infer<typeof ActsAsSchema>;

/** Which agent-facing text a connection gets; "bare" exists for evals only */
export const AgentLayerSchema = z.enum(["v0", "bare"]);
export type AgentLayer = z.infer<typeof AgentLayerSchema>;

/** A live key's limits: the most one launch, and one UTC day, can cost. */
export const BudgetLimitsSchema = z.object({
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
  sandboxId: z.string().nullable(),
  budget: BudgetLimitsSchema.nullable(),
  // Defaults keep grants stored before these fields existed valid
  actsAs: ActsAsSchema.nullable().default(null),
  agentLayer: AgentLayerSchema.default("v0"),
});
export type GrantProps = z.infer<typeof GrantPropsSchema>;

export function parseProps(value: unknown): GrantProps | null {
  const parsed = GrantPropsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
