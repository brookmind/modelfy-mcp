const DAY_SECONDS = 24 * 60 * 60;

/**
 * Lifetimes that keep people signed in (design §4.2): a one-hour access token,
 * refresh tokens with no fixed end that expire only after 90 idle days, and
 * registered clients that are never forgotten. Everything lives in KV.
 */
export const oauthOptions = {
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/oauth/token",
  clientRegistrationEndpoint: "/oauth/register",
  clientIdMetadataDocumentEnabled: true,
  accessTokenTTL: 3600,
  refreshTokenTTL: undefined,
  refreshTokenIdleTTL: 90 * DAY_SECONDS,
  clientRegistrationTTL: undefined,
} as const satisfies Record<string, string | number | boolean | undefined>;
