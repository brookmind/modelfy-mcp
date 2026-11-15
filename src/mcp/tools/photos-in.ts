import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { guarded, respond, type Session } from "../session";

const MAX_FILES = 10;

const AddInput = z.object({
  image_urls: z
    .array(z.url())
    .min(1)
    .max(MAX_FILES)
    .describe(
      "Public links to the product's image files (the front first). Not web pages: the image itself.",
    ),
});

const AddOutput = z.object({
  photos: z.array(
    z.union([
      z.object({ source_url: z.string(), upload_id: z.string() }),
      z.object({ source_url: z.string(), error: z.string() }),
    ]),
  ),
});

const SessionInput = z.object({
  files: z
    .array(
      z.object({
        content_type: z
          .string()
          .describe("image/jpeg, image/png, image/webp, image/heic"),
        bytes: z.number().int().positive().describe("File size in bytes"),
      }),
    )
    .max(MAX_FILES)
    .default([])
    .describe(
      "Files your code will upload: each gets a presigned PUT. Leave empty when a person will use the page.",
    ),
});

const SessionOutput = z.object({
  session_id: z.string(),
  page_url: z
    .string()
    .describe("A page a signed-in person opens to drop photos"),
  expires_at: z.string(),
  uploads: z.array(
    z.object({
      upload_id: z.string(),
      put_url: z.string(),
      headers: z.record(z.string(), z.string()),
    }),
  ),
});

const ReadInput = z.object({ session_id: z.string().min(1) });

const ReadOutput = z.object({
  ready_upload_ids: z.array(z.string()),
  pending: z.number(),
  rejected: z.array(z.object({ upload_id: z.string(), reason: z.string() })),
});

export function registerPhotoInputTools(
  server: McpServer,
  session: Session,
): void {
  server.registerTool(
    "add_product_photos",
    {
      title: "Add product photos from links",
      description:
        "Downloads product photos from public image links (for example the store's product page images) and returns upload ids for plan_photos. Free. For files on a computer or phone use create_upload_session.",
      inputSchema: AddInput,
      outputSchema: AddOutput,
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    ({ image_urls }) =>
      guarded(session, async () => {
        const photos = await session.backend.addPhotosFromUrls(image_urls);
        const ok = photos.filter((photo) => "upload_id" in photo).length;
        return respond(`${ok} of ${photos.length} photos added.`, { photos });
      }),
  );

  server.registerTool(
    "create_upload_session",
    {
      title: "Upload product photos",
      description:
        "For photos that are not online. Returns (1) page_url: a page a person opens (signed in to Modelfy) to drop photos, for chat assistants; (2) for each announced file, a presigned PUT your code sends the bytes to (never send image bytes through the model). Then call get_uploaded_photos. Free; up to 10 files; valid 1 hour.",
      inputSchema: SessionInput,
      outputSchema: SessionOutput,
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    ({ files }) =>
      guarded(session, async () => {
        const created = await session.backend.createUploadSession(files);
        return respond(`Upload session ready. Page: ${created.page_url}`, {
          ...created,
        });
      }),
  );

  server.registerTool(
    "get_uploaded_photos",
    {
      title: "Uploaded photos",
      description:
        "Confirms what has arrived in an upload session: ready upload ids for plan_photos, files still pending, and rejected files with the reason. Free.",
      inputSchema: ReadInput,
      outputSchema: ReadOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ session_id }) =>
      guarded(session, async () => {
        const state = await session.backend.readUploadSession(session_id);
        return respond(
          `${state.ready_upload_ids.length} ready, ${state.pending} pending, ${state.rejected.length} rejected.`,
          { ...state },
        );
      }),
  );
}
