import {
  authorizationErrorRedirect,
  type AuthRequest,
} from "@cloudflare/workers-oauth-provider";
import { z } from "zod";
import { ApiFailure, ModelfyApi } from "../api/client";
import type { AppEnv } from "../env";
import type { GrantProps } from "./props";

const AUTH_REQUEST_TTL_SECONDS = 600;
const MAX_CLIENT_NAME = 60;
const DEFAULT_CLIENT_NAME = "An AI assistant";

const StoredAuthRequestSchema = z.object({
  request: z.object({
    responseType: z.string(),
    clientId: z.string(),
    redirectUri: z.string(),
    scope: z.array(z.string()),
    state: z.string(),
    codeChallenge: z.string().optional(),
    codeChallengeMethod: z.string().optional(),
    resource: z.string().optional(),
    issuer: z.string().optional(),
  }),
  clientName: z.string(),
});
type StoredAuthRequest = z.infer<typeof StoredAuthRequestSchema>;

const RedeemedSchema = z.object({ userId: z.string(), token: z.string() });

function authRequestKey(state: string): string {
  return `auth-request:${state}`;
}

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function page(status: number, title: string, body: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;background:#000;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0"><main style="max-width:28rem;padding:2rem;text-align:center"><h1 style="font-weight:500">${title}</h1><p style="color:#a1a1a1">${body}</p></main></body></html>`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

async function readAuthRequest(
  env: AppEnv,
  state: string,
): Promise<StoredAuthRequest | null> {
  const stored = await env.OAUTH_KV.get(authRequestKey(state), "json");
  const parsed = StoredAuthRequestSchema.safeParse(stored);
  return parsed.success ? parsed.data : null;
}

function toAuthRequest(stored: StoredAuthRequest["request"]): AuthRequest {
  return {
    responseType: stored.responseType,
    clientId: stored.clientId,
    redirectUri: stored.redirectUri,
    scope: stored.scope,
    state: stored.state,
    ...(stored.codeChallenge !== undefined
      ? { codeChallenge: stored.codeChallenge }
      : {}),
    ...(stored.codeChallengeMethod !== undefined
      ? { codeChallengeMethod: stored.codeChallengeMethod }
      : {}),
    ...(stored.resource !== undefined ? { resource: stored.resource } : {}),
    ...(stored.issuer !== undefined ? { issuer: stored.issuer } : {}),
  };
}

/**
 * GET /authorize: the request is validated by the provider, kept under a
 * fresh `state`, and the person is sent to the Modelfy web to sign in and
 * consent (design §4.2 steps 2–3).
 */
export async function authorize(
  request: Request,
  env: AppEnv,
): Promise<Response> {
  let authRequest: AuthRequest;
  try {
    authRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  } catch {
    return page(
      400,
      "This sign-in link is not valid",
      "Start again from your assistant.",
    );
  }
  const client = await env.OAUTH_PROVIDER.lookupClient(authRequest.clientId);
  const clientName = (client?.clientName?.trim() || DEFAULT_CLIENT_NAME).slice(
    0,
    MAX_CLIENT_NAME,
  );
  const state = randomState();
  const stored: StoredAuthRequest = { request: authRequest, clientName };
  await env.OAUTH_KV.put(authRequestKey(state), JSON.stringify(stored), {
    expirationTtl: AUTH_REQUEST_TTL_SECONDS,
  });
  const consent = new URL("/connect", env.WEB_URL);
  consent.searchParams.set("state", state);
  consent.searchParams.set("client_id", authRequest.clientId);
  consent.searchParams.set("client_name", clientName);
  return Response.redirect(consent.toString(), 302);
}

/**
 * GET /callback?state&code (or &error=access_denied): the web's answer. The
 * code is exchanged with the API for the user's token, which becomes the
 * grant's props; the client gets its authorization code.
 */
export async function callback(
  request: Request,
  env: AppEnv,
): Promise<Response> {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const stored = await readAuthRequest(env, state);
  if (stored === null) {
    return page(
      400,
      "This sign-in has expired",
      "Start again from your assistant.",
    );
  }
  // One use only, whatever happens next
  await env.OAUTH_KV.delete(authRequestKey(state));
  const authRequest = toAuthRequest(stored.request);

  if (url.searchParams.get("error") === "access_denied") {
    return Response.redirect(
      authorizationErrorRedirect(authRequest, "access_denied"),
      302,
    );
  }

  const code = url.searchParams.get("code") ?? "";
  let redeemed: z.infer<typeof RedeemedSchema>;
  try {
    redeemed = await new ModelfyApi(env, null).post(
      "/v2/connections/codes/redeem",
      { code, state },
      RedeemedSchema,
    );
  } catch (error) {
    if (error instanceof ApiFailure) {
      return page(
        400,
        "Modelfy could not finish the sign-in",
        "Start again from your assistant.",
      );
    }
    throw error;
  }

  const props: GrantProps = {
    kind: "oauth",
    userId: redeemed.userId,
    apiToken: redeemed.token,
    tokenId: null,
    sandboxId: null,
    budget: null,
  };
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: authRequest,
    userId: redeemed.userId,
    metadata: { clientName: stored.clientName },
    scope: authRequest.scope,
    props,
  });
  return Response.redirect(redirectTo, 302);
}

/**
 * GET /authorize/request?state: the pending request as the server knows it,
 * so the consent page shows the registered client and where it sends the
 * person back, never a name taken from the link.
 */
export async function pendingRequest(
  request: Request,
  env: AppEnv,
): Promise<Response> {
  const state = new URL(request.url).searchParams.get("state") ?? "";
  const stored = await readAuthRequest(env, state);
  const headers = new Headers({
    "Access-Control-Allow-Origin": new URL(env.WEB_URL).origin,
    Vary: "Origin",
  });
  if (stored === null) {
    return Response.json({ error: "NOT_FOUND" }, { status: 404, headers });
  }
  return Response.json(
    {
      clientName: stored.clientName,
      clientId: stored.request.clientId,
      redirectHost: new URL(stored.request.redirectUri).host,
    },
    { headers },
  );
}
