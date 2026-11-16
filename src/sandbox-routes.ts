import { randomBase64Url } from "./crypto";
import { MAX_BYTES } from "./backend/download";
import { readUploadState, writeUploadState } from "./backend/sandbox-backend";
import { MAX_UPLOAD_FILES } from "./backend/types";
import { htmlPage } from "./pages/layout";
import {
  DEMO_IMAGE_FILES,
  demoImage,
  samplePhotoSvg,
} from "./backend/sandbox-fixtures";

function html(status: number, body: string): Response {
  return htmlPage("Modelfy sandbox", body, status);
}

/** A product page to try "photos from a product link" in the sandbox. */
function demoRoute(name: string, publicUrl: string): Response | null {
  if (name === "product") {
    const images = DEMO_IMAGE_FILES.map(
      (file) =>
        `<img src="${publicUrl}/sandbox/demo/${file}" alt="Linen T-shirt" width="240" height="300">`,
    ).join("");
    return html(
      200,
      `<h1>Linen T-shirt</h1><p>€29</p><p>A relaxed T-shirt in washed linen, sand colour. Sizes XS to XL.</p>${images}<p><small>Modelfy sandbox demo product.</small></p>`,
    );
  }
  const image = demoImage(name);
  if (image === null) return null;
  return new Response(image, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400",
    },
  });
}

/** Routes of the sandbox's fake storage and sample photos (design §7). */
export async function sandboxRoute(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  const parts = pathname.split("/").filter((part) => part !== "");
  if (parts[0] !== "sandbox") return null;

  if (request.method === "GET" && parts[1] === "demo" && parts.length === 3) {
    return demoRoute(parts[2] ?? "", env.PUBLIC_URL);
  }

  if (request.method === "GET" && parts[1] === "photos" && parts.length === 3) {
    const index = Number.parseInt(parts[2] ?? "", 10);
    if (!Number.isInteger(index) || index < 0 || index > 3) return null;
    return new Response(samplePhotoSvg(index), {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=86400",
      },
    });
  }

  if (request.method === "PUT" && parts[1] === "put" && parts.length === 4) {
    const [, , sessionId = "", uploadId = ""] = parts;
    const state = await readUploadState(env.OAUTH_KV, sessionId);
    if (state === null || state.files[uploadId] !== "pending") {
      return Response.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    const bytes = (await request.arrayBuffer()).byteLength;
    if (bytes === 0 || bytes > MAX_BYTES) {
      return Response.json({ error: "UPLOAD_REJECTED" }, { status: 400 });
    }
    state.files[uploadId] = "ready";
    await writeUploadState(env.OAUTH_KV, sessionId, state);
    return new Response(null, { status: 200 });
  }

  if (parts[1] === "upload" && parts.length === 3) {
    const sessionId = parts[2] ?? "";
    const state = await readUploadState(env.OAUTH_KV, sessionId);
    if (state === null) {
      return html(
        404,
        "<h1>This sandbox link expired</h1><p>Ask your assistant for a new one.</p>",
      );
    }
    if (request.method === "POST") {
      const form = await request.formData();
      let added = 0;
      for (const value of form.getAll("photos")) {
        if (typeof value === "string" || !value.type.startsWith("image/"))
          continue;
        if (Object.keys(state.files).length >= MAX_UPLOAD_FILES) break;
        state.files[`sbx_${randomBase64Url(12)}`] = "ready";
        added += 1;
      }
      await writeUploadState(env.OAUTH_KV, sessionId, state);
      return html(
        200,
        `<h1>${added} sample photos received</h1><p>Go back to your assistant.</p>`,
      );
    }
    return html(
      200,
      `<h1>Sandbox upload</h1><p>Choose product photos. Nothing is kept: this is the sandbox.</p><form method="post" enctype="multipart/form-data"><input type="file" name="photos" accept="image/*" multiple required><p><button type="submit">Upload</button></p></form>`,
    );
  }

  if (
    request.method === "GET" &&
    parts[1] === "sessions" &&
    parts.length === 3
  ) {
    return html(
      200,
      "<h1>Sandbox session</h1><p>Sample photos are shown in your assistant. Use a live key for real photos.</p>",
    );
  }
  return null;
}
