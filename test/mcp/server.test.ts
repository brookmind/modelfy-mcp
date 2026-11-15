import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  call,
  connect,
  json,
  mockApi,
  oauthAccessToken,
  registerClient,
  type ApiCall,
} from "../helpers/worker";

const LIVE = `mfy_live_${"L".repeat(43)}`;
const OAUTH_TOKEN = `mfy_oauth_${"A".repeat(43)}`;

const BUDGET = {
  maxCreditsPerSession: 100,
  maxCreditsPerDay: 500,
  spentToday: 120,
  resetsAt: "2026-11-16T00:00:00.000Z",
};

function api(call: ApiCall): Response {
  if (call.path === "/v2/connections/codes/redeem") {
    return json(200, { data: { userId: "user-1", token: OAUTH_TOKEN } });
  }
  if (call.path === "/v2/connections/me") {
    const oauth = call.authorization === `Bearer ${OAUTH_TOKEN}`;
    return json(200, {
      data: {
        userId: "user-1",
        kind: oauth ? "OAUTH" : "LIVE",
        name: "Store bot",
        credits: 880,
        budget: oauth ? null : BUDGET,
      },
    });
  }
  if (call.path === "/v2/billing") {
    return json(200, {
      data: {
        current: { name: "Growth" },
        creditsPer: { photo: 20, video5s: 60, ugc15s: 120 },
      },
    });
  }
  if (call.path.startsWith("/v2/cast")) {
    return json(200, {
      data: {
        items: [
          {
            id: "cast-1",
            source: "staff",
            name: "Carla",
            age: 28,
            attributes: {},
            status: "READY",
            references: [{ view: "front", url: "https://cdn.test/carla.jpg" }],
          },
          {
            id: "cast-2",
            source: "user",
            name: "Draft",
            age: null,
            attributes: {},
            status: "GENERATING",
            references: [],
          },
        ],
        nextCursor: null,
      },
    });
  }
  if (call.path.startsWith("/v2/sets")) {
    return json(200, {
      data: {
        items: [
          {
            id: "set-1",
            source: "gallery",
            origin: "GENERATED",
            name: "Terrace",
            description: "A sunny terrace",
            status: "READY",
            usable: true,
            plates: [
              {
                id: "p1",
                state: "APPROVED",
                url: "https://cdn.test/terrace.jpg",
                width: 1024,
                height: 1024,
              },
            ],
            createdAt: "2026-11-01T00:00:00.000Z",
          },
        ],
        nextCursor: null,
      },
    });
  }
  if (call.path.startsWith("/v2/shoots/options")) {
    return json(200, {
      data: {
        mode: "PHOTO_SESSION",
        locationPresets: ["beach"],
        outfitStyles: ["CASUAL", "ELEGANT"],
        timesOfDay: ["golden hour"],
        shotTypes: { withModel: ["full-body"], withoutModel: ["packshot"] },
        aspectRatios: ["1:1", "4:5"],
        resolutions: ["1K", "2K"],
        qualities: null,
        defaults: { resolution: "2K" },
        photosPerProduct: { min: 1, max: 8, default: 4 },
        castMax: 3,
        backPhotoCategories: [],
        wardrobeByCategory: {},
      },
    });
  }
  return json(404, { error: "NOT_FOUND" });
}

