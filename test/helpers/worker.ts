import { exports } from "cloudflare:workers";
import { vi } from "vitest";

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
): ApiCall[] {
  const calls: ApiCall[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== "https://api.test") {
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
