import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { call, json, mockApi } from "../helpers/worker";

const LIVE = `mfy_live_${"L".repeat(43)}`;
const OAUTH = `mfy_oauth_${"O".repeat(43)}`;

const SandboxKey = z.object({ api_key: z.string(), expires_at: z.string() });

function me(kind: "LIVE" | "TEST" | "OAUTH"): Response {
  return json(200, {
    data: {
      userId: "user-1",
      kind,
      name: "Store bot",
      budget:
        kind === "LIVE"
          ? {
              maxCreditsPerSession: 100,
              maxCreditsPerDay: 500,
              spentToday: 0,
              resetsAt: "2026-11-16T00:00:00.000Z",
            }
          : null,
    },
  });
}

function mcp(token: string, ip = "198.51.100.1"): Promise<Response> {
  return call("/mcp", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "CF-Connecting-IP": ip,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
  });
}

async function sandboxKey(ip: string): Promise<Response> {
  return call("/sandbox/keys", {
    method: "POST",
    headers: { "CF-Connecting-IP": ip },
  });
}

describe("API keys", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a live key is accepted on /mcp after /v2/connections/me", async () => {
    const calls = mockApi(() => me("LIVE"));

    const response = await mcp(LIVE);

    expect(response.status).not.toBe(401);
    expect(calls[0]).toMatchObject({
      method: "GET",
      path: "/v2/connections/me",
      authorization: `Bearer ${LIVE}`,
      secret: "test-secret",
    });
  });

  it("the key is checked once a minute, not on every request", async () => {
    const calls = mockApi(() => me("TEST"));
    const key = `mfy_test_${"T".repeat(43)}`;

    await mcp(key);
    await mcp(key);

    expect(calls.filter((c) => c.path === "/v2/connections/me")).toHaveLength(
      1,
    );
  });

  it("an unknown mfy_ key is 401", async () => {
    mockApi(() => json(401, { error: "UNAUTHORIZED" }));

    expect((await mcp(`mfy_live_${"X".repeat(43)}`)).status).toBe(401);
  });

  it("an OAuth connection token sent as an API key is 401", async () => {
    mockApi(() => me("OAUTH"));

    expect((await mcp(OAUTH)).status).toBe(401);
  });
});

describe("anonymous sandbox keys", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("an anonymous key works on /mcp without any API call", async () => {
    const calls = mockApi(() => json(500, {}));
    const created = SandboxKey.parse(
      await (await sandboxKey("203.0.113.5")).json(),
    );

    const response = await mcp(created.api_key);

    expect(created.api_key).toMatch(/^mfy_test_[0-9A-Za-z]{43}$/);
    expect(response.status).not.toBe(401);
    expect(calls).toEqual([]);
  });

  it("the sixth sandbox key from one IP in an hour is 429", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await sandboxKey("203.0.113.9")).status);
    }

    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    expect((await sandboxKey("203.0.113.10")).status).toBe(200);
  });
});

describe("device login (RFC 8628)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("device code answers with RFC 8628 names and the web approval page", async () => {
    const calls = mockApi(() =>
      json(200, {
        data: {
          deviceCode: "dev-1",
          userCode: "WDJB-MJHT",
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
          interval: 5,
        },
      }),
    );

    const response = await call("/device/code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_name: "Claude Code" }),
    });
    const body: unknown = await response.json();

    expect(calls[0]).toMatchObject({
      path: "/v2/connections/device",
      secret: "test-secret",
      body: { clientName: "Claude Code" },
    });
    expect(body).toMatchObject({
      device_code: "dev-1",
      user_code: "WDJB-MJHT",
      verification_uri: "https://web.test/activate",
      verification_uri_complete: "https://web.test/activate?code=WDJB-MJHT",
      interval: 5,
    });
    expect(
      z.object({ expires_in: z.number().int().min(590) }).safeParse(body)
        .success,
    ).toBe(true);
  });

  it("device token: pending and slow_down are 400 with the RFC error, approved is 200 with the key", async () => {
    const answers = [
      { status: "authorization_pending" },
      { status: "slow_down" },
      {
        status: "approved",
        apiKey: LIVE,
        kind: "LIVE",
        budget: { maxCreditsPerSession: 100, maxCreditsPerDay: 500 },
      },
    ];
    mockApi(() => json(200, { data: answers.shift() }));
    const poll = (): Promise<Response> =>
      call("/device/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "device_code=dev-1",
      });

    const pending = await poll();
    const slow = await poll();
    const approved = await poll();

    expect(pending.status).toBe(400);
    expect(await pending.json()).toEqual({ error: "authorization_pending" });
    expect(slow.status).toBe(400);
    expect(await slow.json()).toEqual({ error: "slow_down" });
    expect(approved.status).toBe(200);
    expect(await approved.json()).toEqual({
      api_key: LIVE,
      kind: "live",
      budget: { maxCreditsPerSession: 100, maxCreditsPerDay: 500 },
    });
  });

  it("device token without a device_code is 400 invalid_request", async () => {
    mockApi(() => json(500, {}));

    const response = await call("/device/token", { method: "POST" });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
  });
});