describe("the MCP server", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("initialize returns the instructions for a live key", async () => {
    mockApi(api);
    const client = await connect(LIVE);

    const instructions = client.getInstructions() ?? "";

    expect(instructions).toContain("plan_photos");
    expect(instructions).toContain("budget");
  });

  it("initialize tells an OAuth connection to ask the person before spending", async () => {
    mockApi(api);
    const client = await connect(await oauthAccessToken());

    expect(client.getInstructions() ?? "").toContain("user_confirmed");
  });

  it("lists the read tools with input and output schemas", async () => {
    mockApi(api);
    const client = await connect(LIVE);

    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);

    for (const name of [
      "get_account",
      "list_models",
      "list_backgrounds",
      "get_photo_options",
    ]) {
      expect(names).toContain(name);
      const tool = tools.find((candidate) => candidate.name === name);
      expect(tool?.outputSchema).toBeDefined();
      expect(tool?.annotations?.readOnlyHint).toBe(true);
    }
  });

  it("get_account returns the balance and, for a live key, the budget and today's spend", async () => {
    mockApi(api);
    const client = await connect(LIVE);

    const result = await client.callTool({
      name: "get_account",
      arguments: {},
    });

    expect(result.structuredContent).toEqual({
      credits: 880,
      plan: "Growth",
      creditsPerPhoto: 20,
      keyKind: "live",
      sandbox: false,
      budget: {
        maxCreditsPerSession: 100,
        maxCreditsPerDay: 500,
        spentToday: 120,
        resetsAt: "2026-11-16T00:00:00.000Z",
      },
    });
  });

  it("list_models returns ids, names, readiness and a photo", async () => {
    mockApi(api);
    const client = await connect(LIVE);

    const result = await client.callTool({
      name: "list_models",
      arguments: {},
    });

    expect(result.structuredContent).toEqual({
      models: [
        {
          id: "cast-1",
          name: "Carla",
          source: "modelfy",
          ready: true,
          age: 28,
          photoUrl: "https://cdn.test/carla.jpg",
        },
        {
          id: "cast-2",
          name: "Draft",
          source: "own",
          ready: false,
          age: null,
          photoUrl: null,
        },
      ],
    });
  });

  it("list_backgrounds and get_photo_options return the catalog", async () => {
    mockApi(api);
    const client = await connect(LIVE);

    const backgrounds = await client.callTool({
      name: "list_backgrounds",
      arguments: {},
    });
    const options = await client.callTool({
      name: "get_photo_options",
      arguments: {},
    });

    expect(backgrounds.structuredContent).toEqual({
      backgrounds: [
        {
          id: "set-1",
          name: "Terrace",
          source: "gallery",
          description: "A sunny terrace",
          ready: true,
          photoUrl: "https://cdn.test/terrace.jpg",
        },
      ],
    });
    expect(options.structuredContent).toMatchObject({
      aspectRatios: ["1:1", "4:5"],
      photosPerProduct: { min: 1, max: 8, default: 4 },
      resolutions: ["1K", "2K"],
      qualities: null,
      maxModels: 3,
    });
  });

  it("a 401 from the API ends the connection: CONNECTION_REVOKED, then the token stops working", async () => {
    let revoked = false;
    mockApi((request) =>
      revoked && request.path !== "/v2/connections/codes/redeem"
        ? json(401, { error: "UNAUTHORIZED" })
        : api(request),
    );
    const token = await oauthAccessToken();
    const client = await connect(token);
    revoked = true;

    const result = await client.callTool({
      name: "get_account",
      arguments: {},
    });
    const after = await call("/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "ping" }),
    });

    expect(result.isError).toBe(true);
    const text = z
      .array(z.object({ type: z.literal("text"), text: z.string() }))
      .parse(result.content)
      .map((part) => part.text)
      .join("\n");
    expect(text).toContain("CONNECTION_REVOKED");
    expect(after.status).toBe(401);
  });

  it("a 401 on one device's grant leaves the same client's other grant working", async () => {
    const tokens = [
      `mfy_oauth_${"B".repeat(43)}`,
      `mfy_oauth_${"C".repeat(43)}`,
    ];
    let redeemed = 0;
    mockApi((request) => {
      if (request.path === "/v2/connections/codes/redeem") {
        const token = tokens[redeemed] ?? "";
        redeemed += 1;
        return json(200, { data: { userId: "user-1", token } });
      }
      if (request.authorization === `Bearer ${tokens[0] ?? ""}`) {
        return json(401, { error: "UNAUTHORIZED" });
      }
      return api(request);
    });
    const client = await registerClient();
    const first = await connect(await oauthAccessToken(client));
    const second = await connect(await oauthAccessToken(client));

    const revoked = await first.callTool({
      name: "get_account",
      arguments: {},
    });
    const still = await second.callTool({ name: "get_account", arguments: {} });

    expect(revoked.isError).toBe(true);
    expect(still.isError).not.toBe(true);
  });

  it("a wrong server secret is a server error, never a reason to sign people out", async () => {
    let secretBroken = false;
    mockApi((request) =>
      secretBroken && request.path !== "/v2/connections/codes/redeem"
        ? json(401, { error: "MCP_SECRET_INVALID" })
        : api(request),
    );
    const token = await oauthAccessToken();
    const client = await connect(token);
    secretBroken = true;

    const result = await client.callTool({
      name: "get_account",
      arguments: {},
    });
    secretBroken = false;
    const after = await client.callTool({ name: "get_account", arguments: {} });

    const text = z
      .array(z.object({ type: z.literal("text"), text: z.string() }))
      .parse(result.content)
      .map((part) => part.text)
      .join("\n");
    expect(text).toContain("MODELFY_ERROR");
    expect(text).not.toContain("CONNECTION_REVOKED");
    expect(after.isError).not.toBe(true);
  });
});
