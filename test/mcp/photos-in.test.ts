import { afterEach, describe, expect, it, vi } from "vitest";
import { safeImageFetch } from "../../src/backend/download";
import { connect, json, mockApi, type ApiCall } from "../helpers/worker";

const LIVE = `mfy_live_${"L".repeat(43)}`;
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function me(): Response {
  return json(200, {
    data: {
      userId: "user-1",
      kind: "LIVE",
      name: "Bot",
      credits: 900,
      budget: null,
    },
  });
}

function uploadsApi(call: ApiCall): Response {
  if (call.path === "/v2/connections/me") return me();
  if (call.path === "/v2/uploads") {
    return json(200, {
      data: {
        uploadId: "up-1",
        uploadUrl: "https://r2.test/up-1",
        headers: { "Content-Type": "image/png" },
        expiresAt: "2026-11-15T11:00:00.000Z",
      },
    });
  }
  if (call.path === "/v2/uploads/up-1/confirm") {
    return json(200, {
      data: {
        uploadId: "up-1",
        status: "CONFIRMED",
        kind: "IMAGE",
        contentType: "image/png",
        bytes: 8,
        width: 10,
        height: 10,
        durationSeconds: null,
      },
    });
  }
  if (call.path === "/v2/upload-sessions") {
    return json(200, {
      data: {
        id: "sess-1",
        pageUrl: "https://web.test/upload/sess-1",
        expiresAt: "2026-11-15T11:00:00.000Z",
      },
    });
  }
  if (call.path === "/v2/upload-sessions/sess-1/uploads") {
    return json(200, {
      data: {
        uploadId: "up-9",
        uploadUrl: "https://r2.test/up-9",
        headers: { "Content-Type": "image/jpeg" },
        expiresAt: "2026-11-15T10:15:00.000Z",
      },
    });
  }
  if (call.path === "/v2/upload-sessions/sess-1") {
    return json(200, {
      data: {
        confirmed: [
          {
            uploadId: "up-9",
            status: "CONFIRMED",
            kind: "IMAGE",
            contentType: "image/jpeg",
            bytes: 3,
            width: 10,
            height: 10,
            durationSeconds: null,
          },
        ],
        pending: 1,
        rejected: [{ uploadId: "up-8", reason: "corrupt" }],
        expiresAt: "2026-11-15T11:00:00.000Z",
      },
    });
  }
  return json(404, { error: "NOT_FOUND" });
}

function imageHost(request: Request): Response {
  const url = new URL(request.url);
  if (url.origin === "https://r2.test")
    return new Response(null, { status: 200 });
  if (url.pathname === "/dress.png") {
    return new Response(PNG, { headers: { "Content-Type": "image/png" } });
  }
  if (url.pathname === "/page.html") {
    return new Response("<html>", { headers: { "Content-Type": "text/html" } });
  }
  if (url.pathname === "/to-local") {
    return new Response(null, {
      status: 302,
      headers: { Location: "http://127.0.0.1/secret.png" },
    });
  }
  if (url.pathname === "/huge.png") {
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1;
        if (sent > 20) controller.close();
        else controller.enqueue(chunk);
      },
    });
    return new Response(body, { headers: { "Content-Type": "image/png" } });
  }
  return new Response(null, { status: 404 });
}

describe("safeImageFetch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("downloads a public image", async () => {
    mockApi(uploadsApi, imageHost);

    const image = await safeImageFetch("https://shop.test/dress.png");

    expect(image.contentType).toBe("image/png");
    expect(image.bytes.byteLength).toBe(8);
  });

  it.each([
    ["a page that is not an image", "https://shop.test/page.html"],
    ["an IP-literal host", "http://10.0.0.1/a.png"],
    ["localhost", "http://localhost/a.png"],
    ["a redirect to a private address", "https://shop.test/to-local"],
    ["another scheme", "file:///etc/passwd"],
  ])("refuses %s", async (_label, url) => {
    mockApi(uploadsApi, imageHost);

    await expect(safeImageFetch(url)).rejects.toMatchObject({
      code: "PHOTO_REJECTED",
    });
  });

  it("stops a body past 15 MB", async () => {
    mockApi(uploadsApi, imageHost);

    await expect(
      safeImageFetch("https://shop.test/huge.png"),
    ).rejects.toMatchObject({ code: "PHOTO_REJECTED" });
  });
});

describe("product photo tools", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("add_product_photos turns a public image URL into a confirmed upload id", async () => {
    const calls = mockApi(uploadsApi, imageHost);
    const client = await connect(LIVE);

    const result = await client.callTool({
      name: "add_product_photos",
      arguments: {
        image_urls: [
          "https://shop.test/dress.png",
          "https://shop.test/page.html",
        ],
      },
    });

    expect(result.structuredContent).toEqual({
      photos: [
        { source_url: "https://shop.test/dress.png", upload_id: "up-1" },
        {
          source_url: "https://shop.test/page.html",
          error: "https://shop.test/page.html: not an image",
        },
      ],
    });
    expect(calls.find((call) => call.path === "/v2/uploads")?.body).toEqual({
      contentType: "image/png",
      bytes: 8,
    });
  });

  it("create_upload_session returns the page and a PUT per announced file", async () => {
    mockApi(uploadsApi, imageHost);
    const client = await connect(LIVE);

    const result = await client.callTool({
      name: "create_upload_session",
      arguments: { files: [{ content_type: "image/jpeg", bytes: 1234 }] },
    });

    expect(result.structuredContent).toEqual({
      session_id: "sess-1",
      page_url: "https://web.test/upload/sess-1",
      expires_at: "2026-11-15T11:00:00.000Z",
      uploads: [
        {
          upload_id: "up-9",
          put_url: "https://r2.test/up-9",
          headers: { "Content-Type": "image/jpeg" },
        },
      ],
    });
  });

  it("get_uploaded_photos lists ready, pending and rejected files", async () => {
    mockApi(uploadsApi, imageHost);
    const client = await connect(LIVE);

    const result = await client.callTool({
      name: "get_uploaded_photos",
      arguments: { session_id: "sess-1" },
    });

    expect(result.structuredContent).toEqual({
      ready_upload_ids: ["up-9"],
      pending: 1,
      rejected: [{ upload_id: "up-8", reason: "corrupt" }],
    });
  });
});
