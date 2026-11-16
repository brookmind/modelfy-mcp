import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { call, connect, json, mockApi, type ApiCall } from "../helpers/worker";

const TEST_KEY = `mfy_test_${"T".repeat(43)}`;
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const PLAN = {
  model_ids: ["staff-1"],
  background_id: "set-1",
  aspect_ratio: "4:5",
  photos_per_product: 2,
};

function catalogApi(call: ApiCall): Response {
  if (call.path === "/v2/connections/me") {
    return json(200, {
      data: {
        userId: "user-1",
        kind: "TEST",
        name: "Try",
        credits: 0,
        budget: null,
      },
    });
  }
  if (call.path.startsWith("/v2/cast")) {
    return json(200, {
      data: {
        items: [
          {
            id: "own-1",
            source: "user",
            name: "Mine",
            age: null,
            status: "READY",
            references: [],
          },
          {
            id: "staff-1",
            source: "staff",
            name: "Carla",
            age: 28,
            status: "READY",
            references: [{ view: "front", url: "https://cdn.test/carla.jpg" }],
          },
        ],
        nextCursor: null,
      },
    });
  }
  return json(404, { error: "NOT_FOUND" });
}

function images(request: Request): Response {
  return new URL(request.url).pathname.endsWith(".png")
    ? new Response(PNG, { headers: { "Content-Type": "image/png" } })
    : new Response(null, { status: 404 });
}

const Added = z.object({
  photos: z.array(z.object({ upload_id: z.string() })),
});
const Quote = z.object({ quote_id: z.string(), credits: z.number() });

function textOf(content: unknown): string {
  return z
    .array(z.object({ type: z.string(), text: z.string().optional() }))
    .parse(content)
    .map((part) => part.text ?? "")
    .join("\n");
}

async function anonymousKey(ip = "192.0.2.50"): Promise<string> {
  const response = await call("/sandbox/keys", {
    method: "POST",
    headers: { "CF-Connecting-IP": ip },
  });
  return z.object({ api_key: z.string() }).parse(await response.json()).api_key;
}

