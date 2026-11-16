import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Cold starts of the Workers runtime are slow on a busy machine
  test: { testTimeout: 15_000 },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          API_URL: "https://api.test",
          WEB_URL: "https://web.test",
          PUBLIC_URL: "https://mcp.test",
          MCP_SERVER_SECRET: "test-secret",
          SANDBOX_ACCOUNT_KEY: `mfy_test_${"S".repeat(43)}`,
        },
      },
    }),
  ],
});
