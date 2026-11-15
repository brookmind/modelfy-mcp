import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { env } from "cloudflare:workers";
import { pollDevice, startDevice } from "./auth/device";
import { resolveApiKey } from "./auth/external-token";
import { oauthOptions } from "./auth/oauth-options";
import { authorize, callback, pendingRequest } from "./auth/routes";
import { createSandboxKey } from "./auth/sandbox-keys";
import type { AppEnv } from "./env";
import { mcpApiHandler } from "./mcp/handler";

const MCP_RESOURCE = `${env.PUBLIC_URL}/mcp`;

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
    if (request.method === "POST" && pathname === "/device/code") {
      return startDevice(request, appEnv);
    }
    if (request.method === "POST" && pathname === "/device/token") {
      return pollDevice(request, appEnv);
    }
    if (request.method === "POST" && pathname === "/sandbox/keys") {
      return createSandboxKey(request, appEnv);
    }
    return new Response("Not found", { status: 404 });
  },
};

export default new OAuthProvider<AppEnv>({
  ...oauthOptions,
  apiRoute: "/mcp",
  apiHandler: mcpApiHandler,
  defaultHandler,
  resourceMetadata: { resource: MCP_RESOURCE, resource_name: "Modelfy" },
  resolveExternalToken: (input) => resolveApiKey(input, MCP_RESOURCE),
});
