import type { CallToolResult } from "@modelcontextprotocol/server";
import type { GrantProps } from "../auth/props";
import type { PhotoBackend } from "../backend/types";
import type { AppEnv } from "../env";
import { errorResult, toAgentError } from "./errors";

/** One authenticated MCP request: who it is, its backend, and how to end it. */
export interface Session {
  props: GrantProps;
  env: AppEnv;
  /** Who owns quotes and budgets: sha256 of the Modelfy token, or the sandbox id */
  owner: string;
  backend: PhotoBackend;
  /** Ends an OAuth connection whose Modelfy token stopped working. */
  revoke(): Promise<void>;
}

/** A successful tool result: one sentence for the model, the data for code. */
export function respond(
  summary: string,
  data: Record<string, unknown>,
): CallToolResult {
  return {
    content: [
      { type: "text", text: summary },
      { type: "text", text: JSON.stringify(data) },
    ],
    structuredContent: data,
  };
}

/** Runs a tool body; any failure becomes an agent error result. */
export async function guarded(
  session: Session,
  body: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  try {
    return await body();
  } catch (error) {
    const agentError = toAgentError(error);
    if (agentError.code === "CONNECTION_REVOKED") await session.revoke();
    return errorResult(agentError, session.env.PUBLIC_URL);
  }
}
