import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { createQueue } from "./serial.ts";

/**
 * Plays the person who approves a device login on the Modelfy web: with a dev
 * test account's session it approves the code (always a TEST key, nothing can
 * be spent) and revokes that key after the run. The session's refresh token
 * lives in evals/.secrets/dev-refresh-token (outside git) and rotates.
 */
const API_URL = "https://api-dev.modelfy.ai";
const TOKEN_FILE = join(
  import.meta.dirname,
  "..",
  ".secrets",
  "dev-refresh-token",
);

const Refreshed = z.object({
  data: z.object({ accessToken: z.string(), refreshToken: z.string() }),
});
const Connections = z.object({
  data: z.object({
    items: z.array(z.object({ id: z.string(), name: z.string() })),
  }),
});

async function accessToken(): Promise<string> {
  const refreshToken = (await readFile(TOKEN_FILE, "utf8")).trim();
  const response = await fetch(`${API_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (!response.ok) {
    throw new Error(
      `The dev session could not be refreshed (${response.status}); give the harness a new refresh token`,
    );
  }
  const tokens = Refreshed.parse(await response.json()).data;
  await writeFile(TOKEN_FILE, tokens.refreshToken, { mode: 0o600 });
  return tokens.accessToken;
}

async function api(
  path: string,
  init: RequestInit,
  token: string,
): Promise<Response> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error(
      `${init.method ?? "GET"} ${path} answered ${response.status}: ${await response.text()}`,
    );
  }
  return response;
}

/** Approves the code with a test key named `name` (unique per run). */
/**
 * Every refresh replaces the stored refresh token, so runs that approve or
 * revoke at the same time would refresh with a token another run just used:
 * all calls with the dev session go through one queue.
 */
const session = createQueue();

export function approveDevice(userCode: string, name: string): Promise<void> {
  return session(async () => {
    const token = await accessToken();
    await api(
      `/v2/connections/device/${encodeURIComponent(userCode)}/approve`,
      { method: "POST", body: JSON.stringify({ kind: "TEST", name }) },
      token,
    );
  });
}

/** Revokes the keys that approval created, so the account stays under 20 keys. */
export function revokeKeyNamed(name: string): Promise<void> {
  return session(async () => {
    const token = await accessToken();
    const list = Connections.parse(
      await (await api("/v2/connections", { method: "GET" }, token)).json(),
    );
    for (const connection of list.data.items.filter(
      (item) => item.name === name,
    )) {
      await api(
        `/v2/connections/${connection.id}`,
        { method: "DELETE" },
        token,
      );
    }
  });
}
