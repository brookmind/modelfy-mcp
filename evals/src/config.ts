const DEV_URL = "https://mcp-dev.modelfy.ai";

/**
 * The server under test: mcp-dev, or a pinned local copy of the Worker
 * reached through a tunnel (EVALS_BASE_URL), which has no KV write limit and
 * never changes under a run. Production is never used by the evals.
 */
export const BASE_URL = process.env.EVALS_BASE_URL ?? DEV_URL;
/** Workers Free's KV write limit binds only the deployed dev Worker. */
export const KV_BUDGET_APPLIES = BASE_URL === DEV_URL;
export const MCP_URL = `${BASE_URL}/mcp`;

/**
 * The demo product (a linen T-shirt): fixed public test data, always the copy
 * on mcp-dev. Anthropic's web fetch refuses tunnel domains, and reading it
 * writes nothing, so a local server under test downloads it from there.
 */
export const DEMO = {
  page: `${DEV_URL}/sandbox/demo/product`,
  front: `${DEV_URL}/sandbox/demo/tee-front.png`,
  back: `${DEV_URL}/sandbox/demo/tee-back.png`,
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
