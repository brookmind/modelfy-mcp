import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  connect,
  json,
  mockApi,
  oauthAccessToken,
  type ApiCall,
} from "../helpers/worker";

const LIVE = `mfy_live_${"L".repeat(43)}`;
const OTHER_LIVE = `mfy_live_${"M".repeat(43)}`;
const OAUTH_TOKEN = `mfy_oauth_${"A".repeat(43)}`;
const JPEG = new Uint8Array([255, 216, 255, 224]);

const PLAN = {
  products: [{ upload_ids: ["up-1"], name: "Linen dress" }],
  model_ids: ["cast-1"],
  background_id: "set-1",
  aspect_ratio: "4:5",
  photos_per_product: 4,
  locale: "en",
};

function detail(status: string, succeeded: number): unknown {
  return {
    data: {
      id: "shoot-1",
      mode: "PHOTO_SESSION",
      backgroundColor: null,
      name: "Linen dress",
      status,
      setId: "set-1",
      location: null,
      modelMode: "WITH_MODEL",
      aspectRatio: "4:5",
      model: { recommended: true },
      moodPhrase: null,
      outfit: null,
      onboarding: false,
      counts: {
        queued: 0,
        running: 4 - succeeded,
        succeeded,
        failed: 0,
        cancelled: 0,
      },
      credits: { reserved: 80, charged: succeeded * 20, refunded: 0 },
      items: [
        {
          id: "item-1",
          position: 0,
          name: "Linen dress",
          categoryKey: null,
          shopifyProductId: null,
        },
      ],
      shots: Array.from({ length: 4 }, (_, i) => ({
        id: `shot-${i}`,
        itemId: "item-1",
        index: i,
        label: "full-body",
        withModel: true,
        extra: false,
        status: i < succeeded ? "SUCCEEDED" : "RUNNING",
        tries: 1,
        credits: 20,
        media:
          i < succeeded
            ? { id: `media-${i}`, url: `https://cdn.test/photo-${i}.jpg` }
            : null,
      })),
      createdAt: "2026-11-15T10:00:00.000Z",
      completedAt: succeeded === 4 ? "2026-11-15T10:02:00.000Z" : null,
      cancelledAt: null,
    },
  };
}

interface ApiOptions {
  launch?: (call: ApiCall) => Response;
  statuses?: Array<[string, number]>;
}

function sessionsApi(options: ApiOptions = {}): (call: ApiCall) => Response {
  const statuses = [...(options.statuses ?? [["COMPLETED", 4]])];
  return (call) => {
    if (call.path === "/v2/connections/codes/redeem") {
      return json(200, { data: { userId: "user-1", token: OAUTH_TOKEN } });
    }
    if (call.path === "/v2/connections/me") {
      const oauth = call.authorization === `Bearer ${OAUTH_TOKEN}`;
      return json(200, {
        data: {
          userId: "user-1",
          kind: oauth ? "OAUTH" : "LIVE",
          name: "Bot",
          credits: 900,
          budget: oauth
            ? null
            : {
                maxCreditsPerSession: 100,
                maxCreditsPerDay: 500,
                spentToday: 120,
                resetsAt: "2026-11-16T00:00:00.000Z",
              },
        },
      });
    }
    if (call.path === "/v2/billing") {
      return json(200, {
        data: { current: { name: "Growth" }, creditsPer: { photo: 20 } },
      });
    }
    if (call.path === "/v2/shoots/preview") {
      return json(200, {
        data: {
          seed: 7,
          creativePrompt: "Warm terrace light.",
          moodPhrase: "Sunny and relaxed",
          moderation: null,
          location: null,
          locationModeration: null,
          direction: null,
          summary: {
            products: 1,
            shots: 4,
            withModel: 4,
            withoutModel: 0,
            byShotType: {},
          },
          credits: 80,
          balanceOk: true,
        },
      });
    }
    if (call.method === "POST" && call.path === "/v2/shoots") {
      return options.launch?.(call) ?? json(201, detail("RUNNING", 0));
    }
    if (call.path === "/v2/shoots/shoot-1/cancel") {
      return json(200, { data: { ok: true } });
    }
    if (call.path === "/v2/shoots/shoot-1") {
      const [status, succeeded] =
        statuses.length > 1
          ? (statuses.shift() ?? ["COMPLETED", 4])
          : (statuses[0] ?? ["COMPLETED", 4]);
      return json(200, detail(status, succeeded));
    }
    if (call.path.startsWith("/v2/library")) {
      return json(200, {
        data: {
          items: [
            {
              id: "media-0",
              type: "image",
              url: "https://cdn.test/photo-0.jpg",
              width: 800,
              height: 1000,
              createdAt: "2026-11-15T10:02:00.000Z",
              source: "v2",
              mode: "PHOTO_SESSION",
              shoot: { id: "shoot-1", name: "Linen dress" },
            },
          ],
          nextCursor: null,
        },
      });
    }
    return json(404, { error: "NOT_FOUND" });
  };
}

