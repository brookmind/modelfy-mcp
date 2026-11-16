import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** The MODELFY_API_KEY line of a run folder's .env, if the agent wrote one. */
export async function savedKey(runDir: string): Promise<string | null> {
  let text: string;
  try {
    text = await readFile(join(runDir, ".env"), "utf8");
  } catch {
    return null;
  }
  const match =
    /^\s*(?:export\s+)?MODELFY_API_KEY\s*=\s*["']?(mfy_[A-Za-z0-9_]+)["']?\s*$/m.exec(
      text,
    );
  return match?.[1] ?? null;
}
