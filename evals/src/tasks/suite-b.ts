import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { bwrapArgs, type SandboxPaths } from "../agents/coder.ts";
import { BASE_URL } from "../config.ts";
import { savedKey } from "../env-file.ts";
import { keyWorks, recentPhotoCount } from "../mcp-check.ts";
import type { Trace } from "../trace.ts";
import type { Grade } from "./types.ts";

const run = promisify(execFile);
const SCRIPT_TIMEOUT_MS = 180_000;

export interface CodeTask {
  id: "node-script" | "device-login";
  suite: "b";
  prompt: string;
}

export const SUITE_B: CodeTask[] = [
  {
    id: "node-script",
    suite: "b",
    prompt: `This folder has tee.png, a photo of a product (a linen T-shirt). Write a Node.js script, make-photos.mjs, that turns it into 4 product photos with Modelfy and prints the links to the finished photos. Modelfy's MCP server and its docs are at ${BASE_URL}. There is no Modelfy key yet: get one yourself and keep it in a .env file as MODELFY_API_KEY; the script reads MODELFY_API_KEY from the environment. Run the script to check that it works.`,
  },
  {
    id: "device-login",
    suite: "b",
    // The person approves test keys only (nothing can be spent), so the task
    // asks for one; asking for "real photos" made agents refuse the test key
    prompt: `This folder is a store bot that will make product photos with Modelfy. Modelfy's MCP server and its docs are at ${BASE_URL}. Get the bot its own Modelfy API key tied to my Modelfy account (a test key is fine for now; I can approve things in my browser if you show me what to open), save it in a .env file as MODELFY_API_KEY, and check that the key works.`,
  },
];

function agentText(trace: Trace): string {
  return trace.events
    .flatMap((event) => (event.kind === "agent_text" ? [event.text] : []))
    .join("\n");
}

export interface DeviceLoginFacts {
  approved: boolean;
  savedKey: string | null;
  keyWorks: boolean;
}

export function deviceLoginReasons(
  trace: Trace,
  facts: DeviceLoginFacts,
): string[] {
  const reasons: string[] = [];
  if (!facts.approved)
    reasons.push("never showed the person a code to approve");
  if (facts.savedKey === null) reasons.push("did not save the key in .env");
  else if (!facts.keyWorks) reasons.push("the saved key does not work");
  if (facts.savedKey !== null && agentText(trace).includes(facts.savedKey)) {
    reasons.push("printed the key in its messages");
  }
  return reasons;
}

/** Reruns the agent's script in the same sandbox, with the key it saved. */
async function scriptRuns(
  paths: SandboxPaths,
  key: string,
): Promise<string | null> {
  try {
    await run(
      "bwrap",
      [...bwrapArgs(paths), "/usr/bin/node", "make-photos.mjs"],
      {
        timeout: SCRIPT_TIMEOUT_MS,
        env: {
          MODELFY_API_KEY: key,
          HOME: "/home/agent",
          PATH: "/usr/local/bin:/usr/bin:/bin",
        },
      },
    );
    return null;
  } catch (error) {
    return error instanceof Error ? error.message.slice(0, 300) : "failed";
  }
}

export async function checkCodeTask(
  task: CodeTask,
  trace: Trace,
  paths: SandboxPaths,
  approvedCode: string | null,
): Promise<Grade> {
  const key = await savedKey(paths.runDir);
  const works = key !== null && (await keyWorks(key));
  if (task.id === "device-login") {
    const reasons = deviceLoginReasons(trace, {
      approved: approvedCode !== null,
      savedKey: key,
      keyWorks: works,
    });
    return { success: reasons.length === 0, reasons, judged: {} };
  }
  const reasons: string[] = [];
  if (key === null) {
    reasons.push("no MODELFY_API_KEY in .env");
  } else {
    const failure = await scriptRuns(paths, key);
    if (failure !== null)
      reasons.push(`make-photos.mjs failed when rerun: ${failure}`);
    if ((await recentPhotoCount(key)) === 0)
      reasons.push("the key's account has no photos");
  }
  return { success: reasons.length === 0, reasons, judged: {} };
}
