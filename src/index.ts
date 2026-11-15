import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { env } from "cloudflare:workers";
import { oauthOptions } from "./auth/oauth-options";
import { authorize, callback, pendingRequest } from "./auth/routes";
import type { AppEnv } from "./env";

/** Every path that is not the MCP endpoint itself. */
const defaultHandler = {
  async fetch(request: Request, appEnv: AppEnv): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (request.method === "GET" && pathname === "/authorize") {
      return authorize(request, appEnv);
    }
    if (request.method === "GET" && pathname === "/callback") {
      return callback(request, appEnv);
    }
    if (request.method === "GET" && pathname === "/authorize/request") {
      return pendingRequest(request, appEnv);
    }
    return new Response("Not found", { status: 404 });
  },
};

/** The MCP endpoint; reached only with a valid token (Task 4 serves it). */
const mcpHandler = {
  fetch(): Response {
    return new Response("Not implemented", { status: 501 });
  },
};

export default new OAuthProvider<AppEnv>({
  ...oauthOptions,
  apiRoute: "/mcp",
  apiHandler: mcpHandler,
  defaultHandler,
  resourceMetadata: {
    resource: `${env.PUBLIC_URL}/mcp`,
    resource_name: "Modelfy",
  },
});