describe("the sandbox", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a test key's whole flow succeeds without any paid API call", async () => {
    const calls = mockApi(catalogApi, images);
    const client = await connect(TEST_KEY);

    const account = await client.callTool({
      name: "get_account",
      arguments: {},
    });
    const added = Added.parse(
      (
        await client.callTool({
          name: "add_product_photos",
          arguments: { image_urls: ["https://shop.test/dress.png"] },
        })
      ).structuredContent,
    );
    const uploadId = added.photos[0]?.upload_id ?? "";
    const quote = Quote.parse(
      (
        await client.callTool({
          name: "plan_photos",
          arguments: { ...PLAN, products: [{ upload_ids: [uploadId] }] },
        })
      ).structuredContent,
    );
    const launched = await client.callTool({
      name: "generate_photos",
      arguments: { quote_id: quote.quote_id },
    });
    const sessionId = z
      .object({ session_id: z.string() })
      .parse(launched.structuredContent).session_id;
    const done = await client.callTool({
      name: "get_photo_session",
      arguments: { session_id: sessionId, wait_seconds: 15 },
    });

    expect(account.structuredContent).toMatchObject({
      credits: 10000,
      sandbox: true,
      keyKind: "test",
    });
    expect(uploadId).toMatch(/^sbx_/);
    expect(quote.credits).toBe(40);
    expect(done.structuredContent).toMatchObject({
      status: "completed",
      done: 2,
    });
    expect(
      calls.filter(
        (c) =>
          c.method !== "GET" ||
          c.path.startsWith("/v2/billing") ||
          c.path.startsWith("/v2/shoots/"),
      ),
    ).toEqual([]);
  }, 30_000);

  it.each([
    ["sandbox:insufficient_credits", "INSUFFICIENT_CREDITS"],
    ["sandbox:budget_exceeded", "BUDGET_EXCEEDED"],
  ])("a product named %s returns %s", async (name, code) => {
    mockApi(catalogApi, images);
    const client = await connect(TEST_KEY);

    const result = await client.callTool({
      name: "plan_photos",
      arguments: {
        ...PLAN,
        products: [{ upload_ids: ["sbx_x"], name }],
      },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result.content)).toContain(code);
  });

  it("a product named sandbox:fail makes the session fail", async () => {
    mockApi(catalogApi, images);
    const client = await connect(TEST_KEY);
    const quote = Quote.parse(
      (
        await client.callTool({
          name: "plan_photos",
          arguments: {
            ...PLAN,
            products: [{ upload_ids: ["sbx_x"], name: "sandbox:fail" }],
          },
        })
      ).structuredContent,
    );
    const launched = await client.callTool({
      name: "generate_photos",
      arguments: { quote_id: quote.quote_id },
    });
    const sessionId = z
      .object({ session_id: z.string() })
      .parse(launched.structuredContent).session_id;

    const done = await client.callTool({
      name: "get_photo_session",
      arguments: { session_id: sessionId, wait_seconds: 15 },
    });

    expect(done.structuredContent).toMatchObject({ status: "failed" });
  }, 30_000);

  it("real upload ids are refused in the sandbox", async () => {
    mockApi(catalogApi, images);
    const client = await connect(TEST_KEY);

    const result = await client.callTool({
      name: "plan_photos",
      arguments: { ...PLAN, products: [{ upload_ids: ["01HREAL"] }] },
    });

    expect(textOf(result.content)).toContain("INVALID_INPUT");
  });

  it("code uploads: announced files PUT to the sandbox are ready", async () => {
    mockApi(catalogApi, images);
    const client = await connect(TEST_KEY);
    const created = z
      .object({
        session_id: z.string(),
        uploads: z.array(
          z.object({ upload_id: z.string(), put_url: z.string() }),
        ),
      })
      .parse(
        (
          await client.callTool({
            name: "create_upload_session",
            arguments: { files: [{ content_type: "image/png", bytes: 8 }] },
          })
        ).structuredContent,
      );
    const slot = created.uploads[0];

    const put = await exports.default.fetch(
      new Request(slot?.put_url ?? "", { method: "PUT", body: PNG }),
    );
    const state = await client.callTool({
      name: "get_uploaded_photos",
      arguments: { session_id: created.session_id },
    });

    expect(put.status).toBe(200);
    expect(state.structuredContent).toEqual({
      ready_upload_ids: [slot?.upload_id],
      pending: 0,
      rejected: [],
    });
  });

  it("files PUT at the same moment are all ready, none is lost", async () => {
    mockApi(catalogApi, images);
    const client = await connect(TEST_KEY);
    const created = z
      .object({
        session_id: z.string(),
        uploads: z.array(
          z.object({ upload_id: z.string(), put_url: z.string() }),
        ),
      })
      .parse(
        (
          await client.callTool({
            name: "create_upload_session",
            arguments: {
              files: Array.from({ length: 6 }, () => ({
                content_type: "image/png",
                bytes: 8,
              })),
            },
          })
        ).structuredContent,
      );

    await Promise.all(
      created.uploads.map((slot) =>
        exports.default.fetch(
          new Request(slot.put_url, { method: "PUT", body: PNG }),
        ),
      ),
    );
    const state = z
      .object({ ready_upload_ids: z.array(z.string()), pending: z.number() })
      .parse(
        (
          await client.callTool({
            name: "get_uploaded_photos",
            arguments: { session_id: created.session_id },
          })
        ).structuredContent,
      );

    expect(state.pending).toBe(0);
    expect([...state.ready_upload_ids].sort()).toEqual(
      created.uploads.map((slot) => slot.upload_id).sort(),
    );
  });

  it("a PUT that declares more than 15 MB is refused without reading it", async () => {
    mockApi(catalogApi, images);
    const client = await connect(TEST_KEY);
    const created = z
      .object({ uploads: z.array(z.object({ put_url: z.string() })) })
      .parse(
        (
          await client.callTool({
            name: "create_upload_session",
            arguments: { files: [{ content_type: "image/png", bytes: 8 }] },
          })
        ).structuredContent,
      );

    const put = await exports.default.fetch(
      new Request(created.uploads[0]?.put_url ?? "", {
        method: "PUT",
        headers: { "Content-Length": String(16 * 1024 * 1024) },
        body: PNG,
      }),
    );

    expect(put.status).toBe(400);
  });

  it("an anonymous key sees only Modelfy's ready-made models", async () => {
    mockApi(catalogApi, images);
    const client = await connect(await anonymousKey());

    const result = await client.callTool({
      name: "list_models",
      arguments: {},
    });

    expect(
      z
        .object({ models: z.array(z.object({ id: z.string() })) })
        .parse(result.structuredContent)
        .models.map((model) => model.id),
    ).toEqual(["staff-1"]);
  });

  it("cancelling a sandbox session twice keeps it cancelled", async () => {
    mockApi(catalogApi, images);
    const client = await connect(TEST_KEY);
    const quote = Quote.parse(
      (
        await client.callTool({
          name: "plan_photos",
          arguments: { ...PLAN, products: [{ upload_ids: ["sbx_x"] }] },
        })
      ).structuredContent,
    );
    const sessionId = z.object({ session_id: z.string() }).parse(
      (
        await client.callTool({
          name: "generate_photos",
          arguments: { quote_id: quote.quote_id },
        })
      ).structuredContent,
    ).session_id;

    await client.callTool({
      name: "cancel_photo_session",
      arguments: { session_id: sessionId },
    });
    await new Promise((resolve) => setTimeout(resolve, 4500));
    const again = await client.callTool({
      name: "cancel_photo_session",
      arguments: { session_id: sessionId },
    });

    expect(again.structuredContent).toMatchObject({ status: "cancelled" });
  }, 30_000);
});

