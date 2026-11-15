import { McpServer } from "@modelcontextprotocol/server";
import { instructionsFor } from "./instructions";
import type { Session } from "./session";
import { registerAccountTools } from "./tools/account";

export const SERVER_VERSION = "0.1.0";

export function buildServer(session: Session): McpServer {
  const server = new McpServer(
    { name: "modelfy", title: "Modelfy", version: SERVER_VERSION },
    { instructions: instructionsFor(session.props.kind) },
  );
  registerAccountTools(server, session);
  return server;
}
