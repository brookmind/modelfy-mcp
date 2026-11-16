import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { call, connect, json, mockApi } from "../helpers/worker";

// What the evals showed agents get wrong (evals/REPORT.md, part 5)

const Text = z.array(
  z.object({ type: z.string(), text: z.string().optional() }),
);

function textOf(content: unknown): string {
  return Text.parse(content)
    .map((part) => part.text ?? "")
    .join("\n");
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

const PLAN = {
  mode: "studio",
  background_color: "white",
  aspect_ratio: "9:16",
};

describe("consent when the person said not to ask", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the instructions say an earlier 'no need to ask' is not a yes", async () => {
    mockApi(() => json(500, {}));
    const client = await connect(
      await sandboxKey({ acts_as: "person" }, "198.51.100.80"),
    );

    expect(client.getInstructions()).toContain(
      "even if they said before that you need not ask",
    );
  });

  it("plan_photos tells the agent to show this price and ask", async () => {
    mockApi(() => json(500, {}));
    const client = await connect(
      await sandboxKey({ acts_as: "person" }, "198.51.100.81"),
    );

    const plan = await client.callTool({
      name: "plan_photos",
      arguments: {
        ...PLAN,
        photos_per_product: 2,
        products: [{ upload_ids: ["sbx_x"] }],
      },
    });

    expect(textOf(plan.content)).toContain(
      "Show the person this price and ask",
    );
  });

  it("generate_photos says a yes counts only after the price was shown", async () => {
    mockApi(() => json(500, {}));
    const client = await connect(
      await sandboxKey({ acts_as: "person" }, "198.51.100.82"),
    );

    const { tools } = await client.listTools();
    const generate = tools.find((tool) => tool.name === "generate_photos");

    expect(generate?.description).toContain("after seeing this price");
  });
});

describe("a bot over its per-session budget", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("plan_photos says how many photos fit in one session and to split", async () => {
    mockApi(() => json(500, {}));
    const client = await connect(
      await sandboxKey({ acts_as: "bot" }, "198.51.100.83"),
    );

    const plan = await client.callTool({
      name: "plan_photos",
      arguments: {
        ...PLAN,
        photos_per_product: 8,
        products: [{ upload_ids: ["sbx_a"] }, { upload_ids: ["sbx_b"] }],
      },
    });
    const text = textOf(plan.content);

    // 100 credits per session at 20 per photo: 5 photos per session
    expect(text).toContain("over this key's budget per photo session");
    expect(text).toContain("at most 5 photos");
    expect(text).toContain("one at a time");
  });

  it("a plan within the session budget says nothing about splitting", async () => {
    mockApi(() => json(500, {}));
    const client = await connect(
      await sandboxKey({ acts_as: "bot" }, "198.51.100.84"),
    );

    const plan = await client.callTool({
      name: "plan_photos",
      arguments: {
        ...PLAN,
        photos_per_product: 4,
        products: [{ upload_ids: ["sbx_a"] }],
      },
    });

    expect(textOf(plan.content)).not.toContain("budget per photo session");
  });

  it("BUDGET_EXCEEDED's next step says to launch smaller sessions", async () => {
    mockApi(() => json(500, {}));
    const client = await connect(
      await sandboxKey({ acts_as: "bot" }, "198.51.100.85"),
    );
    const quote = z.object({ quote_id: z.string() }).parse(
      (
        await client.callTool({
          name: "plan_photos",
          arguments: {
            ...PLAN,
            photos_per_product: 8,
            products: [{ upload_ids: ["sbx_a"] }],
          },
        })
      ).structuredContent,
    );

    const refused = await client.callTool({
      name: "generate_photos",
      arguments: { quote_id: quote.quote_id },
    });

    expect(textOf(refused.content)).toContain("smaller sessions");
  });
});

describe("device codes over the hourly limit", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("answer rate_limited with when to start again, not slow_down", async () => {
    mockApi(() =>
      json(200, {
        data: {
          deviceCode: "dev-1",
          userCode: "WDJB-MJHT",
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
          interval: 5,
        },
      }),
    );
    const start = (): Promise<Response> =>
      call("/device/code", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "198.51.100.86",
        },
        body: JSON.stringify({ client_name: "Bot" }),
      });
    let last = await start();
    for (let i = 0; i < 12 && last.status !== 429; i++) last = await start();

    const body = z
      .object({ error: z.string(), error_description: z.string() })
      .parse(await last.json());

    expect(last.status).toBe(429);
    expect(body.error).toBe("rate_limited");
    expect(body.error_description).toContain("Retry-After");
    expect(Number(last.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});

describe("which key is this", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("an anonymous sandbox key says it belongs to no account", async () => {
    mockApi(() => json(500, {}));
    const client = await connect(await sandboxKey({}, "198.51.100.87"));

    const account = await client.callTool({
      name: "get_account",
      arguments: {},
    });

    expect(textOf(account.content)).toContain(
      "an anonymous sandbox key, not tied to any Modelfy account",
    );
  });

  it("an account's test key says it is that account's test key", async () => {
    mockApi(() =>
      json(200, {
        data: {
          userId: "user-1",
          kind: "TEST",
          name: "Store bot",
          budget: null,
        },
      }),
    );
    const client = await connect(`mfy_test_${"K".repeat(43)}`);

    const account = await client.callTool({
      name: "get_account",
      arguments: {},
    });

    expect(textOf(account.content)).toContain(
      "a test key of a Modelfy account",
    );
  });
});

describe("uploaded photos", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the summary names the ready upload ids and where they go", async () => {
    mockApi(() => json(500, {}));
    const client = await connect(await sandboxKey({}, "198.51.100.88"));
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
    await exports.default.fetch(
      new Request(slot?.put_url ?? "", {
        method: "PUT",
        body: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      }),
    );

    const state = await client.callTool({
      name: "get_uploaded_photos",
      arguments: { session_id: created.session_id },
    });
    // The sentence the model reads, not the JSON for code
    const sentence = Text.parse(state.content)[0]?.text ?? "";

    expect(sentence).toContain(slot?.upload_id ?? "missing");
    expect(sentence).toContain("plan_photos as upload_ids");
  });
});
