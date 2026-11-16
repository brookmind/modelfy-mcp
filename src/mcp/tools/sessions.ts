import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  SESSION_STATES,
  SHOT_TYPES,
  type SessionStatus,
} from "../../backend/types";
import { base64 } from "../../crypto";
import { AgentError } from "../errors";
import { markLaunched, readQuote, saveQuote } from "../quotes";
import type { Describe, LayerText } from "../layer";
import { guarded, respond, type Session } from "../session";
import { spendingRule } from "../spending";

const MAX_WAIT_SECONDS = 45;
const POLL_MS = 2000;
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 1024 * 1024;
/** What chat clients render as images; anything else stays a link. */
const RASTER_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

// Schema builders take the layer's describe and return the exact zod type,
// which only inference can spell (module-private)
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- see above
function planInput(d: Describe) {
  return z.object({
    products: z
      .array(
        z.object({
          upload_ids: d(
            z.array(z.string()).min(1).max(2),
            "From add_product_photos or get_uploaded_photos; the front first, then an optional detail",
          ),
          name: z.string().max(80).optional(),
          description: z.string().max(500).optional(),
        }),
      )
      .min(1),
    mode: d(
      z.enum(["place", "studio"]).default("place"),
      "place: a real place (needs background_id or place_description); studio: a plain color background",
    ),
    background_color: d(
      z.string().max(30).optional(),
      "Studio only, in words: white, light grey…",
    ),
    model_ids: d(
      z.array(z.string()).max(3).optional(),
      "From list_models; empty for product-only photos",
    ),
    background_id: d(z.string().optional(), "From list_backgrounds"),
    place_description: d(
      z.string().max(300).optional(),
      "Or describe a real place in words",
    ),
    aspect_ratio: d(
      z.string(),
      "One of get_photo_options aspectRatios, e.g. 4:5. Ask the person if they did not say",
    ),
    photos_per_product: d(
      z.number().int().min(1),
      "Ask the person if they did not say",
    ),
    shot_types: z.array(z.enum(SHOT_TYPES)).optional(),
    outfit: d(
      z
        .object({
          style: z.string().optional(),
          note: z.string().max(200).optional(),
        })
        .optional(),
      "What the model wears",
    ),
    direction: d(
      z.string().max(500).optional(),
      "Creative direction in the person's words",
    ),
    resolution: z.string().optional(),
    quality: z.string().optional(),
    locale: d(z.string().default("en"), "The person's language, e.g. en, es"),
  });
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- schema builder
function planOutput(d: Describe) {
  return z.object({
    quote_id: z.string(),
    expires_at: z.string(),
    credits: z.number(),
    photos: z.number(),
    with_model: z.number(),
    without_model: z.number(),
    enough_credits: z.boolean(),
    balance: z.number(),
    budget: d(
      z
        .object({ session_limit: z.number(), left_today: z.number() })
        .nullable(),
      "Live keys only",
    ),
    mood: z.string().nullable(),
  });
}

const SessionOutput = z.object({
  session_id: z.string(),
  name: z.string(),
  status: z.enum(SESSION_STATES),
  total: z.number(),
  done: z.number(),
  failed: z.number(),
  credits: z.object({
    reserved: z.number(),
    charged: z.number(),
    refunded: z.number(),
  }),
  photos: z.array(
    z.object({
      photo_id: z.string(),
      url: z.string(),
      preview_url: z.string().nullable(),
      product: z.string().nullable(),
    }),
  ),
  web_url: z.string(),
});

const RecentOutput = z.object({
  photos: z.array(
    z.object({
      photo_id: z.string(),
      url: z.string(),
      created_at: z.string(),
      session_id: z.string().nullable(),
      session_name: z.string().nullable(),
    }),
  ),
});

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Up to 4 finished photos as image content, so the chat can show them: the
 * small preview when Modelfy has one, since a full photo is rarely under 1 MB.
 */
async function imageContent(
  status: SessionStatus,
): Promise<CallToolResult["content"]> {
  const images = await Promise.all(
    status.photos.slice(0, MAX_IMAGES).map(async (photo) => {
      const preview =
        photo.preview_url !== null ? await smallImage(photo.preview_url) : [];
      // No preview, or one that cannot be shown: the photo itself, if small
      return preview.length > 0 ? preview : smallImage(photo.url);
    }),
  );
  return images.flat();
}

/** One photo as image content, or nothing: it then stays a link. */
async function smallImage(url: string): Promise<CallToolResult["content"]> {
  try {
    const response = await fetch(url);
    const type =
      (response.headers.get("Content-Type") ?? "").split(";")[0]?.trim() ?? "";
    const declared = Number(response.headers.get("Content-Length") ?? "0");
    if (!response.ok || !RASTER_TYPES.has(type) || declared > MAX_IMAGE_BYTES) {
      // Decided from the headers: the photo itself is not downloaded
      await response.body?.cancel();
      return [];
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_BYTES) return [];
    return [{ type: "image", data: base64(bytes), mimeType: type }];
  } catch {
    return [];
  }
}

function statusSentence(status: SessionStatus, layer: LayerText): string {
  return status.status === "running"
    ? `Session ${status.session_id}: ${status.done} of ${status.total} photos ready.${layer.guidance(" Call get_photo_session again with wait_seconds.")}`
    : `Session ${status.session_id} is ${status.status}: ${status.done} of ${status.total} photos. See them at ${status.web_url}`;
}

export function registerSessionTools(
  server: McpServer,
  session: Session,
): void {
  const { layer } = session;
  server.registerTool(
    "plan_photos",
    {
      title: "Plan a photo session",
      description: layer.tool(
        "plan_photos",
        "Plans a photo session and returns its exact price in credits and a quote_id for generate_photos. Nothing is spent. aspect_ratio and photos_per_product are required: ask the person if they did not say.",
      ),
      inputSchema: planInput(layer.describe),
      outputSchema: planOutput(layer.describe),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (input) =>
      guarded(session, async () => {
        const [plan, account] = await Promise.all([
          session.backend.plan(input),
          session.backend.account(),
        ]);
        const quote = await saveQuote(
          session.env.OAUTH_KV,
          session.owner,
          plan.stored,
        );
        const budget =
          account.budget === null
            ? null
            : {
                session_limit: account.budget.maxCreditsPerSession,
                left_today: Math.max(
                  0,
                  account.budget.maxCreditsPerDay - account.budget.spentToday,
                ),
              };
        const ask =
          spendingRule(session.props) === "person"
            ? layer.guidance(
                " Ask the person before calling generate_photos with user_confirmed: true.",
              )
            : "";
        return respond(
          `${plan.stored.photos} photos for ${plan.stored.credits} credits (balance ${account.credits}).${ask}`,
          {
            quote_id: quote.id,
            expires_at: quote.expiresAt,
            credits: plan.stored.credits,
            photos: plan.stored.photos,
            with_model: plan.withModel,
            without_model: plan.withoutModel,
            enough_credits: plan.enoughCredits,
            balance: account.credits,
            budget,
            mood: plan.mood,
          },
        );
      }),
  );

  server.registerTool(
    "generate_photos",
    {
      title: "Generate the planned photos",
      description: layer.tool(
        "generate_photos",
        "Launches the session planned by plan_photos (spends its credits; failed photos are refunded). Needs the quote_id. When a person is in the conversation, show them the price and set user_confirmed: true only after they agree. Then follow it with get_photo_session.",
      ),
      inputSchema: z.object({
        quote_id: z.string(),
        user_confirmed: layer.describe(
          z.boolean().optional(),
          "True only after the person said yes to this exact price",
        ),
      }),
      outputSchema: SessionOutput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ quote_id, user_confirmed }) =>
      guarded(session, async () => {
        const kv = session.env.OAUTH_KV;
        const quote = await readQuote(kv, session.owner, quote_id);
        if (quote === "expired") {
          throw new AgentError(
            "QUOTE_EXPIRED",
            "This quote does not exist or expired (quotes last 30 minutes).",
            "Call plan_photos again and use its new quote_id.",
          );
        }
        if (quote === "not_yours") {
          throw new AgentError(
            "QUOTE_NOT_YOURS",
            "This quote belongs to another connection.",
            "Call plan_photos with this connection.",
          );
        }
        if (quote.sessionId !== null) {
          const existing = await session.backend.session(quote.sessionId);
          return respond(statusSentence(existing, layer), { ...existing });
        }
        if (
          spendingRule(session.props) === "person" &&
          user_confirmed !== true
        ) {
          throw new AgentError(
            "CONFIRMATION_REQUIRED",
            `This launch spends ${quote.plan.credits} credits for ${quote.plan.photos} photos and needs the person's yes.`,
            "Show the person the price, and call generate_photos again with user_confirmed: true only if they agree.",
          );
        }
        const status = await session.backend.launch(quote.plan, quote_id);
        await markLaunched(kv, quote_id, quote, status.session_id);
        return respond(statusSentence(status, layer), { ...status });
      }),
  );

  server.registerTool(
    "get_photo_session",
    {
      title: "Photo session status",
      description: layer.tool(
        "get_photo_session",
        "A session's progress and its finished photos (shown as images when small enough, always with links). wait_seconds (up to 45) waits until it finishes. Free.",
      ),
      inputSchema: z.object({
        session_id: z.string(),
        wait_seconds: z.number().int().min(0).max(MAX_WAIT_SECONDS).default(0),
      }),
      outputSchema: SessionOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ session_id, wait_seconds }) =>
      guarded(session, async () => {
        const deadline = Date.now() + wait_seconds * 1000;
        let status = await session.backend.session(session_id);
        while (
          status.status === "running" &&
          Date.now() + POLL_MS <= deadline
        ) {
          await wait(POLL_MS);
          status = await session.backend.session(session_id);
        }
        const result = respond(statusSentence(status, layer), { ...status });
        result.content.push(...(await imageContent(status)));
        return result;
      }),
  );

  server.registerTool(
    "list_recent_photos",
    {
      title: "Recent photos",
      description: layer.tool(
        "list_recent_photos",
        "The latest photos of the account, newest first, optionally of one session. Free.",
      ),
      inputSchema: z.object({
        limit: z.number().int().min(1).max(30).default(10),
        session_id: z.string().optional(),
      }),
      outputSchema: RecentOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ limit, session_id }) =>
      guarded(session, async () => {
        const photos = await session.backend.recent(limit, session_id ?? null);
        return respond(`${photos.length} photos.`, { photos });
      }),
  );

  server.registerTool(
    "cancel_photo_session",
    {
      title: "Cancel a photo session",
      description: layer.tool(
        "cancel_photo_session",
        "Stops a running session. Photos not started yet are cancelled and their credits refunded; finished photos stay.",
      ),
      inputSchema: z.object({ session_id: z.string() }),
      outputSchema: SessionOutput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    ({ session_id }) =>
      guarded(session, async () => {
        const status = await session.backend.cancel(session_id);
        return respond(statusSentence(status, layer), { ...status });
      }),
  );
}
