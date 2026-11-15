import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { guarded, respond, type Session } from "../session";

const NoInput = z.object({});

const BudgetOut = z.object({
  maxCreditsPerSession: z.number(),
  maxCreditsPerDay: z.number(),
  spentToday: z.number(),
  resetsAt: z.string(),
});

const AccountOut = z.object({
  credits: z.number().describe("Credits available now"),
  plan: z.string().nullable(),
  creditsPerPhoto: z.number().nullable(),
  keyKind: z.enum(["oauth", "live", "test", "anonymous"]),
  sandbox: z.boolean().describe("True for test keys: nothing is spent"),
  budget: BudgetOut.nullable().describe("Live keys only"),
});

const ModelsOut = z.object({
  models: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      source: z.enum(["own", "modelfy"]),
      ready: z.boolean().describe("Only ready models can be used"),
      age: z.number().nullable(),
      photoUrl: z.string().nullable(),
    }),
  ),
});

const BackgroundsOut = z.object({
  backgrounds: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      source: z.enum(["own", "gallery"]),
      description: z.string().nullable(),
      ready: z.boolean(),
      photoUrl: z.string().nullable(),
    }),
  ),
});

const OptionsOut = z.object({
  aspectRatios: z.array(z.string()),
  photosPerProduct: z.object({
    min: z.number(),
    max: z.number(),
    default: z.number(),
  }),
  shotTypes: z.object({
    withModel: z.array(z.string()),
    withoutModel: z.array(z.string()),
  }),
  resolutions: z.array(z.string()).nullable(),
  qualities: z.array(z.string()).nullable(),
  defaults: z.object({
    resolution: z.string().nullable(),
    quality: z.string().nullable(),
  }),
  outfitStyles: z.array(z.string()),
  maxModels: z.number(),
});

const READ_ONLY = { readOnlyHint: true, openWorldHint: false };

export function registerAccountTools(
  server: McpServer,
  session: Session,
): void {
  server.registerTool(
    "get_account",
    {
      title: "Modelfy account",
      description:
        "The account's credits, plan and price per photo. For a live API key also its budget and what it spent today; for test keys, sandbox: true. Free.",
      inputSchema: NoInput,
      outputSchema: AccountOut,
      annotations: READ_ONLY,
    },
    () =>
      guarded(session, async () => {
        const account = await session.backend.account();
        return respond(
          `${account.credits} credits available${account.sandbox ? " (sandbox)" : ""}.`,
          { ...account },
        );
      }),
  );

  server.registerTool(
    "list_models",
    {
      title: "Models",
      description:
        "People who can wear or hold the product: the account's own models and Modelfy's ready-made ones. Use their ids in plan_photos (model_ids). Free.",
      inputSchema: NoInput,
      outputSchema: ModelsOut,
      annotations: READ_ONLY,
    },
    () =>
      guarded(session, async () => {
        const models = await session.backend.models();
        return respond(`${models.length} models.`, { models });
      }),
  );

  server.registerTool(
    "list_backgrounds",
    {
      title: "Backgrounds",
      description:
        "Real places for a photo session: the account's own and Modelfy's gallery. Use an id in plan_photos (background_id), or describe a place instead. Free.",
      inputSchema: NoInput,
      outputSchema: BackgroundsOut,
      annotations: READ_ONLY,
    },
    () =>
      guarded(session, async () => {
        const backgrounds = await session.backend.backgrounds();
        return respond(`${backgrounds.length} backgrounds.`, { backgrounds });
      }),
  );

  server.registerTool(
    "get_photo_options",
    {
      title: "Photo options",
      description:
        "What a photo session accepts: aspect ratios, photos per product, shot types, resolutions and qualities (they change the price), outfit styles. Free.",
      inputSchema: NoInput,
      outputSchema: OptionsOut,
      annotations: READ_ONLY,
    },
    () =>
      guarded(session, async () => {
        const options = await session.backend.options();
        return respond(`Formats: ${options.aspectRatios.join(", ")}.`, {
          ...options,
        });
      }),
  );
}
