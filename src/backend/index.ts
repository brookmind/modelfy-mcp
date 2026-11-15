import type { GrantProps } from "../auth/props";
import { ApiBackend } from "./api-backend";
import { SandboxBackend } from "./sandbox-backend";
import type { PhotoBackend } from "./types";

/** Test and anonymous keys get the sandbox; everyone else the Modelfy API. */
export function backendFor(
  props: GrantProps,
  env: Env,
  owner: string,
): PhotoBackend {
  if (
    props.kind === "test" ||
    props.kind === "anonymous" ||
    props.apiToken === null
  ) {
    return new SandboxBackend(env, props, owner);
  }
  return new ApiBackend(env, props, props.apiToken);
}
