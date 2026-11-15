import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  bareLayerAllowed,
  sandboxKeysPerHour,
} from "../../src/auth/sandbox-keys";
import { call, connect, json, mockApi } from "../helpers/worker";

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

  it("an API outage while checking a key is 503, not a crash", async () => {
    mockApi(() => json(503, { error: "UNAVAILABLE" }));

    const response = await mcp(`mfy_live_${"Q".repeat(43)}`);

    expect(response.status).toBe(503);
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

  it("device code is limited to 10 per hour per address", async () => {
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
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const response = await call("/device/code", {
        method: "POST",
        headers: { "CF-Connecting-IP": "198.51.100.200" },
      });
      statuses.push(response.status);
    }

    expect(statuses.slice(0, 10).every((status) => status === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it("the key answer is never cached", async () => {
    mockApi(() =>
      json(200, {
        data: { status: "approved", apiKey: LIVE, kind: "LIVE", budget: null },
      }),
    );

    const token = await call("/device/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "device_code=dev-1",
    });
    const sandbox = await call("/sandbox/keys", {
      method: "POST",
      headers: { "CF-Connecting-IP": "198.51.100.201" },
    });

    expect(token.headers.get("Cache-Control")).toBe("no-store");
    expect(sandbox.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("sandbox key options", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function create(body: unknown, ip: string): Promise<Response> {
    return call("/sandbox/keys", {
      method: "POST",
      headers: { "CF-Connecting-IP": ip, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function account(key: string): Promise<unknown> {
    const client = await connect(key);
    return (await client.callTool({ name: "get_account", arguments: {} }))
      .structuredContent;
  }

  it("a key created with no body is a plain anonymous sandbox key", async () => {
    mockApi(() => json(500, {}));
    const created = SandboxKey.parse(
      await (await sandboxKey("203.0.113.20")).json(),
    );

    expect(await account(created.api_key)).toMatchObject({
      keyKind: "anonymous",
      sandbox: true,
      budget: null,
    });
  });

  it("person and bot keys are created and accepted on /mcp", async () => {
    mockApi(() => json(500, {}));
    for (const actsAs of ["person", "bot"]) {
      const response = await create({ acts_as: actsAs }, "203.0.113.21");
      const created = SandboxKey.parse(await response.json());

      expect(response.status).toBe(200);
      expect((await mcp(created.api_key)).status).not.toBe(401);
    }
  });

  it("an unknown acts_as is 400 and names the allowed values", async () => {
    const response = await create({ acts_as: "robot" }, "203.0.113.22");
    const body = z
      .object({ error: z.string(), error_description: z.string() })
      .parse(await response.json());

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_request");
    expect(body.error_description).toContain("person");
    expect(body.error_description).toContain("bot");
  });

  it("agent_layer bare is accepted where the Worker allows it", async () => {
    const response = await create({ agent_layer: "bare" }, "203.0.113.23");

    expect(response.status).toBe(200);
  });

  it("bare is allowed only when ALLOW_BARE_AGENT_LAYER is true", () => {
    expect(bareLayerAllowed("true")).toBe(true);
    expect(bareLayerAllowed(undefined)).toBe(false);
    expect(bareLayerAllowed("false")).toBe(false);
  });

  it("the keys per hour come from SANDBOX_KEYS_PER_HOUR, 5 by default", () => {
    expect(sandboxKeysPerHour("200")).toBe(200);
    expect(sandboxKeysPerHour(undefined)).toBe(5);
    expect(sandboxKeysPerHour("not a number")).toBe(5);
  });
});
