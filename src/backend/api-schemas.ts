import { z } from "zod";

/** `/v2` response shapes used by the API backend (from the API's OpenAPI). */

export const MeSchema = z.object({
  userId: z.string(),
  kind: z.enum(["LIVE", "TEST", "OAUTH"]),
  name: z.string(),
  credits: z.number(),
  budget: z
    .object({
      maxCreditsPerSession: z.number(),
      maxCreditsPerDay: z.number(),
      spentToday: z.number(),
      resetsAt: z.string(),
    })
    .nullable(),
});

export const BillingSchema = z.object({
  current: z.object({ name: z.string() }).nullable(),
  creditsPer: z.object({ photo: z.number().nullable() }),
});

export const CastListSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      source: z.enum(["user", "staff"]),
      name: z.string(),
      age: z.number().nullable(),
      status: z.string(),
      references: z.array(z.object({ view: z.string(), url: z.string() })),
    }),
  ),
});

export const SetListSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      source: z.enum(["user", "gallery"]),
      name: z.string(),
      description: z.string().nullable(),
      usable: z.boolean(),
      plates: z.array(z.object({ url: z.string() })),
    }),
  ),
});

export const ShootOptionsSchema = z.object({
  outfitStyles: z.array(z.string()),
  shotTypes: z.object({
    withModel: z.array(z.string()),
    withoutModel: z.array(z.string()),
  }),
  aspectRatios: z.array(z.string()),
  resolutions: z.array(z.string()).nullable(),
  qualities: z.array(z.string()).nullable(),
  defaults: z.object({
    resolution: z.string().optional(),
    quality: z.string().optional(),
  }),
  photosPerProduct: z.object({
    min: z.number(),
    max: z.number(),
    default: z.number(),
  }),
  castMax: z.number(),
});
