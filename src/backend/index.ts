import type { GrantProps } from "../auth/props";
import { ApiBackend } from "./api-backend";
import type { PhotoBackend } from "./types";

/** The backend a connection works with (the sandbox arrives in Task 7). */
export function backendFor(props: GrantProps, env: Env): PhotoBackend {
  const token = props.apiToken ?? env.SANDBOX_ACCOUNT_KEY;
  return new ApiBackend(env, props, token);
}
