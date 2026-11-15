import { exports } from "cloudflare:workers";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { vi } from "vitest";
import { z } from "zod";

export const ORIGIN = "https://mcp.test";

/** Calls the Worker under test (same isolate: fetch mocks apply to it). */
export function call(path: string, init?: RequestInit): Promise<Response> {
  return exports.default.fetch(new Request(`${ORIGIN}${path}`, init));
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export interface ApiCall {
  method: string;
  path: string;
  authorization: string | null;
  secret: string | null;
  body: unknown;
}

/**
 * Answers requests to the Modelfy API (`https://api.test`) with `handle`
 * and records them; any other outbound request fails the test.
 */
export function mockApi(
  handle: (call: ApiCall) => Response | Promise<Response>,
  other?: (request: Request) => Response | Promise<Response>,
): ApiCall[] {
  const calls: ApiCall[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== "https://api.test") {
      if (other !== undefined) return other(request);
      throw new Error(`Unexpected request: ${request.method} ${request.url}`);
    }
    const text = await request.text();
    const recorded: ApiCall = {
      method: request.method,
      path: `${url.pathname}${url.search}`,
      authorization: request.headers.get("Authorization"),
      secret: request.headers.get("X-Mcp-Secret"),
      body: text === "" ? null : JSON.parse(text),
    };
    calls.push(recorded);
    return handle(recorded);
  });
  return calls;
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  let binary = "";
  for (const byte of new Uint8Array(digest))
    binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export interface RegisteredClient {
  clientId: string;
  redirectUri: string;
}

export async function registerClient(
  name = "Claude",
  redirectUri = "https://client.test/callback",
): Promise<RegisteredClient> {
  const response = await call("/oauth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: name,
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
    }),
  });
  const body: unknown = await response.json();
  if (
    typeof body !== "object" ||
    body === null ||
    !("client_id" in body) ||
    typeof body.client_id !== "string"
  ) {
    throw new Error(`Registration failed: ${JSON.stringify(body)}`);
  }
  return { clientId: body.client_id, redirectUri };
}

export interface StartedAuthorization {
  verifier: string;
  location: URL;
}

/** GET /authorize with PKCE; returns where the Worker redirected. */
export async function startAuthorization(
  client: RegisteredClient,
  clientState = "client-state-1",
): Promise<StartedAuthorization> {
  const verifier = "v".repeat(64);
  const query = new URLSearchParams({
    response_type: "code",
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    state: clientState,
    code_challenge: await sha256Base64Url(verifier),
    code_challenge_method: "S256",
    resource: `${ORIGIN}/mcp`,
  });
  const response = await call(`/authorize?${query.toString()}`, {
    redirect: "manual",
  });
  const location = response.headers.get("Location");
  if (location === null) {
    throw new Error(`No redirect from /authorize: ${response.status}`);
  }
  return { verifier, location: new URL(location) };
}

const AccessToken = z.object({ access_token: z.string() });

/**
 * Runs the whole OAuth flow for a client (the API redeem must be answered by
 * the active `mockApi` handler) and returns an access token for /mcp.
 */
export async function oauthAccessToken(): Promise<string> {
  const client = await registerClient();
  const { verifier, location } = await startAuthorization(client);
  const state = location.searchParams.get("state") ?? "";
  const back = await call(`/callback?state=${state}&code=code-1`, {
    redirect: "manual",
  });
  const code =
    new URL(back.headers.get("Location") ?? "").searchParams.get("code") ?? "";
  const response = await call("/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: client.redirectUri,
      client_id: client.clientId,
      code_verifier: verifier,
      resource: `${ORIGIN}/mcp`,
    }).toString(),
  });
  return AccessToken.parse(await response.json()).access_token;
}

/** An MCP client connected to the Worker's /mcp with a bearer token. */
export async function connect(token: string): Promise<Client> {
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(
    new URL(`${ORIGIN}/mcp`),
    {
      fetch: (input, init) => exports.default.fetch(new Request(input, init)),
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    },
  );
  await client.connect(transport);
  return client;
}
