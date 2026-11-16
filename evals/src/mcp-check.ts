import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { z } from "zod";
import { MCP_URL } from "./config.ts";

/** Calls one tool with a key, as the grader (not as the agent). */
async function callTool(
  key: string,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const client = new Client({ name: "modelfy-evals-grader", version: "0.1.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(MCP_URL), {
      requestInit: { headers: { Authorization: `Bearer ${key}` } },
    }),
  );
  try {
    const result = await client.callTool({ name, arguments: args });
    return result.isError === true ? null : result.structuredContent;
  } finally {
    await client.close();
  }
}

/** True when the key opens a Modelfy connection. */
export async function keyWorks(key: string): Promise<boolean> {
  try {
    return (await callTool(key, "get_account", {})) !== null;
  } catch {
    return false;
  }
}

const Recent = z.object({
  photos: z.array(z.object({ photo_id: z.string() })),
});

/** How many photos the key's account has made recently. */
export async function recentPhotoCount(key: string): Promise<number> {
  try {
    const parsed = Recent.safeParse(
      await callTool(key, "list_recent_photos", { limit: 30 }),
    );
    return parsed.success ? parsed.data.photos.length : 0;
  } catch {
    return 0;
  }
}
