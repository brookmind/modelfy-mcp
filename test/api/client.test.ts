import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiFailure, ModelfyApi } from "../../src/api/client";
import { runToolCall } from "../../src/mcp/tool-call";

const Thing = z.object({ id: z.string(), credits: z.number() });

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("ModelfyApi", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("adds the bearer token and the secret", async () => {
    const seen: Request[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      seen.push(new Request(input, init));
      return Promise.resolve(json(200, { data: { id: "t1", credits: 5 } }));
    });

    await new ModelfyApi(env, "mfy_live_x").get("/v2/thing", Thing);

    expect(seen[0]?.url).toBe("https://api.test/v2/thing");
    expect(seen[0]?.headers.get("Authorization")).toBe("Bearer mfy_live_x");
    expect(seen[0]?.headers.get("X-Mcp-Secret")).toBe("test-secret");
  });

  it("names the tool call on every request made inside it", async () => {
    const seen: Request[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      seen.push(new Request(input, init));
      return Promise.resolve(json(200, { data: { id: "t1", credits: 5 } }));
    });
    const api = new ModelfyApi(env, "mfy_live_x");

    await runToolCall("plan_photos", async () => {
      await Promise.all([
        api.get("/v2/a", Thing),
        api.post("/v2/b", { x: 1 }, Thing),
      ]);
    });
    await runToolCall("get_account", () => api.get("/v2/c", Thing));
    await api.get("/v2/d", Thing);

    const [a, b, c, d] = seen;
    expect(a?.headers.get("X-Mcp-Tool")).toBe("plan_photos");
    expect(b?.headers.get("X-Mcp-Tool")).toBe("plan_photos");
    expect(a?.headers.get("X-Mcp-Call")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(b?.headers.get("X-Mcp-Call")).toBe(a?.headers.get("X-Mcp-Call"));
    expect(c?.headers.get("X-Mcp-Tool")).toBe("get_account");
    expect(c?.headers.get("X-Mcp-Call")).not.toBe(a?.headers.get("X-Mcp-Call"));
    expect(d?.headers.get("X-Mcp-Tool")).toBeNull();
    expect(d?.headers.get("X-Mcp-Call")).toBeNull();
  });

  it("sends no Authorization header without a token", async () => {
    const seen: Request[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      seen.push(new Request(input, init));
      return Promise.resolve(json(200, { data: { id: "t1", credits: 5 } }));
    });

    await new ModelfyApi(env, null).post("/v2/thing", { a: 1 }, Thing);

    expect(seen[0]?.headers.get("Authorization")).toBeNull();
    expect(await seen[0]?.json()).toEqual({ a: 1 });
  });

  it("unwraps data and parses it", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json(200, { data: { id: "t1", credits: 5, extra: true } }),
    );

    const thing = await new ModelfyApi(env, "k").get("/v2/thing", Thing);

    expect(thing).toEqual({ id: "t1", credits: 5 });
  });

  it("a non-2xx answer becomes ApiFailure with the API code", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json(402, { error: "INSUFFICIENT_CREDITS", message: "Not enough" }),
    );

    const failure = await new ModelfyApi(env, "k")
      .get("/v2/thing", Thing)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiFailure);
    expect(failure).toMatchObject({
      status: 402,
      code: "INSUFFICIENT_CREDITS",
      message: "Not enough",
    });
  });

  it("an unexpected shape becomes ApiFailure BAD_RESPONSE", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json(200, { data: { id: 3 } }),
    );

    await expect(
      new ModelfyApi(env, "k").get("/v2/thing", Thing),
    ).rejects.toMatchObject({ status: 502, code: "BAD_RESPONSE" });
  });

  it("a network failure becomes ApiFailure UNAVAILABLE", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("down"));

    await expect(
      new ModelfyApi(env, "k").get("/v2/thing", Thing),
    ).rejects.toMatchObject({ status: 503, code: "UNAVAILABLE" });
  });
});
