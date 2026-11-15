import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { oauthOptions } from "../../src/auth/oauth-options";
import {
  call,
  callback,
  json,
  mockApi,
  ORIGIN,
  registerClient,
  startAuthorization,
} from "../helpers/worker";

const OAUTH_TOKEN = `mfy_oauth_${"A".repeat(43)}`;

function redeemOk(): ReturnType<typeof mockApi> {
  return mockApi((request) =>
    request.path === "/v2/connections/codes/redeem"
      ? json(200, { data: { userId: "user-1", token: OAUTH_TOKEN } })
      : json(404, { error: "NOT_FOUND" }),
  );
}

describe("OAuth sign-in through the Modelfy web", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the consent link carries state, client_id and client_name (60 chars max)", async () => {
    const client = await registerClient("C".repeat(80));

    const { location } = await startAuthorization(client);

    expect(`${location.origin}${location.pathname}`).toBe(
      "https://web.test/connect",
    );
    expect(location.searchParams.get("state")).toMatch(/^[\w-]{43}$/);
    expect(location.searchParams.get("client_id")).toBe(client.clientId);
    expect(location.searchParams.get("client_name")).toBe("C".repeat(60));
  });

  it("authorize, consent, callback and token exchange give an access and a refresh token", async () => {
    const calls = redeemOk();
    const client = await registerClient();
    const started = await startAuthorization(client);
    const { verifier, location } = started;
    const state = location.searchParams.get("state") ?? "";

    const back = await callback(started, "code=code-1");
    const toClient = new URL(back.headers.get("Location") ?? "");
    const token = await call("/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: toClient.searchParams.get("code") ?? "",
        redirect_uri: client.redirectUri,
        client_id: client.clientId,
        code_verifier: verifier,
        resource: `${ORIGIN}/mcp`,
      }).toString(),
    });
    const tokens = z
      .object({ access_token: z.string(), refresh_token: z.string() })
      .safeParse(await token.json());

    expect(calls).toEqual([
      {
        method: "POST",
        path: "/v2/connections/codes/redeem",
        authorization: null,
        secret: "test-secret",
        body: { code: "code-1", state },
      },
    ]);
    expect(`${toClient.origin}${toClient.pathname}`).toBe(client.redirectUri);
    expect(toClient.searchParams.get("state")).toBe("client-state-1");
    expect(token.status).toBe(200);
    expect(tokens.success).toBe(true);
  });

  it("a used or unknown state is refused", async () => {
    redeemOk();
    const client = await registerClient();
    const started = await startAuthorization(client);

    await callback(started, "code=code-1");
    const again = await callback(started, "code=code-1");
    const unknown = await call("/callback?state=nope&code=code-1", {
      redirect: "manual",
    });

    expect(again.status).toBe(400);
    expect(unknown.status).toBe(400);
  });

  it("access_denied returns to the client with the error", async () => {
    const calls = redeemOk();
    const client = await registerClient();
    const started = await startAuthorization(client);

    const back = await callback(started, "error=access_denied");
    const toClient = new URL(back.headers.get("Location") ?? "");

    expect(toClient.searchParams.get("error")).toBe("access_denied");
    expect(toClient.searchParams.get("state")).toBe("client-state-1");
    expect(calls).toEqual([]);
  });

  it("a code the API refuses ends on an error page, not the client", async () => {
    mockApi(() => json(400, { error: "CODE_INVALID" }));
    const client = await registerClient();
    const started = await startAuthorization(client);

    const back = await callback(started, "code=bad");

    expect(back.status).toBe(400);
  });

  it("/authorize/request returns the registered name and redirect host, not the link's", async () => {
    const client = await registerClient("Claude");
    const { location } = await startAuthorization(client);
    const state = location.searchParams.get("state") ?? "";

    const response = await call(`/authorize/request?state=${state}`, {
      headers: { Origin: "https://web.test" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://web.test",
    );
    expect(await response.json()).toEqual({
      clientName: "Claude",
      clientId: client.clientId,
      redirectHost: "client.test",
    });
    expect((await call("/authorize/request?state=nope")).status).toBe(404);
  });

  it("keeps people signed in: no fixed refresh end, 90 idle days, clients never expire", () => {
    expect(oauthOptions.accessTokenTTL).toBe(3600);
    expect(oauthOptions.refreshTokenTTL).toBeUndefined();
    expect(oauthOptions.refreshTokenIdleTTL).toBe(90 * 24 * 3600);
    expect(oauthOptions.clientRegistrationTTL).toBeUndefined();
  });

  it("sets an HttpOnly, SameSite=Lax sign-in cookie at /authorize", async () => {
    const client = await registerClient();
    const verifier = await startAuthorization(client);

    expect(verifier.cookie).toMatch(/^__Host-mcp-signin-[\w-]+=1$/);
  });

  it("a callback from a browser that did not start the sign-in is refused (no code reaches the client)", async () => {
    const calls = redeemOk();
    const client = await registerClient();
    const started = await startAuthorization(client);

    const back = await callback(started, "code=code-1", false);

    expect(back.status).toBe(400);
    expect(back.headers.get("Location")).toBeNull();
    expect(calls).toEqual([]);
  });
});
