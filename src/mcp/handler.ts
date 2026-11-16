import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { parseProps } from "../auth/props";
import { sha256Hex } from "../crypto";
import { backendFor } from "../backend";
import type { AppEnv } from "../env";
import { layerText } from "./layer";
import { buildServer } from "./server";
import type { Session } from "./session";

const GrantAuth = z.object({ token: z.string() });

/**
 * Ends the grant of this request only, so the client signs in again. Other
 * grants of the same user and client (another device) are left alone. An API
 * key has no grant: the provider knows no such token and nothing is revoked.
 */
async function revokeConnection(env: AppEnv, auth: unknown): Promise<void> {
  const parsed = GrantAuth.safeParse(auth);
  if (!parsed.success) return;
  const token = await env.OAUTH_PROVIDER.unwrapToken<unknown>(
    parsed.data.token,
  );
  if (token === null) return;
  await env.OAUTH_PROVIDER.revokeGrant(token.grantId, token.userId);
}

/** POST /mcp, after the provider has checked the token and set ctx.props. */
export const mcpApiHandler = {
  async fetch(
    request: Request,
    env: AppEnv,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const props = parseProps(ctx.props);
    if (props === null) {
      return Response.json({ error: "invalid_token" }, { status: 401 });
    }
    const owner =
      props.sandboxId ?? `token:${await sha256Hex(props.apiToken ?? "")}`;
    if (
      props.kind === "anonymous" &&
      !(await env.ANON_CALLS.limit({ key: owner })).success
    ) {
      return Response.json(
        {
          error: "rate_limited",
          error_description:
            "This anonymous sandbox key made more than 60 calls in a minute. Wait a minute, or use device login for your own key.",
        },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    }
    const auth: unknown = Reflect.get(ctx, "auth");
    const session: Session = {
      props,
      env,
      owner,
      backend: backendFor(props, env, owner),
      layer: layerText(props.agentLayer),
      revoke: () => revokeConnection(env, auth),
    };
    const handler = createMcpHandler(() => buildServer(session), {
      route: "/mcp",
    });
    return handler(request, env, ctx);
  },
};
