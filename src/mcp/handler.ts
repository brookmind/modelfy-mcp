import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { parseProps } from "../auth/props";
import { sha256Hex } from "../crypto";
import { backendFor } from "../backend";
import type { AppEnv } from "../env";
import { buildServer } from "./server";
import type { Session } from "./session";

const GrantAuth = z.object({ userId: z.string(), clientId: z.string() });

/** Ends the OAuth grants of this user and client, so the client signs in again. */
async function revokeConnection(env: AppEnv, auth: unknown): Promise<void> {
  const parsed = GrantAuth.safeParse(auth);
  if (!parsed.success) return;
  const { userId, clientId } = parsed.data;
  const grants = await env.OAUTH_PROVIDER.listUserGrants(userId);
  for (const grant of grants.items) {
    if (grant.clientId === clientId) {
      await env.OAUTH_PROVIDER.revokeGrant(grant.id, userId);
    }
  }
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
    const auth: unknown = Reflect.get(ctx, "auth");
    const owner =
      props.sandboxId ?? `token:${await sha256Hex(props.apiToken ?? "")}`;
    const session: Session = {
      props,
      env,
      owner,
      backend: backendFor(props, env),
      revoke: () => revokeConnection(env, auth),
    };
    const handler = createMcpHandler(() => buildServer(session), {
      route: "/mcp",
    });
    return handler(request, env, ctx);
  },
};
