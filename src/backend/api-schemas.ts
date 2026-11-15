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

export const CreatedUploadSchema = z.object({
  uploadId: z.string(),
  uploadUrl: z.string(),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.string(),
});

export const ConfirmedUploadSchema = z.object({ uploadId: z.string() });

export const UploadSessionSchema = z.object({
  id: z.string(),
  pageUrl: z.string(),
  expiresAt: z.string(),
});

export const UploadSessionStateSchema = z.object({
  confirmed: z.array(z.object({ uploadId: z.string() })),
  pending: z.number(),
  rejected: z.array(z.object({ uploadId: z.string(), reason: z.string() })),
});

export const PreviewSchema = z.object({
  seed: z.number(),
  creativePrompt: z.string(),
  moodPhrase: z.string().nullable(),
  moderation: z.object({ verdict: z.string() }).nullable(),
  direction: z.record(z.string(), z.unknown()).nullable(),
  summary: z.object({
    products: z.number(),
    shots: z.number(),
    withModel: z.number(),
    withoutModel: z.number(),
  }),
  credits: z.number(),
  balanceOk: z.boolean(),
});

export const ShootDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["RUNNING", "COMPLETED", "PARTIAL", "FAILED", "CANCELLED"]),
  counts: z.object({
    queued: z.number(),
    running: z.number(),
    succeeded: z.number(),
    failed: z.number(),
    cancelled: z.number(),
  }),
  credits: z.object({
    reserved: z.number(),
    charged: z.number(),
    refunded: z.number(),
  }),
  items: z.array(z.object({ id: z.string(), name: z.string().nullable() })),
  shots: z.array(
    z.object({
      itemId: z.string(),
      status: z.string(),
      media: z.object({ id: z.string(), url: z.string() }).nullable(),
    }),
  ),
});

export const LibrarySchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      url: z.string(),
      createdAt: z.string(),
      shoot: z.object({ id: z.string(), name: z.string() }).optional(),
    }),
  ),
});

export const OkSchema = z.object({ ok: z.literal(true) });
