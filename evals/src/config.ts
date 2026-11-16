/** The dev server under test; production is never used by the evals. */
export const BASE_URL = "https://mcp-dev.modelfy.ai";
export const MCP_URL = `${BASE_URL}/mcp`;

/** The demo product the sandbox serves (a linen T-shirt). */
export const DEMO = {
  page: `${BASE_URL}/sandbox/demo/product`,
  front: `${BASE_URL}/sandbox/demo/tee-front.png`,
  back: `${BASE_URL}/sandbox/demo/tee-back.png`,
};

/** The agent under test, the person simulator and the judge (owner's call). */
export const AGENT_MODEL = "claude-haiku-5-5";
export const PERSON_MODEL = "claude-haiku-5-5";
export const JUDGE_MODEL = "claude-haiku-5-5";
/** Fixed so runs are comparable; Haiku 5.5's default too. */
export const AGENT_EFFORT = "medium";
/**
 * Anthropic's web fetch tool for the chat assistant (a chat app can read a
 * product page). The newest version Haiku 5.5 accepts; see evals/README.md.
 */
export const WEB_FETCH_TOOL = "web_fetch_20250910";

export const MAX_PERSON_TURNS = 8;
/** Stop before this many estimated KV writes per UTC day (Workers Free: 1,000). */
export const KV_WRITES_PER_DAY = 900;
/** Bot keys' budget on the sandbox (a live key's defaults). */
export const BOT_BUDGET = { perSession: 100, perDay: 500 };
