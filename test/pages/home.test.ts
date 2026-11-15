import { describe, expect, it } from "vitest";
import { call } from "../helpers/worker";

describe("the public home page", () => {
  it("says what the server is and which URL to add", async () => {
    const response = await call("/");
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(body).toContain("https://mcp.test/mcp");
    expect(body).toContain("/sandbox/keys");
    expect(body).toContain("/device/code");
  });
});
