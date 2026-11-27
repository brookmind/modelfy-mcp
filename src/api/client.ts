import type { ZodType } from "zod";
import { z } from "zod";
import { currentToolCall } from "../mcp/tool-call";

/** A failed call to the Modelfy API, with the API's error code. */
export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: unknown;

  constructor(status: number, code: string, message: string, body: unknown) {
    super(message);
    this.name = "ApiFailure";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

const ErrorBody = z.object({
  error: z.string(),
  message: z.string().optional(),
});

const Envelope = z.object({ data: z.unknown() });

type Method = "GET" | "POST";

/**
 * The Modelfy `/v2` API as this server uses it: every request carries the
 * Worker's shared secret and, when there is one, the user's token; every
 * answer is parsed with a schema before anything reads it.
 */
export class ModelfyApi {
  readonly #env: Env;
  readonly #token: string | null;

  constructor(env: Env, token: string | null) {
    this.#env = env;
    this.#token = token;
  }

  get<T>(path: string, schema: ZodType<T>): Promise<T> {
    return this.#call("GET", path, undefined, schema);
  }

  post<T>(path: string, body: unknown, schema: ZodType<T>): Promise<T> {
    return this.#call("POST", path, body, schema);
  }

  async #call<T>(
    method: Method,
    path: string,
    body: unknown,
    schema: ZodType<T>,
  ): Promise<T> {
    const headers = new Headers({
      "X-Mcp-Secret": this.#env.MCP_SERVER_SECRET,
    });
    if (this.#token !== null) {
      headers.set("Authorization", `Bearer ${this.#token}`);
    }
    if (body !== undefined) headers.set("Content-Type", "application/json");
    const toolCall = currentToolCall();
    if (toolCall !== undefined) {
      headers.set("X-Mcp-Tool", toolCall.tool);
      headers.set("X-Mcp-Call", toolCall.id);
    }

    let response: Response;
    try {
      response = await fetch(`${this.#env.API_URL}${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new ApiFailure(
        503,
        "UNAVAILABLE",
        "Modelfy is not reachable",
        null,
      );
    }

    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const parsed = ErrorBody.safeParse(payload);
      throw new ApiFailure(
        response.status,
        parsed.success ? parsed.data.error : "UNKNOWN",
        parsed.success
          ? (parsed.data.message ?? parsed.data.error)
          : `Modelfy answered ${response.status}`,
        payload,
      );
    }
    const envelope = Envelope.safeParse(payload);
    const data = envelope.success ? schema.safeParse(envelope.data.data) : null;
    if (data === null || !data.success) {
      throw new ApiFailure(
        502,
        "BAD_RESPONSE",
        "Modelfy answered in an unexpected shape",
        payload,
      );
    }
    return data.data;
  }
}
