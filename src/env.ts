import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

/** The Worker's bindings plus the OAuth helpers the provider injects. */
export interface AppEnv extends Env {
  OAUTH_PROVIDER: OAuthHelpers;
}