function cdn(): Response {
  return new Response(JPEG, { headers: { "Content-Type": "image/jpeg" } });
}

const QuoteOut = z.object({ quote_id: z.string(), credits: z.number() });

function textOf(content: unknown): string {
  return z
    .array(z.object({ type: z.string(), text: z.string().optional() }))
    .parse(content)
    .map((part) => part.text ?? "")
    .join("\n");
}

describe("plan, generate and follow photo sessions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists all 12 tools", async () => {
    mockApi(sessionsApi(), cdn);
    const client = await connect(LIVE);

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "add_product_photos",
      "cancel_photo_session",
      "create_upload_session",
      "generate_photos",
      "get_account",
      "get_photo_options",
      "get_photo_session",
      "get_uploaded_photos",
      "list_backgrounds",
      "list_models",
      "list_recent_photos",
      "plan_photos",
    ]);
  });

  it("plan_photos previews with Modelfy Recommended, stores a quote and returns its credits", async () => {
    const calls = mockApi(sessionsApi(), cdn);
    const client = await connect(LIVE);

    const result = await client.callTool({
      name: "plan_photos",
      arguments: PLAN,
    });
    const plan = QuoteOut.parse(result.structuredContent);

    expect(plan.credits).toBe(80);
    expect(result.structuredContent).toMatchObject({
      photos: 4,
      enough_credits: true,
      balance: 900,
      budget: { session_limit: 100, left_today: 380 },
    });
    expect(calls.find((c) => c.path === "/v2/shoots/preview")?.body).toEqual({
      mode: "PHOTO_SESSION",
      castIds: ["cast-1"],
      setId: "set-1",
      products: [{ uploadIds: ["up-1"], name: "Linen dress" }],
      photosPerProduct: 4,
      aspectRatio: "4:5",
      model: { recommended: true },
      locale: "en",
    });
  });

  it("plan_photos without a place asks for one (MISSING_CHOICE) and calls nothing paid", async () => {
    const calls = mockApi(sessionsApi(), cdn);
    const client = await connect(LIVE);

    const result = await client.callTool({
      name: "plan_photos",
      arguments: { ...PLAN, background_id: undefined },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result.content)).toContain("MISSING_CHOICE");
    expect(calls.some((c) => c.path === "/v2/shoots/preview")).toBe(false);
  });

  it("a live key launches from the quote without confirmation, with the quote as idempotency key", async () => {
    const calls = mockApi(sessionsApi(), cdn);
    const client = await connect(LIVE);
    const plan = QuoteOut.parse(
      (await client.callTool({ name: "plan_photos", arguments: PLAN }))
        .structuredContent,
    );

    const result = await client.callTool({
      name: "generate_photos",
      arguments: { quote_id: plan.quote_id },
    });

    expect(result.structuredContent).toMatchObject({
      session_id: "shoot-1",
      status: "running",
    });
    expect(
      calls.find((c) => c.method === "POST" && c.path === "/v2/shoots")?.body,
    ).toEqual({
      mode: "PHOTO_SESSION",
      castIds: ["cast-1"],
      setId: "set-1",
      products: [{ uploadIds: ["up-1"], name: "Linen dress" }],
      photosPerProduct: 4,
      aspectRatio: "4:5",
      model: { recommended: true },
      locale: "en",
      seed: 7,
      creativePrompt: "Warm terrace light.",
      moodPhrase: "Sunny and relaxed",
      idempotencyKey: plan.quote_id,
    });
  });

  it("a retried generate with the same quote never launches twice", async () => {
    const calls = mockApi(sessionsApi(), cdn);
    const client = await connect(LIVE);
    const plan = QuoteOut.parse(
      (await client.callTool({ name: "plan_photos", arguments: PLAN }))
        .structuredContent,
    );

    const first = await client.callTool({
      name: "generate_photos",
      arguments: { quote_id: plan.quote_id },
    });
    const again = await client.callTool({
      name: "generate_photos",
      arguments: { quote_id: plan.quote_id },
    });

    expect(again.structuredContent).toMatchObject({ session_id: "shoot-1" });
    expect(first.structuredContent).toMatchObject({ session_id: "shoot-1" });
    expect(
      calls.filter((c) => c.method === "POST" && c.path === "/v2/shoots"),
    ).toHaveLength(1);
  });

  it("generate without a valid quote, or with another key's quote, is refused and launches nothing", async () => {
    const calls = mockApi(sessionsApi(), cdn);
    const owner = await connect(LIVE);
    const plan = QuoteOut.parse(
      (await owner.callTool({ name: "plan_photos", arguments: PLAN }))
        .structuredContent,
    );
    const stranger = await connect(OTHER_LIVE);

    const unknown = await owner.callTool({
      name: "generate_photos",
      arguments: { quote_id: "nope" },
    });
    const notYours = await stranger.callTool({
      name: "generate_photos",
      arguments: { quote_id: plan.quote_id },
    });

    expect(textOf(unknown.content)).toContain("QUOTE_EXPIRED");
    expect(textOf(notYours.content)).toContain("QUOTE_NOT_YOURS");
    expect(
      calls.some((c) => c.method === "POST" && c.path === "/v2/shoots"),
    ).toBe(false);
  });

  it("an OAuth connection needs user_confirmed; the quote survives the refusal", async () => {
    const calls = mockApi(sessionsApi(), cdn);
    const client = await connect(await oauthAccessToken());
    const plan = QuoteOut.parse(
      (await client.callTool({ name: "plan_photos", arguments: PLAN }))
        .structuredContent,
    );

    const unconfirmed = await client.callTool({
      name: "generate_photos",
      arguments: { quote_id: plan.quote_id },
    });
    const confirmed = await client.callTool({
      name: "generate_photos",
      arguments: { quote_id: plan.quote_id, user_confirmed: true },
    });

    expect(textOf(unconfirmed.content)).toContain("CONFIRMATION_REQUIRED");
    expect(textOf(unconfirmed.content)).toContain("80 credits");
    expect(confirmed.structuredContent).toMatchObject({
      session_id: "shoot-1",
    });
    expect(
      calls.filter((c) => c.method === "POST" && c.path === "/v2/shoots"),
    ).toHaveLength(1);
  });

  it("a BUDGET_EXCEEDED from Modelfy is passed on with its numbers", async () => {
    mockApi(
      sessionsApi({
        launch: () =>
          json(403, {
            error: "BUDGET_EXCEEDED",
            message:
              "This launch needs 80 credits; this key allows 40 per session",
            budget: {
              limit: "session",
              requested: 80,
              maxCreditsPerSession: 40,
              maxCreditsPerDay: 500,
              spentToday: 0,
              resetsAt: "2026-11-16T00:00:00.000Z",
            },
          }),
      }),
      cdn,
    );
    const client = await connect(LIVE);
    const plan = QuoteOut.parse(
      (await client.callTool({ name: "plan_photos", arguments: PLAN }))
        .structuredContent,
    );

    const result = await client.callTool({
      name: "generate_photos",
      arguments: { quote_id: plan.quote_id },
    });

    expect(result.isError).toBe(true);
    const text = textOf(result.content);
    expect(text).toContain("BUDGET_EXCEEDED");
    expect(text).toContain('"maxCreditsPerSession":40');
  });

  it("get_photo_session waits until the session is done and returns the photos", async () => {
    mockApi(
      sessionsApi({
        statuses: [
          ["RUNNING", 2],
          ["COMPLETED", 4],
        ],
      }),
      cdn,
    );
    const client = await connect(LIVE);

    const result = await client.callTool({
      name: "get_photo_session",
      arguments: { session_id: "shoot-1", wait_seconds: 10 },
    });

    expect(result.structuredContent).toMatchObject({
      session_id: "shoot-1",
      status: "completed",
      done: 4,
      total: 4,
      web_url: "https://web.test/sessions/shoot-1",
    });
    expect(
      z
        .object({ photos: z.array(z.object({ url: z.string() })) })
        .parse(result.structuredContent).photos,
    ).toHaveLength(4);
    expect(
      z
        .array(z.object({ type: z.string() }))
        .parse(result.content)
        .filter((part) => part.type === "image"),
    ).toHaveLength(4);
  });

  it("cancel_photo_session cancels and returns the session's state", async () => {
    const calls = mockApi(sessionsApi({ statuses: [["CANCELLED", 1]] }), cdn);
    const client = await connect(LIVE);

    const result = await client.callTool({
      name: "cancel_photo_session",
      arguments: { session_id: "shoot-1" },
    });

    expect(calls.some((c) => c.path === "/v2/shoots/shoot-1/cancel")).toBe(
      true,
    );
    expect(result.structuredContent).toMatchObject({ status: "cancelled" });
  });

  it("list_recent_photos returns the latest photos with their session", async () => {
    mockApi(sessionsApi(), cdn);
    const client = await connect(LIVE);

    const result = await client.callTool({
      name: "list_recent_photos",
      arguments: { limit: 5 },
    });

    expect(result.structuredContent).toEqual({
      photos: [
        {
          photo_id: "media-0",
          url: "https://cdn.test/photo-0.jpg",
          created_at: "2026-11-15T10:02:00.000Z",
          session_id: "shoot-1",
          session_name: "Linen dress",
        },
      ],
    });
  });
});
