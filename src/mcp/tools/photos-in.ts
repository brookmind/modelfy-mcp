import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { MAX_UPLOAD_FILES } from "../../backend/types";
import type { Describe } from "../layer";
import { guarded, respond, type Session } from "../session";

// Schema builders take the layer's describe and return the exact zod type,
// which only inference can spell (module-private)
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- see above
function addInput(d: Describe) {
  return z.object({
    image_urls: d(
      z.array(z.url()).min(1).max(MAX_UPLOAD_FILES),
      "Public links to the product's image files (the front first). Not web pages: the image itself.",
    ),
  });
}

const AddOutput = z.object({
  photos: z.array(
    z.union([
      z.object({ source_url: z.string(), upload_id: z.string() }),
      z.object({ source_url: z.string(), error: z.string() }),
    ]),
  ),
});

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- schema builder
function sessionInput(d: Describe) {
  return z.object({
    files: d(
      z
        .array(
          z.object({
            content_type: d(
              z.string(),
              "image/jpeg, image/png, image/webp, image/heic",
            ),
            bytes: d(z.number().int().positive(), "File size in bytes"),
          }),
        )
        .max(MAX_UPLOAD_FILES)
        .default([]),
      "Files your code will upload: each gets a presigned PUT. Leave empty when a person will use the page.",
    ),
  });
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- schema builder
function sessionOutput(d: Describe) {
  return z.object({
    session_id: z.string(),
    page_url: d(z.string(), "A page a signed-in person opens to drop photos"),
    expires_at: z.string(),
    uploads: z.array(
      z.object({
        upload_id: z.string(),
        put_url: z.string(),
        headers: z.record(z.string(), z.string()),
      }),
    ),
  });
}

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
  const { layer } = session;
  server.registerTool(
    "add_product_photos",
    {
      title: "Add product photos from links",
      description: layer.tool(
        "add_product_photos",
        "Downloads product photos from public image links (for example the store's product page images) and returns upload ids for plan_photos. Free. For files on a computer or phone use create_upload_session.",
      ),
      inputSchema: addInput(layer.describe),
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
      description: layer.tool(
        "create_upload_session",
        "For photos that are not online. Returns (1) page_url: a page a person opens (signed in to Modelfy) to drop photos, for chat assistants; (2) for each announced file, a presigned PUT your code sends the bytes to (never send image bytes through the model). Then call get_uploaded_photos. Free; up to 10 files; valid 1 hour.",
      ),
      inputSchema: sessionInput(layer.describe),
      outputSchema: sessionOutput(layer.describe),
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
      description: layer.tool(
        "get_uploaded_photos",
        "Confirms what has arrived in an upload session: ready_upload_ids (pass them to plan_photos as upload_ids), pending (files not arrived yet) and rejected (each with its reason). Free.",
      ),
      inputSchema: ReadInput,
      outputSchema: ReadOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ session_id }) =>
      guarded(session, async () => {
        const state = await session.backend.readUploadSession(session_id);
        // The ids in the sentence itself: a coding agent in the evals looked
        // for a `ready` field and reported the upload as rejected
        const ready =
          state.ready_upload_ids.length > 0
            ? layer.guidance(
                ` Ready upload ids: ${state.ready_upload_ids.join(", ")}; pass them to plan_photos as upload_ids.`,
              )
            : "";
        const waiting =
          state.pending > 0
            ? layer.guidance(
                " Pending files have not arrived yet: call get_uploaded_photos again in a few seconds.",
              )
            : "";
        return respond(
          `${state.ready_upload_ids.length} ready, ${state.pending} pending, ${state.rejected.length} rejected.${ready}${waiting}`,
          { ...state },
        );
      }),
  );
}