describe("sandbox keys that act as a person or a bot", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function keyActingAs(
    actsAs: "person" | "bot",
    ip: string,
  ): Promise<string> {
    const response = await call("/sandbox/keys", {
      method: "POST",
      headers: { "CF-Connecting-IP": ip, "Content-Type": "application/json" },
      body: JSON.stringify({ acts_as: actsAs }),
    });
    return z.object({ api_key: z.string() }).parse(await response.json())
      .api_key;
  }

  async function plan(
    client: Awaited<ReturnType<typeof connect>>,
    photos: number,
  ): Promise<z.infer<typeof Quote>> {
    return Quote.parse(
      (
        await client.callTool({
          name: "plan_photos",
          arguments: {
            ...PLAN,
            photos_per_product: photos,
            products: [{ upload_ids: ["sbx_x"] }],
          },
        })
      ).structuredContent,
    );
  }

  const ErrorJson = z.object({
    error: z.object({
      code: z.string(),
      budget: z
        .object({
          limit: z.string(),
          requested: z.number(),
          maxCreditsPerSession: z.number(),
          spentToday: z.number(),
        })
        .optional(),
    }),
  });

  function errorOf(content: unknown): z.infer<typeof ErrorJson> {
    const json = z
      .array(z.object({ type: z.string(), text: z.string().optional() }))
      .parse(content)
      .map((part) => part.text ?? "")
      .find((text) => text.startsWith("{"));
    return ErrorJson.parse(JSON.parse(json ?? "{}"));
  }

  it("a person key gets the consent instructions", async () => {
    mockApi(catalogApi, images);
    const client = await connect(await keyActingAs("person", "192.0.2.101"));

    expect(client.getInstructions()).toContain(
      "show them the credits from plan_photos and ask",
    );
  });

  it("a person key needs user_confirmed to launch", async () => {
    mockApi(catalogApi, images);
    const client = await connect(await keyActingAs("person", "192.0.2.102"));
    const quote = await plan(client, 2);

    const refused = await client.callTool({
      name: "generate_photos",
      arguments: { quote_id: quote.quote_id },
    });
    const launched = await client.callTool({
      name: "generate_photos",
      arguments: { quote_id: quote.quote_id, user_confirmed: true },
    });

    expect(errorOf(refused.content).error.code).toBe("CONFIRMATION_REQUIRED");
    expect(launched.isError).not.toBe(true);
  });

  it("a plain sandbox key still launches without user_confirmed", async () => {
    mockApi(catalogApi, images);
    const client = await connect(await anonymousKey("192.0.2.103"));
    const quote = await plan(client, 2);

    const launched = await client.callTool({
      name: "generate_photos",
      arguments: { quote_id: quote.quote_id },
    });

    expect(launched.isError).not.toBe(true);
  });

  it("a bot key shows the default live budget", async () => {
    mockApi(catalogApi, images);
    const client = await connect(await keyActingAs("bot", "192.0.2.104"));
    const tomorrow = new Date();
    tomorrow.setUTCHours(24, 0, 0, 0);

    const account = await client.callTool({
      name: "get_account",
      arguments: {},
    });
    const quote = await client.callTool({
      name: "plan_photos",
      arguments: { ...PLAN, products: [{ upload_ids: ["sbx_x"] }] },
    });

    expect(account.structuredContent).toMatchObject({
      sandbox: true,
      budget: {
        maxCreditsPerSession: 100,
        maxCreditsPerDay: 500,
        spentToday: 0,
        resetsAt: tomorrow.toISOString(),
      },
    });
    expect(quote.structuredContent).toMatchObject({
      budget: { session_limit: 100, left_today: 500 },
    });
    expect(client.getInstructions()).toContain("BUDGET_EXCEEDED");
  });

  it("a bot key refuses a session over its per-session budget", async () => {
    mockApi(catalogApi, images);
    const client = await connect(await keyActingAs("bot", "192.0.2.105"));
    const quote = await plan(client, 6);

    const refused = await client.callTool({
      name: "generate_photos",
      arguments: { quote_id: quote.quote_id },
    });

    expect(errorOf(refused.content).error).toMatchObject({
      code: "BUDGET_EXCEEDED",
      budget: { limit: "session", requested: 120, maxCreditsPerSession: 100 },
    });
  });

  it("a bot key refuses a launch over its daily budget", async () => {
    mockApi(catalogApi, images);
    const client = await connect(await keyActingAs("bot", "192.0.2.106"));
    for (let i = 0; i < 5; i++) {
      const quote = await plan(client, 5);
      const launched = await client.callTool({
        name: "generate_photos",
        arguments: { quote_id: quote.quote_id },
      });
      expect(launched.isError).not.toBe(true);
    }
    const sixth = await plan(client, 5);

    const refused = await client.callTool({
      name: "generate_photos",
      arguments: { quote_id: sixth.quote_id },
    });
    const account = await client.callTool({
      name: "get_account",
      arguments: {},
    });

    expect(errorOf(refused.content).error).toMatchObject({
      code: "BUDGET_EXCEEDED",
      budget: { limit: "day", requested: 100, spentToday: 500 },
    });
    expect(account.structuredContent).toMatchObject({
      budget: { spentToday: 500 },
    });
  }, 60_000);
});
