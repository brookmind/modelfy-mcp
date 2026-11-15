import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { call, connect, json, mockApi } from "../helpers/worker";

const TEST_KEY = `mfy_test_${"T".repeat(43)}`;

function testKeyApi(): Response {
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

async function sandboxKey(
  body: Record<string, string>,
  ip: string,
): Promise<string> {
  const response = await call("/sandbox/keys", {
    method: "POST",
    headers: { "CF-Connecting-IP": ip, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return z.object({ api_key: z.string() }).parse(await response.json()).api_key;
}

/** Every `description` found anywhere inside a JSON schema. */
function descriptionsIn(schema: unknown): string[] {
  if (Array.isArray(schema)) return schema.flatMap(descriptionsIn);
  if (typeof schema !== "object" || schema === null) return [];
  return Object.entries(schema).flatMap(([key, value]) =>
    key === "description" && typeof value === "string"
      ? [value]
      : descriptionsIn(value),
  );
}

const ErrorText = z.array(
  z.object({ type: z.string(), text: z.string().optional() }),
);

describe("the v0 agent layer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps today's instructions, tools and descriptions", async () => {
    mockApi(testKeyApi);
    const client = await connect(TEST_KEY);

    const tools = await client.listTools();

    expect({
      instructions: client.getInstructions(),
      tools: tools.tools,
    }).toMatchSnapshot();
  });
});

describe("the bare agent layer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends no instructions", async () => {
    mockApi(() => json(500, {}));
    const client = await connect(
      await sandboxKey({ agent_layer: "bare" }, "198.51.100.60"),
    );

    expect(client.getInstructions()).toBeUndefined();
  });

  it("has one short sentence per tool and no schema descriptions", async () => {
    mockApi(() => json(500, {}));
    const client = await connect(
      await sandboxKey({ agent_layer: "bare" }, "198.51.100.61"),
    );

    const { tools } = await client.listTools();
    const plan = tools.find((tool) => tool.name === "plan_photos");

    expect(plan?.description).toBe("Plans a photo session.");
    expect(
      tools.flatMap((tool) => [
        ...descriptionsIn(tool.inputSchema),
        ...descriptionsIn(tool.outputSchema),
      ]),
    ).toEqual([]);
  });

  it("has no get_docs tool and no docs resources", async () => {
    mockApi(() => json(500, {}));
    const client = await connect(
      await sandboxKey({ agent_layer: "bare" }, "198.51.100.62"),
    );

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).not.toContain("get_docs");
    expect((await client.listResources()).resources).toEqual([]);
  });

  it("returns errors with only a code and a message", async () => {
    mockApi(() => json(500, {}));
    const client = await connect(
      await sandboxKey({ agent_layer: "bare" }, "198.51.100.63"),
    );

    const result = await client.callTool({
      name: "generate_photos",
      arguments: { quote_id: "unknown" },
    });
    const [text, payload] = ErrorText.parse(result.content).map(
      (part) => part.text ?? "",
    );

    expect(text).toBe(
      "QUOTE_EXPIRED: This quote does not exist or expired (quotes last 30 minutes).",
    );
    expect(JSON.parse(payload ?? "{}")).toEqual({
      error: {
        code: "QUOTE_EXPIRED",
        message:
          "This quote does not exist or expired (quotes last 30 minutes).",
      },
    });
  });

  it("still enforces the person's consent", async () => {
    mockApi(() => json(500, {}));
    const client = await connect(
      await sandboxKey(
        { agent_layer: "bare", acts_as: "person" },
        "198.51.100.64",
      ),
    );
    const added = z.object({ quote_id: z.string() }).parse(
      (
        await client.callTool({
          name: "plan_photos",
          arguments: {
            products: [{ upload_ids: ["sbx_x"] }],
            background_id: "sbx_set_terrace",
            aspect_ratio: "4:5",
            photos_per_product: 1,
          },
        })
      ).structuredContent,
    );

    const result = await client.callTool({
      name: "generate_photos",
      arguments: { quote_id: added.quote_id },
    });

    expect(ErrorText.parse(result.content)[0]?.text).toMatch(
      /^CONFIRMATION_REQUIRED: /,
    );
  });
});
