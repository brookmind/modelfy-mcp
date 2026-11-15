import { z } from "zod";
import { ApiFailure, ModelfyApi } from "../api/client";
import { clientIp, hourlyLimit } from "../limits";

const StartedSchema = z.object({
  deviceCode: z.string(),
  userCode: z.string(),
  expiresAt: z.string(),
  interval: z.number(),
});

const PollSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("authorization_pending") }),
  z.object({ status: z.literal("slow_down") }),
  z.object({ status: z.literal("access_denied") }),
  z.object({ status: z.literal("expired_token") }),
  z.object({
    status: z.literal("approved"),
    apiKey: z.string(),
    kind: z.enum(["LIVE", "TEST"]),
    budget: z
      .object({
        maxCreditsPerSession: z.number(),
        maxCreditsPerDay: z.number(),
      })
      .nullable(),
  }),
]);

/** A form-encoded or JSON body field (RFC 8628 clients send forms). */
async function field(request: Request, name: string): Promise<string | null> {
  const type = request.headers.get("Content-Type") ?? "";
  try {
    if (type.includes("application/json")) {
      const body: unknown = await request.json();
      const parsed = z.record(z.string(), z.unknown()).safeParse(body);
      const value = parsed.success ? parsed.data[name] : undefined;
      return typeof value === "string" && value !== "" ? value : null;
    }
    const form = await request.formData();
    const value = form.get(name);
    return typeof value === "string" && value !== "" ? value : null;
  } catch {
    return null;
  }
}

const DEVICE_CODES_PER_IP_PER_HOUR = 10;
/** Token answers must never be cached (RFC 6749 §5.1). */
const NO_STORE = { "Cache-Control": "no-store" };

function oauthError(error: string, status = 400): Response {
  return Response.json({ error }, { status, headers: NO_STORE });
}

/** POST /device/code (design §4.4 step 1). */
export async function startDevice(
  request: Request,
  env: Env,
): Promise<Response> {
  // Every code costs a call to the API with the server secret: limit per address
  const allowed = await hourlyLimit(
    env.OAUTH_KV,
    `device-code:${clientIp(request)}`,
    DEVICE_CODES_PER_IP_PER_HOUR,
  );
  if (!allowed) return oauthError("slow_down", 429);
  const clientName = (await field(request, "client_name")) ?? "An AI agent";
  let started: z.infer<typeof StartedSchema>;
  try {
    started = await new ModelfyApi(env, null).post(
      "/v2/connections/device",
      { clientName: clientName.slice(0, 60) },
      StartedSchema,
    );
  } catch (error) {
    if (error instanceof ApiFailure)
      return oauthError("temporarily_unavailable", 503);
    throw error;
  }
  const verification = new URL("/activate", env.WEB_URL);
  const complete = new URL(verification);
  complete.searchParams.set("code", started.userCode);
  return Response.json({
    device_code: started.deviceCode,
    user_code: started.userCode,
    verification_uri: verification.toString(),
    verification_uri_complete: complete.toString(),
    expires_in: Math.max(
      0,
      Math.round((new Date(started.expiresAt).getTime() - Date.now()) / 1000),
    ),
    interval: started.interval,
  });
}

/** POST /device/token (design §4.4 step 4), RFC 8628 §3.5 answers. */
export async function pollDevice(
  request: Request,
  env: Env,
): Promise<Response> {
  const deviceCode = await field(request, "device_code");
  if (deviceCode === null) return oauthError("invalid_request");
  let result: z.infer<typeof PollSchema>;
  try {
    result = await new ModelfyApi(env, null).post(
      "/v2/connections/device/poll",
      { deviceCode },
      PollSchema,
    );
  } catch (error) {
    if (error instanceof ApiFailure)
      return oauthError("temporarily_unavailable", 503);
    throw error;
  }
  if (result.status !== "approved") return oauthError(result.status);
  return Response.json(
    {
      api_key: result.apiKey,
      kind: result.kind === "LIVE" ? "live" : "test",
      budget: result.budget,
    },
    { headers: NO_STORE },
  );
}
