import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { call, connect, ORIGIN } from "../helpers/worker";

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const FRONT = `${ORIGIN}/sandbox/demo/tee-front.png`;
const BACK = `${ORIGIN}/sandbox/demo/tee-back.png`;
const PAGE = `${ORIGIN}/sandbox/demo/product`;

const Added = z.object({
  photos: z.array(
    z.object({
      source_url: z.string(),
      upload_id: z.string().optional(),
      error: z.string().optional(),
    }),
  ),
});

async function anonymousKey(ip: string): Promise<string> {
  const response = await call("/sandbox/keys", {
    method: "POST",
    headers: { "CF-Connecting-IP": ip },
  });
  return z.object({ api_key: z.string() }).parse(await response.json()).api_key;
}

function noOutboundFetch(): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(() => {
    throw new Error("The demo must not be fetched over the network");
  });
}

describe("the sandbox demo product", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the product page links both product images", async () => {
    const response = await call("/sandbox/demo/product");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(html).toContain(FRONT);
    expect(html).toContain(BACK);
  });

  it.each([FRONT, BACK])("%s is a PNG image", async (url) => {
    const response = await call(new URL(url).pathname);
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect([...bytes.slice(0, 8)]).toEqual(PNG_SIGNATURE);
  });

  it("add_product_photos takes the demo images without a network fetch", async () => {
    const client = await connect(await anonymousKey("192.0.2.140"));
    noOutboundFetch();

    const result = await client.callTool({
      name: "add_product_photos",
      arguments: { image_urls: [FRONT, BACK] },
    });
    const { photos } = Added.parse(result.structuredContent);

    expect(photos.map((photo) => photo.upload_id)).toEqual([
      expect.stringMatching(/^sbx_/),
      expect.stringMatching(/^sbx_/),
    ]);
  });

  it("add_product_photos refuses the demo page: it is not an image", async () => {
    const client = await connect(await anonymousKey("192.0.2.141"));
    noOutboundFetch();

    const result = await client.callTool({
      name: "add_product_photos",
      arguments: { image_urls: [PAGE] },
    });
    const { photos } = Added.parse(result.structuredContent);

    expect(photos[0]?.upload_id).toBeUndefined();
    expect(photos[0]?.error).toContain("not an image");
  });
});

describe("anonymous call limit", () => {
  it("the 61st call in a minute from one key is 429", async () => {
    const key = await anonymousKey("192.0.2.142");
    const ping = (): Promise<Response> =>
      call("/mcp", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      });
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++) statuses.push((await ping()).status);
    const refused = await ping();

    expect(statuses.slice(0, 60).every((status) => status !== 429)).toBe(true);
    expect(statuses[60]).toBe(429);
    expect(refused.headers.get("Retry-After")).toBe("60");
    expect(await refused.json()).toMatchObject({ error: "rate_limited" });
  }, 60_000);
});
