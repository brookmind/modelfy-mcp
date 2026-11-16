import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import { ApiFailure } from "../api/client";

/** Every code a tool can return; docs/errors.md has a section for each. */
export const AgentErrorCodeSchema = z.enum([
  "INSUFFICIENT_CREDITS",
  "BUDGET_EXCEEDED",
  "QUOTE_EXPIRED",
  "QUOTE_NOT_YOURS",
  "CONFIRMATION_REQUIRED",
  "CONNECTION_REVOKED",
  "MISSING_CHOICE",
  "INVALID_INPUT",
  "NOT_FOUND",
  "PHOTO_REJECTED",
  "RATE_LIMITED",
  "MODELFY_ERROR",
]);

export type AgentErrorCode = z.infer<typeof AgentErrorCodeSchema>;

/** An error the agent can act on: a stable code, a plain message, the next step. */
export class AgentError extends Error {
  readonly code: AgentErrorCode;
  readonly nextStep: string;
  readonly details: Record<string, unknown> | null;

  constructor(
    code: AgentErrorCode,
    message: string,
    nextStep: string,
    details: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = "AgentError";
    this.code = code;
    this.nextStep = nextStep;
    this.details = details;
  }
}

export const BUDGET_NEXT_STEP =
  "Make fewer photos, wait until the daily budget resets, or ask the key's owner to raise its budget.";

function budgetDetails(body: unknown): Record<string, unknown> | null {
  if (typeof body !== "object" || body === null || !("budget" in body)) {
    return null;
  }
  const budget = body.budget;
  return typeof budget === "object" && budget !== null ? { budget } : null;
}

function modelfyError(): AgentError {
  return new AgentError(
    "MODELFY_ERROR",
    "Modelfy could not complete this right now.",
    "Try again in a moment; if it keeps failing, tell the person.",
  );
}

/** Maps a Modelfy API failure to what the agent should do next. */
function fromApiFailure(failure: ApiFailure): AgentError {
  switch (true) {
    case failure.status === 401 && failure.code === "MCP_SECRET_INVALID":
      // This server is misconfigured; the person's connection is fine
      return modelfyError();
    case failure.status === 401:
      return new AgentError(
        "CONNECTION_REVOKED",
        "This Modelfy connection is no longer valid (it was revoked or expired).",
        "Ask the person to connect Modelfy again (or create a new API key).",
      );
    case failure.status === 402:
      return new AgentError(
        "INSUFFICIENT_CREDITS",
        "The account does not have enough credits for this.",
        "Tell the person; they can buy credits or change plan at the Modelfy web (/plans).",
      );
    case failure.code === "BUDGET_EXCEEDED":
      return new AgentError(
        "BUDGET_EXCEEDED",
        failure.message,
        BUDGET_NEXT_STEP,
        budgetDetails(failure.body),
      );
    case failure.status === 404:
      return new AgentError(
        "NOT_FOUND",
        "Modelfy could not find that item.",
        "Check the id; list the items again to get a valid one.",
      );
    case failure.status === 429:
      return new AgentError(
        "RATE_LIMITED",
        "Too many requests right now.",
        "Wait a minute and try again.",
      );
    case failure.status === 400 || failure.status === 422:
      return new AgentError(
        "INVALID_INPUT",
        failure.message,
        "Fix the input as the message says and call the tool again.",
      );
    default:
      return modelfyError();
  }
}

export function toAgentError(error: unknown): AgentError {
  if (error instanceof AgentError) return error;
  if (error instanceof ApiFailure) return fromApiFailure(error);
  return new AgentError(
    "MODELFY_ERROR",
    "Something went wrong on the Modelfy MCP server.",
    "Try again in a moment; if it keeps failing, tell the person.",
  );
}

/**
 * The tool result of an error: the sentence for the model and the JSON for
 * code. Without guidance (the bare agent layer) only the code and message.
 */
export function errorResult(
  error: AgentError,
  publicUrl: string,
  withGuidance = true,
): CallToolResult {
  const guidance = withGuidance
    ? {
        next_step: error.nextStep,
        docs_url: `${publicUrl}/docs/errors#${error.code}`,
      }
    : {};
  const payload = {
    error: {
      code: error.code,
      message: error.message,
      ...guidance,
      ...(error.details ?? {}),
    },
  };
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: withGuidance
          ? `${error.code}: ${error.message} Next step: ${error.nextStep}`
          : `${error.code}: ${error.message}`,
      },
      { type: "text", text: JSON.stringify(payload) },
    ],
  };
}
